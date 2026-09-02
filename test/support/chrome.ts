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

export interface FakeNotification {
  id: string;
  options: { title?: string; message?: string; type?: string; iconUrl?: string };
}

export interface FakeChrome {
  storage: {
    local: FakeStorageArea;
    onChanged: {
      addListener(listener: StorageListener): void;
      removeListener(listener: StorageListener): void;
    };
  };
  action: {
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    getBadgeText(details?: Record<string, unknown>): Promise<string>;
  };
  notifications: {
    create(id: string, options: FakeNotification['options']): Promise<string>;
  };
  alarms: {
    create(name: string, info: { delayInMinutes?: number }): Promise<void>;
    clear(name: string): Promise<boolean>;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
  commands: {
    getAll(): Promise<Array<{ name?: string; shortcut?: string; description?: string }>>;
    onCommand: { addListener(listener: (command: string) => void): void };
  };
  runtime: {
    getManifest(): { commands?: Record<string, unknown> };
    getURL(path: string): string;
    openOptionsPage(): Promise<void>;
    /** Present only when imitating Safari — Chrome extensions get this from a
     * separately-installed host, which this extension never has. */
    sendNativeMessage?(application: string, message: object): Promise<unknown>;
    lastError?: { message: string };
    // Registered by src/background.ts at module evaluation. Present so the
    // module can be imported at all; no test drives them through Chrome, since
    // the flows they wrap are exported and called directly.
    onMessage: { addListener(listener: (...args: unknown[]) => unknown): void };
    onStartup: { addListener(listener: () => void): void };
    onInstalled: { addListener(listener: () => void): void };
  };
  tabs: {
    query(info: Record<string, unknown>): Promise<chrome.tabs.Tab[]>;
  };
  scripting: {
    executeScript(injection: { target: { tabId: number }; func: () => unknown }): Promise<
      Array<{ result?: unknown }>
    >;
  };
  /** Everything currently stored, for assertions about slot occupancy. */
  __dump(): Record<string, unknown>;
  /** What the extension surfaced, in order. */
  __notifications: FakeNotification[];
  __badge: { text: string; color?: string };
  __alarms: Map<string, { delayInMinutes?: number }>;
  /** Set by a test to control what chrome.commands.getAll() reports. */
  __boundCommands: Array<{ name?: string; shortcut?: string }>;
  __manifestCommands: Record<string, unknown>;
  __tabs: chrome.tabs.Tab[];
  /** What chrome.scripting.executeScript reports as the page selection. */
  __selection: string;
  /** True if anything took focus — nothing in the capture path may (R14). */
  __focusTaken: boolean;
  __optionsPageOpened: number;
  /** Everything handed to the containing app, in order. */
  __nativeMessages: Array<{ application: string; message: unknown }>;
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

  /**
   * Which extension host to imitate. Safari serves resources from a different
   * scheme, implements no `chrome.notifications`, and can reach a containing
   * app — the three differences src/platform.ts detects.
   */
  host?: 'chrome' | 'safari';

  /**
   * How the containing app behaves. `absent` omits `sendNativeMessage`
   * entirely, which is what Chrome looks like and what Safari looks like before
   * the app has ever run.
   */
  nativeApp?: 'absent' | 'delivers' | 'declines' | 'throws';
}

export function createFakeChrome(options: FakeChromeOptions = {}): FakeChrome {
  const host = options.host ?? 'chrome';
  const nativeApp = options.nativeApp ?? 'absent';
  const scheme = host === 'safari' ? 'safari-web-extension' : 'chrome-extension';
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

  const fake: FakeChrome = {
    storage: {
      local,
      onChanged: {
        addListener: (listener) => void listeners.add(listener),
        removeListener: (listener) => void listeners.delete(listener),
      },
    },
    action: {
      async setBadgeText(details) {
        fake.__badge.text = details.text;
      },
      async setBadgeBackgroundColor(details) {
        fake.__badge.color = details.color;
      },
      async getBadgeText() {
        return fake.__badge.text;
      },
    },
    notifications: {
      async create(id, options) {
        fake.__notifications.push({ id, options });
        return id;
      },
    },
    alarms: {
      async create(name, info) {
        fake.__alarms.set(name, info);
      },
      async clear(name) {
        return fake.__alarms.delete(name);
      },
      onAlarm: { addListener: () => undefined },
    },
    commands: {
      async getAll() {
        return fake.__boundCommands;
      },
      onCommand: { addListener: () => undefined },
    },
    runtime: {
      getManifest: () => ({ commands: fake.__manifestCommands }),
      getURL: (path) => `${scheme}://fake/${path}`,
      async openOptionsPage() {
        fake.__optionsPageOpened += 1;
      },
      onMessage: { addListener: () => undefined },
      onStartup: { addListener: () => undefined },
      onInstalled: { addListener: () => undefined },
    },
    scripting: {
      // Returns whatever __selection is set to, so the shortcut path can be
      // exercised. The real API is the only way to read a selection, and
      // src/capture.ts treats a throw here as "no selection" rather than as a
      // capture failure.
      async executeScript() {
        return [{ result: fake.__selection }];
      },
    },
    tabs: {
      async query() {
        return fake.__tabs;
      },
    },
    __dump: () => Object.fromEntries(store),
    __notifications: [],
    __badge: { text: '' },
    __alarms: new Map(),
    __boundCommands: [],
    __manifestCommands: {},
    __tabs: [],
    __selection: '',
    __focusTaken: false,
    __optionsPageOpened: 0,
    __nativeMessages: [],
  };

  // Safari implements no notifications API at all. Deleting it rather than
  // stubbing it is the point: `hasNotifications()` must see genuine absence,
  // because a stub that resolves would let the chain's first link pass on a
  // platform where it cannot.
  if (host === 'safari') {
    delete (fake as { notifications?: unknown }).notifications;
  }

  if (nativeApp !== 'absent') {
    fake.runtime.sendNativeMessage = async (application, message) => {
      fake.__nativeMessages.push({ application, message });
      if (nativeApp === 'throws') throw new Error('no containing app');
      return { delivered: nativeApp === 'delivers' };
    };
  }

  return fake;
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
