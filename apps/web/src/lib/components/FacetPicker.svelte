<script lang="ts">
  import type { NamedFacetValue } from '@youranimelist/shared';

  let { label, options, value = $bindable<number[]>([]) }: { label: string; options: NamedFacetValue[]; value?: number[] } = $props();
  let query = $state('');
  const matches = $derived.by(() => {
    const search = query.trim().toLowerCase();
    return options.filter((option) => !search || option.name.toLowerCase().includes(search)).slice(0, 60);
  });

  function toggle(id: number) {
    value = value.includes(id) ? value.filter((item) => item !== id) : [...value, id];
  }
</script>

<details class="filter facet-picker">
  <summary><span>{label}</span><strong>{value.length ? `${value.length} selected` : 'Any'}</strong></summary>
  <div class="facet-picker-menu">
    <input bind:value={query} placeholder={`Find ${label.toLowerCase()}…`} />
    <div class="facet-options">
      {#each matches as option (option.id)}
        <label>
          <input type="checkbox" checked={value.includes(option.id)} onchange={() => toggle(option.id)} />
          <span>{option.name}</span><small>{option.count.toLocaleString()}</small>
        </label>
      {/each}
    </div>
  </div>
</details>
