/**
 * A minimal in-memory stand-in for the slice of `chrome.*` the extension uses.
 *
 * The Verification Contract forbids mocking GlassFrog at the network boundary,
 * but Chrome's own APIs have no such constraint — they are the platform, not
 * the system under test. This fake exists so storage, pending-capture, and
 * draft behaviour can be exercised as real code paths under `node --test`.
 */

export interface FakeStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  setAccessLevel?(options: { accessLevel: string }): Promise<void>;
}

export interface FakeChrome {
  storage: {
    local: FakeStorageArea;
    onChanged: {
      addListener(listener: StorageListener): void;
      removeListener(listener: StorageListener): void;
    };
  };
  /** Everything currently stored, for assertions about slot occupancy. */
  __dump(): Record<string, unknown>;
}

type StorageListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

export interface FakeChromeOptions {
  /**
   * Whether `chrome.storage.local.setAccessLevel` exists. Older Chrome builds
   * omit it on `local`, which is the case `enableTrustedContexts` guards for.
   */
  withSetAccessLevel?: boolean;
}

export function createFakeChrome(options: FakeChromeOptions = {}): FakeChrome {
  const store = new Map<string, unknown>();
  const listeners = new Set<StorageListener>();

  const notify = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void => {
    for (const listener of listeners) listener(changes, 'local');
  };

  const local: FakeStorageArea = {
    async get(keys) {
      if (keys === undefined || keys === null) return Object.fromEntries(store);
      const wanted = typeof keys === 'string' ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const key of wanted) {
        if (store.has(key)) out[key] = store.get(key);
      }
      return out;
    },
    async set(items) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: store.get(key), newValue: value };
        // Structured-clone the value so a caller mutating its own object after
        // writing cannot retroactively change what storage holds — the real
        // API serialises, and a test that missed this would pass falsely.
        store.set(key, structuredClone(value));
      }
      notify(changes);
    },
    async remove(keys) {
      const doomed = typeof keys === 'string' ? [keys] : keys;
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of doomed) {
        if (!store.has(key)) continue;
        changes[key] = { oldValue: store.get(key), newValue: undefined };
        store.delete(key);
      }
      if (Object.keys(changes).length > 0) notify(changes);
    },
    async clear() {
      store.clear();
    },
  };

  if (options.withSetAccessLevel !== false) {
    local.setAccessLevel = async () => undefined;
  }

  return {
    storage: {
      local,
      onChanged: {
        addListener: (listener) => void listeners.add(listener),
        removeListener: (listener) => void listeners.delete(listener),
      },
    },
    __dump: () => Object.fromEntries(store),
  };
}

/**
 * Installs the fake on `globalThis.chrome` and returns it along with a restore
 * function, so a suite can leave the global as it found it.
 */
export function installFakeChrome(options: FakeChromeOptions = {}): {
  chrome: FakeChrome;
  restore: () => void;
} {
  const previous = (globalThis as { chrome?: unknown }).chrome;
  const fake = createFakeChrome(options);
  (globalThis as { chrome?: unknown }).chrome = fake;
  return {
    chrome: fake,
    restore: () => {
      (globalThis as { chrome?: unknown }).chrome = previous;
    },
  };
}
