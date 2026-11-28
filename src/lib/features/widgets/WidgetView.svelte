<script lang="ts">
  import type { MemberView, TermsPolicyView } from '#src/generated/protocol';
  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import Alert from '#lib/ui/primitives/Alert.svelte';
  import Button from '#lib/ui/primitives/Button.svelte';
  import DialogActions from '#lib/ui/primitives/DialogActions.svelte';
  import Spinner from '#lib/ui/primitives/Spinner.svelte';

  import { type CapabilityDecision, approveCapabilities } from './capabilities.js';
  import { WATCH_TOGETHER_WIDGET_TYPE } from './watch-together/watch-together-protocol.js';
  import type { WatchTogetherSession } from './watch-together/watch-together-session.svelte.js';
  import WatchTogetherView from './watch-together/WatchTogetherView.svelte';
  import type { RoomWidget } from './widget-content.js';
  import { attachScalarToken, needsScalarToken } from './widget-url.js';
  import WidgetCapabilitiesDialog from './WidgetCapabilitiesDialog.svelte';
  import WidgetFrame from './WidgetFrame.svelte';

  interface Props {
    roomId: string;
    widget: RoomWidget;
    url: string;
    permissionKey: string;
    canManage?: boolean;
    members?: readonly MemberView[];
    theater?: boolean;
    watchTogetherSession?: WatchTogetherSession;
    pendingWatchUrl?: string | null;
    onConsumePendingWatchUrl?: () => void;
    onToggleTheater?: () => void;
    onToggleMaximize?: () => void;
    onEnsureWatchWidget?: (fallbackUrl: string) => Promise<void>;
  }

  let {
    roomId,
    widget,
    url,
    permissionKey,
    canManage = false,
    members = [],
    theater = false,
    watchTogetherSession,
    pendingWatchUrl = null,
    onConsumePendingWatchUrl,
    onToggleTheater,
    onToggleMaximize,
    onEnsureWatchWidget,
  }: Props = $props();

  const core = useCoreClient();

  interface PendingApproval {
    requested: string[];
    settle: (decision: CapabilityDecision) => void;
  }

  let isWatchTogether = $derived(widget.type === WATCH_TOGETHER_WIDGET_TYPE);
  let approval = $state.raw<PendingApproval | null>(null);
  let requiresToken = $derived(!isWatchTogether && needsScalarToken(url));
  let frameUrl = $state<string | null>(null);
  let terms = $state<TermsPolicyView[] | null>(null);
  let accepting = $state(false);
  let acceptFailed = $state(false);
  let attempt = 0;
  let effectiveUrl = $derived(requiresToken ? frameUrl : url);

  function resolveScalarUrl(token: number, targetUrl: string): void {
    core.rpc.session
      .integrationManagerUrl({ room_id: roomId })
      .then((managerUrl) => {
        if (token === attempt) frameUrl = attachScalarToken(targetUrl, managerUrl);
      })
      .catch((error: unknown) => {
        console.warn('[sable widgets] scalar token unavailable for widget', error);
        if (token === attempt) frameUrl = targetUrl;
      });
  }

  async function acceptTerms(): Promise<void> {
    if (terms === null) return;
    const token = attempt;
    const targetUrl = url;
    accepting = true;
    acceptFailed = false;
    try {
      await core.rpc.session.acceptIntegrationManagerTerms({
        urls: terms.map((policy) => policy.url),
      });
      if (token !== attempt) return;
      terms = null;
      resolveScalarUrl(token, targetUrl);
    } catch (error) {
      console.warn('[sable widgets] the integration manager terms were not accepted', error);
      if (token === attempt) acceptFailed = true;
    } finally {
      accepting = false;
    }
  }

  function requestCapabilities(requested: Set<string>): Promise<Set<string>> {
    return approveCapabilities(
      permissionKey,
      requested,
      (missing) =>
        new Promise<CapabilityDecision>((settle) => {
          approval = {
            requested: missing,
            settle: (decision) => {
              approval = null;
              settle(decision);
            },
          };
        })
    );
  }

  $effect(() => {
    const targetUrl = url;
    if (!requiresToken) {
      frameUrl = null;
      terms = null;
      acceptFailed = false;
      return;
    }
    const token = ++attempt;
    frameUrl = null;
    terms = null;
    acceptFailed = false;
    core.rpc.session
      .integrationManagerTerms()
      .catch((error: unknown) => {
        console.debug('[sable widgets] the integration manager terms were not read', error);
        return [];
      })
      .then((pending) => {
        if (token !== attempt) return;
        if (pending.length > 0) terms = pending;
        else resolveScalarUrl(token, targetUrl);
      });
    return () => {
      attempt++;
    };
  });

  $effect(() => () => approval?.settle({ approved: [], remember: false }));
</script>

<div class="widgets-frame">
  {#if isWatchTogether}
    <WatchTogetherView
      {roomId}
      session={watchTogetherSession}
      {canManage}
      {members}
      {theater}
      pendingUrl={pendingWatchUrl}
      onConsumePendingUrl={onConsumePendingWatchUrl}
      {onToggleTheater}
      {onToggleMaximize}
      onEnsureRoomWidget={onEnsureWatchWidget}
    />
  {:else if terms !== null}
    <div class="widgets-terms">
      <h3>{i18n.t('widgets.integrationManagerTermsTitle')}</h3>
      <p>{i18n.t('widgets.integrationManagerTermsBody')}</p>
      <ul>
        {#each terms as policy (policy.url)}
          <li>
            <a href={policy.url} target="_blank" rel="external noopener noreferrer">{policy.name}</a>
          </li>
        {/each}
      </ul>
      {#if acceptFailed}
        <Alert variant="critical">{i18n.t('widgets.integrationManagerTermsFailed')}</Alert>
      {/if}
      <DialogActions>
        <Button variant="primary" loading={accepting} onclick={acceptTerms}>
          {i18n.t('common.accept')}
        </Button>
      </DialogActions>
    </div>
  {:else if effectiveUrl === null}
    <div class="widgets-loading">
      <Spinner label={i18n.t('widgets.integrationManagerLoading')} />
    </div>
  {:else}
    <WidgetFrame
      {roomId}
      widgetId={widget.id}
      url={effectiveUrl}
      name={widget.name}
      onCapabilities={requestCapabilities}
    />
  {/if}
</div>

{#if approval}
  {@const pending = approval}
  <WidgetCapabilitiesDialog
    open
    widgetName={widget.name}
    requested={pending.requested}
    onDecide={pending.settle}
  />
{/if}

<style>
  .widgets-frame {
    border: none;
    box-sizing: border-box;
    display: block;
    height: 100%;
    max-width: 100%;
    width: 100%;
  }

  .widgets-loading {
    align-items: center;
    display: flex;
    height: 100%;
    justify-content: center;
    padding: var(--space-400);
  }

  .widgets-terms {
    display: grid;
    gap: var(--space-300);
    max-width: 32rem;
    padding: var(--space-400);
  }

  .widgets-terms ul {
    margin: 0;
    padding-inline-start: var(--space-400);
  }
</style>
