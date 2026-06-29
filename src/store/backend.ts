import type { TreeData } from '../types';

/**
 * Client for the local SQLite backend (server/index.js, proxied at /api).
 * Every call can throw if the server is unreachable; the store catches those
 * and falls back to the localStorage cache so the app keeps working offline.
 */

const BASE = '/api';

export interface TreeMeta {
  id: string;
  name: string;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Returns true if the DB API is up. Never throws. */
export async function pingBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listTrees(): Promise<TreeMeta[]> {
  return asJson(await fetch(`${BASE}/trees`));
}

export async function fetchTree(id: string): Promise<TreeData> {
  return asJson(await fetch(`${BASE}/trees/${encodeURIComponent(id)}`));
}

export async function createTree(data: TreeData): Promise<string> {
  const out = await asJson<{ id: string }>(
    await fetch(`${BASE}/trees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
  return out.id;
}

export async function putTree(id: string, data: TreeData): Promise<void> {
  await asJson(
    await fetch(`${BASE}/trees/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
}

export async function deleteTreeRemote(id: string): Promise<void> {
  await asJson(
    await fetch(`${BASE}/trees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  );
}
