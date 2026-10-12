import { env } from '$env/dynamic/public';

const base = (env.PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = ((await response.json()) as { error?: string }).error ?? message; } catch { /* empty */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function queryString(values: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  for (const key of Object.keys(values).sort()) {
    const value = values[key];
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params.toString();
}
