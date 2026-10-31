import { readFile } from 'node:fs/promises';
import type { CrawlerStatus, CrawlerStatusResponse } from '@youranimelist/shared';

const unavailable: CrawlerStatus = {
  state: 'unavailable', phase: null, passNumber: null, currentId: null, scanLimit: null,
  requests: 0, refreshed: 0, discovered: 0, notFound: 0, errors: 0, skipped: 0,
  startedAt: null, completedAt: null, lastRequestAt: null, lastSuccessAt: null,
  nextScheduledAt: null, message: 'Crawler status is not available.'
};

async function status() {
  const path = process.env.CRAWLER_STATUS_PATH ?? '/data/crawler-status.json';
  try { return JSON.parse(await readFile(path, 'utf8')) as CrawlerStatus; } catch { return unavailable; }
}

async function logs() {
  const path = process.env.CRAWLER_LOG_PATH ?? '/data/crawler.log';
  try { return (await readFile(path, 'utf8')).trimEnd().split('\n').slice(-100); } catch { return []; }
}

export async function getCrawlerStatus(includeLogs = true): Promise<CrawlerStatusResponse> {
  const [current, recent] = await Promise.all([status(), includeLogs ? logs() : Promise.resolve([])]);
  return { status: current, logs: recent };
}
