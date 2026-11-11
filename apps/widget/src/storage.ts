/**
 * Measure once per store.
 *
 * The shopper's numbers are kept in `localStorage`, so every other product on
 * the same store opens with the fields already filled. Storage is per origin,
 * which makes this per store, and that is the extent of it: there is no
 * attempt to carry numbers from one shop to another, because there is no
 * honest way to do that from inside a page.
 *
 * Every read and write is wrapped, because storage is allowed to be absent
 * (a private window, a blocked third-party context, an old embedded browser),
 * full, or holding something another script wrote. None of those is a reason
 * for the fit check to stop working; they are reasons for it to forget.
 */
import { KEYS } from './types.ts';
import type { Have } from './modal/verdict.ts';

export const STORAGE_KEY = 'fitpath:measurements';

/** The stored shape. Versioned so a future change can refuse an old record. */
interface Stored {
  version: 2;
  have: Have;
  savedAt: string;
}

function isCm(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Only this shape is trusted back out of storage. Anything else is forgotten. */
function sanitise(raw: unknown): Have | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record['version'] !== 2 || typeof record['have'] !== 'object' || record['have'] === null) {
    return undefined;
  }
  const have: Have = {};
  const stored = record['have'] as Record<string, unknown>;
  for (const key of KEYS) {
    const value = stored[key];
    if (isCm(value)) have[key] = value;
  }
  const wall = stored['wallThickness'];
  if (isCm(wall)) have.wallThickness = wall;
  for (const field of ['partsOff', 'partsOn'] as const) {
    const parts = stored[field];
    if (!Array.isArray(parts)) continue;
    const names = parts.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length < 40);
    if (names.length > 0) have[field] = names;
  }
  return have;
}

export interface Storage {
  load(): Have;
  save(have: Have): void;
  clear(): void;
  /** Whether the last operation actually reached storage. For the "saved on this store" note. */
  readonly available: boolean;
}

/**
 * A storage over `localStorage` when it can be reached, and a memory of the
 * current session when it cannot.
 *
 * `backing` is injectable so the tests can hand in a storage that throws, or
 * is full, or is missing entirely, without touching a global.
 */
export function createStorage(backing: () => globalThis.Storage | undefined = defaultBacking): Storage {
  let memory: Have = {};
  let available = false;

  const attempt = <T>(action: (store: globalThis.Storage) => T): T | undefined => {
    try {
      const store = backing();
      if (store === undefined) {
        available = false;
        return undefined;
      }
      const result = action(store);
      available = true;
      return result;
    } catch {
      available = false;
      return undefined;
    }
  };

  return {
    get available(): boolean {
      return available;
    },
    load(): Have {
      // What this session already holds is at least as fresh as anything on
      // disk — a save that failed for want of quota still happened here — so
      // storage is only consulted when there is nothing in hand.
      if (Object.keys(memory).length > 0) return { ...memory };
      const loaded = attempt((store) => {
        const text = store.getItem(STORAGE_KEY);
        if (text === null) return {};
        return sanitise(JSON.parse(text) as unknown);
      });
      if (loaded !== undefined) memory = loaded;
      return { ...memory };
    },
    save(have: Have): void {
      memory = { ...have };
      const record: Stored = { version: 2, have: memory, savedAt: new Date().toISOString() };
      attempt((store) => store.setItem(STORAGE_KEY, JSON.stringify(record)));
    },
    clear(): void {
      memory = {};
      attempt((store) => store.removeItem(STORAGE_KEY));
    },
  };
}

function defaultBacking(): globalThis.Storage | undefined {
  // Reading `localStorage` itself can throw when site data is blocked.
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}
