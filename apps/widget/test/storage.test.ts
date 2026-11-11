import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, createStorage } from '../src/storage.ts';

/** A minimal in-memory Storage, with hooks to make it misbehave. */
function fakeStorage(options: { throwOn?: 'get' | 'set' | 'all' } = {}): globalThis.Storage {
  const map = new Map<string, string>();
  const boom = (): never => {
    throw new Error('QuotaExceededError');
  };
  return {
    get length(): number {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => {
      if (options.throwOn === 'get' || options.throwOn === 'all') boom();
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (options.throwOn === 'set' || options.throwOn === 'all') boom();
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe('storage', () => {
  it('round-trips measurements, and only the fields it knows', () => {
    const backing = fakeStorage();
    const storage = createStorage(() => backing);
    storage.save({ doorWidth: 90, doorHeight: 200, alongWall: 150, wallThickness: 25, partsOff: ['legs'] });
    const loaded = createStorage(() => backing).load();
    expect(loaded).toEqual({ doorWidth: 90, doorHeight: 200, alongWall: 150, wallThickness: 25, partsOff: ['legs'] });
    expect(storage.available).toBe(true);
  });

  it('starts empty when nothing was ever saved', () => {
    const storage = createStorage(() => fakeStorage());
    expect(storage.load()).toEqual({});
  });

  it('keeps working in memory when storage is missing entirely', () => {
    const storage = createStorage(() => undefined);
    storage.save({ doorWidth: 85 });
    expect(storage.load()).toEqual({ doorWidth: 85 });
    expect(storage.available).toBe(false);
  });

  it('keeps working in memory when every access throws', () => {
    const storage = createStorage(() => fakeStorage({ throwOn: 'all' }));
    expect(storage.load()).toEqual({});
    storage.save({ doorWidth: 85 });
    expect(storage.load()).toEqual({ doorWidth: 85 });
    expect(storage.available).toBe(false);
  });

  it('a full storage loses the save but not the session', () => {
    const storage = createStorage(() => fakeStorage({ throwOn: 'set' }));
    storage.save({ doorWidth: 85 });
    expect(storage.load()).toEqual({ doorWidth: 85 });
  });

  it('forgets a record it does not recognise rather than trusting it', () => {
    const backing = fakeStorage();
    backing.setItem(STORAGE_KEY, 'not json');
    expect(createStorage(() => backing).load()).toEqual({});

    // The previous shape, from before the form asked for both numbers at once.
    backing.setItem(STORAGE_KEY, JSON.stringify({ version: 1, have: { doorWidth: { value: 90, exact: true } } }));
    expect(createStorage(() => backing).load()).toEqual({});

    backing.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        have: {
          doorWidth: 'ninety',
          doorHeight: -5,
          roomDepth: { value: 300, exact: true },
          alongWall: 200,
          wallThickness: 'thick',
          partsOff: ['legs', 7, ''],
          partsOn: 'legs',
          somethingElse: 1,
        },
      }),
    );
    expect(createStorage(() => backing).load()).toEqual({ alongWall: 200, partsOff: ['legs'] });
  });

  it('clear forgets everywhere', () => {
    const backing = fakeStorage();
    const storage = createStorage(() => backing);
    storage.save({ doorWidth: 90 });
    storage.clear();
    expect(storage.load()).toEqual({});
    expect(backing.getItem(STORAGE_KEY)).toBeNull();
  });
});
