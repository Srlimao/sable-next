<script lang="ts">
  import type { RoomListItemView } from '#src/generated/protocol';
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import RoomNav from './RoomNav.svelte';

  interface Props {
    onNavigate?: (href: string) => void;
    onJoinVoice?: (room: RoomListItemView, href: string) => void;
    callRoomId?: string | null;
    width?: number;
    collapsed?: boolean;
    roomId?: string;
    height?: number;
    pinnedSpaceIds?: ReadonlySet<string>;
    onTogglePin?: (roomId: string) => void;
  }

  let {
    onNavigate,
    onJoinVoice,
    callRoomId,
    width,
    collapsed,
    roomId,
    height,
    pinnedSpaceIds,
    onTogglePin,
  }: Props = $props();
</script>

<TooltipProvider>
  {#if height === undefined}
    <RoomNav
      {onNavigate}
      {onJoinVoice}
      {callRoomId}
      {width}
      {collapsed}
      {roomId}
      {pinnedSpaceIds}
      {onTogglePin}
    />
  {:else}
    <div style:display="flex" style:flex-direction="column" style:height="{height}px">
      <RoomNav {onNavigate} {onJoinVoice} {callRoomId} {width} {collapsed} {roomId} />
    </div>
  {/if}
</TooltipProvider>
