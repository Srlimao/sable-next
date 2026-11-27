<script lang="ts">
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import { provideAlertProviders } from './alerts';
  import SidebarNav from './SidebarNav.svelte';

  interface Props {
    mobile?: boolean;
    onNavigate?: (href: string) => void;
  }

  let { mobile, onNavigate }: Props = $props();

  provideAlertProviders([]);
</script>

<TooltipProvider>
  <SidebarNav {mobile} {onNavigate} />
</TooltipProvider>
