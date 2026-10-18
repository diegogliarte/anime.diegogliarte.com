<script lang="ts" module>
  export type TableColumn<Row> = {
    key: string;
    label: string;
    value: (row: Row) => string | number | null;
    format?: (value: string | number | null, row: Row) => string;
    width?: string;
    align?: 'left' | 'center' | 'right';
    tone?: (row: Row) => 'default' | 'strong' | 'positive' | 'negative';
    sortable?: boolean;
    hideable?: boolean;
    defaultHidden?: boolean;
  };
  export type RowMeta = {
    title: string;
    subtitle?: string;
    imageUrl?: string | null;
    href?: string;
    tags?: string[];
    imageTone?: 'neutral' | 'good' | 'bad' | 'accent' | 'warning';
  };
</script>

<script lang="ts" generics="Row">
  import { onMount } from 'svelte';
  import Badge from './Badge.svelte';

  let {
    rows, columns, rowKey, rowMeta, total = rows.length, loading = false, hasMore = false,
    loadMore, empty = 'No entries', columnStorageKey
  }: {
    rows: Row[]; columns: TableColumn<Row>[]; rowKey: (row: Row) => string | number;
    rowMeta?: (row: Row) => RowMeta; total?: number; loading?: boolean; hasMore?: boolean;
    loadMore?: () => void | Promise<void>; empty?: string; columnStorageKey?: string;
  } = $props();

  let sentinel = $state<HTMLDivElement>();
  let sortKey = $state<string | null>(null);
  let direction = $state<'asc' | 'desc'>('asc');
  let hiddenColumns = $state<string[]>([]);
  let loadedColumnStorageKey = $state('');
  let loadingRequested = false;

  const columnPreferenceKey = $derived(`youranimelist:columns:${columnStorageKey ?? columns.map((column) => column.key).join(',')}`);
  const visibleColumns = $derived(columns.filter((column) => !hiddenColumns.includes(column.key)));
  const sorted = $derived.by(() => {
    const column = columns.find((item) => item.key === sortKey);
    if (!column) return rows;
    return [...rows].sort((a, b) => {
      const first = column.value(a); const second = column.value(b);
      if (first == null && second == null) return 0;
      if (first == null) return 1; if (second == null) return -1;
      const result = typeof first === 'number' && typeof second === 'number'
        ? first - second : String(first).localeCompare(String(second), undefined, { numeric: true, sensitivity: 'base' });
      return direction === 'asc' ? result : -result;
    });
  });

  $effect(() => {
    if (loadedColumnStorageKey === columnPreferenceKey) return;
    const stored = localStorage.getItem(columnPreferenceKey);
    if (stored) {
      try {
        const keys = JSON.parse(stored) as string[];
        hiddenColumns = keys.filter((key) => columns.some((column) => column.key === key && column.hideable !== false));
      } catch {
        hiddenColumns = columns.filter((column) => column.defaultHidden).map((column) => column.key);
      }
    } else {
      hiddenColumns = columns.filter((column) => column.defaultHidden).map((column) => column.key);
    }
    loadedColumnStorageKey = columnPreferenceKey;
  });

  async function requestMore() {
    if (!hasMore || loading || loadingRequested) return;
    loadingRequested = true;
    try { await loadMore?.(); } finally { loadingRequested = false; }
  }

  onMount(() => {
    if (!sentinel) return;
    const root = sentinel.closest('main');
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) void requestMore(); },
      { root: root instanceof HTMLElement ? root : null, rootMargin: '600px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!hasMore || loading || !sentinel) return;
    const root = sentinel.closest('main');
    const bottom = root instanceof HTMLElement ? root.getBoundingClientRect().bottom : innerHeight;
    if (sentinel.getBoundingClientRect().top < bottom + 600) void requestMore();
  });

  function sort(column: TableColumn<Row>) {
    if (column.sortable === false) return;
    if (sortKey === column.key) direction = direction === 'asc' ? 'desc' : 'asc';
    else { sortKey = column.key; direction = 'asc'; }
  }
  function toggleColumn(column: TableColumn<Row>) {
    if (column.hideable === false) return;
    hiddenColumns = hiddenColumns.includes(column.key)
      ? hiddenColumns.filter((key) => key !== column.key)
      : [...hiddenColumns, column.key];
    localStorage.setItem(columnPreferenceKey, JSON.stringify(hiddenColumns));
  }
  function resetColumns() {
    hiddenColumns = columns.filter((column) => column.defaultHidden).map((column) => column.key);
    localStorage.setItem(columnPreferenceKey, JSON.stringify(hiddenColumns));
  }
</script>

<div class="data-table">
  <div class="table-count">
    <span>{rows.length.toLocaleString()} / {total.toLocaleString()}</span>
    <div class="table-tools">
      {#if loading}<span>Loading…</span>{/if}
      <details class="column-picker">
        <summary>Columns</summary>
        <div class="column-picker-menu">
          {#each columns as column (column.key)}
            <label>
              <input type="checkbox" checked={!hiddenColumns.includes(column.key)} disabled={column.hideable === false} onchange={() => toggleColumn(column)} />
              <span>{column.label}</span>
            </label>
          {/each}
          <button type="button" onclick={resetColumns}>Reset</button>
        </div>
      </details>
    </div>
  </div>
  <div class="table-viewport">
    <table>
      <colgroup>{#each visibleColumns as column (column.key)}<col style:width={column.width ?? 'auto'} />{/each}</colgroup>
      <thead><tr>{#each visibleColumns as column (column.key)}<th class:align-center={column.align === 'center'} class:align-right={column.align === 'right'}><button type="button" onclick={() => sort(column)} disabled={column.sortable === false}>{column.label}{#if sortKey === column.key}<span>{direction === 'asc' ? '↑' : '↓'}</span>{/if}</button></th>{/each}</tr></thead>
      <tbody>
        {#if sorted.length}
          {#each sorted as row (rowKey(row))}
            {@const meta = rowMeta?.(row)}
            {@const itemKey = rowKey(row)}
            <tr>
              {#each visibleColumns as column, columnIndex (column.key)}
                {@const value = column.value(row)}
                <td class:align-center={column.align === 'center'} class:align-right={column.align === 'right'} class:strong={column.tone?.(row) === 'strong'} class:positive={column.tone?.(row) === 'positive'} class:negative={column.tone?.(row) === 'negative'}>
                  {#if columnIndex === 0 && meta}
                    <div class="anime-cell">
                      {#if meta.imageUrl}<img class={meta.imageTone ? `status-image status-${meta.imageTone}` : ''} src={meta.imageUrl} alt="" loading="lazy" />{/if}
                      <div class="anime-copy">
                        <a href={meta.href ?? '#'} target={meta.href?.startsWith('http') ? '_blank' : undefined}>{meta.title}</a>
                        <div class="anime-meta">{#if meta.subtitle}<small>{meta.subtitle}</small>{/if}<a href={`/franchises?id=${encodeURIComponent(String(itemKey))}`} target="_blank" rel="noopener">Franchise</a><a href={`/recommendations?id=${encodeURIComponent(String(itemKey))}`} target="_blank" rel="noopener">Recommendations</a></div>
                      </div>
                      {#each (meta.tags ?? []).filter((tag) => !['plus', 'minus'].includes(tag.toLowerCase())) as tag}<Badge>{tag}</Badge>{/each}
                    </div>
                  {:else}{column.format ? column.format(value, row) : (value ?? '—')}{/if}
                </td>
              {/each}
            </tr>
          {/each}
        {:else if !loading}<tr><td colspan={visibleColumns.length}><div class="empty-row">{empty}</div></td></tr>{/if}
      </tbody>
    </table>
  </div>
  <div class="table-sentinel" bind:this={sentinel}>{#if loading && rows.length}<span>Loading more…</span>{/if}</div>
</div>
