<script lang="ts">
  let { title, description, children }: { title: string; description?: string; children?: import('svelte').Snippet } = $props();
</script>
<header class="page-header">
  <div><h1>{title}</h1>{#if description}<p>{description}</p>{/if}</div>
  {#if children}<div class="page-actions">{@render children()}</div>{/if}
</header>
