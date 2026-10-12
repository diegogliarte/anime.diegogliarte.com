import { browser } from '$app/environment';
import type { UserAnime, UserListResponse } from '@youranimelist/shared';
import { api } from '$lib/data/api';
import { readCache, writeCache } from '$lib/data/cache';

const SETTINGS = 'youranimelist:settings:v1';

type Settings = { username: string; lastFranchiseId: number | null };

class AppState {
  username = $state('');
  loadedUsername = $state('');
  lastFranchiseId = $state<number | null>(null);
  userList = $state<UserAnime[]>([]);
  loadingUser = $state(false);
  userError = $state<string | null>(null);
  restored = $state(false);

  constructor() { if (browser) void this.restore(); }

  private saveSettings() {
    if (!browser) return;
    const settings: Settings = { username: this.username, lastFranchiseId: this.lastFranchiseId };
    localStorage.setItem(SETTINGS, JSON.stringify(settings));
  }

  async restore() {
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Partial<Settings>;
      this.username = settings.username ?? '';
      this.lastFranchiseId = settings.lastFranchiseId ?? null;
      if (this.username) {
        const cached = await readCache<UserListResponse>(`user:${this.username.toLowerCase()}`);
        if (cached) {
          this.userList = cached.value.items;
          this.loadedUsername = cached.value.username;
        }
      }
    } finally { this.restored = true; }
  }

  async loadUser(username = this.username) {
    const clean = username.trim();
    if (!clean) { this.userError = 'Enter a MyAnimeList username.'; return; }
    this.username = clean;
    this.loadingUser = true;
    this.userError = null;
    this.saveSettings();
    try {
      const result = await api<UserListResponse>(`/v1/users/${encodeURIComponent(clean)}/list`);
      this.userList = result.items;
      this.loadedUsername = result.username;
      await writeCache(`user:${clean.toLowerCase()}`, result, 24 * 60 * 60_000);
    } catch (error) {
      this.userError = error instanceof Error ? error.message : 'Unable to load list.';
    } finally { this.loadingUser = false; }
  }

  setLastFranchise(id: number) { this.lastFranchiseId = id; this.saveSettings(); }
}

export const appState = new AppState();
