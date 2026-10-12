<script lang="ts">
  let { children, tone = 'neutral' }: { children: import('svelte').Snippet; tone?: 'neutral' | 'good' | 'bad' | 'accent' | 'info' | 'warning' } = $props();
</script>
<span class={`badge badge-${tone}`}>{@render children()}</span>
