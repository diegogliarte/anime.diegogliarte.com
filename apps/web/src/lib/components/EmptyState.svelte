<script lang="ts">
  let { title, detail }: { title: string; detail?: string } = $props();
</script>
<div class="empty"><strong>{title}</strong>{#if detail}<span>{detail}</span>{/if}</div>
