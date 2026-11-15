/* storageService — the ONLY place client persistence happens (brief §20).
   Components and the store never touch localStorage directly; they call
   this service, so the backing store can later move (e.g. to an account
   sync service) without touching UI code.
 *
   What persists where:
   - Durable user data (wardrobe, outfits, analyses, feedback) lives in
     the artifact database via server actions — it already survives
     refresh, sign-out on another device, everything. That IS the
     persistence layer for the wardrobe itself.
   - This service persists only client-session state: the signed-in
     profile stub, theme, user preferences and UI state.
 *
   Safety: the artifact runs in a sandboxed iframe where some webviews
   throw a SecurityError on ANY localStorage access. Every call is
   guarded and falls back to an in-memory store, so a blocked-storage
   device degrades to session-only persistence instead of a blank page. */

const memoryStore = new Map<string, string>();

export const storageService = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key) ?? memoryStore.get(key) ?? null; }
    catch { return memoryStore.get(key) ?? null; }
  },
  set(key: string, value: string): void {
    memoryStore.set(key, value);
    try { window.localStorage.setItem(key, value); } catch { /* in-memory copy already kept */ }
  },
  remove(key: string): void {
    memoryStore.delete(key);
    try { window.localStorage.removeItem(key); } catch { /* nothing else to do */ }
  },
  getJSON<T>(key: string): T | null {
    const raw = storageService.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  },
  setJSON(key: string, value: unknown): void {
    try { storageService.set(key, JSON.stringify(value)); } catch { /* unserializable → skip */ }
  },
};

/** Well-known storage keys — one place, no string literals in components. */
export const STORAGE_KEYS = {
  user: "ww-user",
  theme: "ww-theme",
  preferences: "ww-preferences",
  uiState: "ww-ui",
} as const;
