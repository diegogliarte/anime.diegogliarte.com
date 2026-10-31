<script lang="ts">
  import { onMount } from 'svelte';
  import type { CrawlerStatusResponse } from '@youranimelist/shared';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { api } from '$lib/data/api';

  let response = $state<CrawlerStatusResponse | null>(null);
  let error = $state<string | null>(null);
  let updatedAt = $state<Date | null>(null);
  const status = $derived(response?.status ?? null);
  const progress = $derived(status?.phase === 'refresh' && status.currentId && status.scanLimit
    ? Math.min(status.currentId / status.scanLimit * 100, 100) : null);

  onMount(() => {
    async function refresh() {
      try {
        response = await api<CrawlerStatusResponse>('/v1/crawler');
        error = null;
        updatedAt = new Date();
      } catch (cause) { error = cause instanceof Error ? cause.message : 'Unable to load crawler status.'; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  });

  function date(value: string | null | undefined) {
    return value ? new Date(value).toLocaleString() : '—';
  }

  function elapsed(value: string | null | undefined) {
    if (!value) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
  }

  function eta() {
    if (!status?.startedAt || status.phase !== 'refresh' || !status.currentId || !status.scanLimit) return 'ETA unavailable';
    const elapsedMs = Date.now() - Date.parse(status.startedAt);
    const remainingMs = elapsedMs / status.currentId * Math.max(status.scanLimit - status.currentId, 0);
    const target = new Date(Date.now() + remainingMs);
    return `ETA ${target.toLocaleString()}`;
  }
</script>

<svelte:head><title>Maintenance · YourAnimeList</title></svelte:head>
<div class="page maintenance-page">
  <PageHeader title="Maintenance" description="Crawler health and recent activity." />
  {#if error}<div class="error">{error}</div>{/if}
  {#if status}
    <section class="maintenance-summary">
      <div><span>State</span><strong class="crawler-state {status.state}">{status.state}</strong><small>{status.message ?? '—'}</small></div>
      <div><span>Phase</span><strong>{status.phase ?? '—'}</strong><small>pass {status.passNumber ?? '—'}</small></div>
      <div><span>Current ID</span><strong>{status.currentId?.toLocaleString() ?? '—'}</strong><small>{status.scanLimit ? `refresh limit ${status.scanLimit.toLocaleString()}` : '—'}</small></div>
      <div><span>Progress</span><strong>{progress === null ? '—' : `${progress.toFixed(1)}%`}</strong><small>{status.state === 'running' ? `${elapsed(status.startedAt)} · ${eta()}` : `completed ${date(status.completedAt)}`}</small></div>
    </section>
    <section class="maintenance-summary metrics">
      <div><span>Requests</span><strong>{status.requests.toLocaleString()}</strong><small>this pass</small></div>
      <div><span>Refreshed</span><strong>{status.refreshed.toLocaleString()}</strong><small>{status.discovered.toLocaleString()} newly discovered</small></div>
      <div><span>Not found</span><strong>{status.notFound.toLocaleString()}</strong><small>{status.skipped.toLocaleString()} cached 404s skipped</small></div>
      <div><span>Errors</span><strong class:negative={status.errors > 0}>{status.errors.toLocaleString()}</strong><small>last request {date(status.lastRequestAt)}</small></div>
    </section>
    <section class="maintenance-timing">
      <span>Started <b>{date(status.startedAt)}</b></span>
      <span>Last success <b>{date(status.lastSuccessAt)}</b></span>
      <span>Next pass <b>{date(status.nextScheduledAt)}</b></span>
      <small>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : ''}</small>
    </section>
    <section class="maintenance-logs">
      <div><h2>Recent log</h2><span>latest 100 lines</span></div>
      <pre>{response?.logs.length ? response.logs.join('\n') : 'No crawler logs yet.'}</pre>
    </section>
  {:else if !error}<div class="muted">Loading crawler status…</div>{/if}
</div>
