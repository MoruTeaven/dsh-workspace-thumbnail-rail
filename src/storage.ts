import type { RailPreferences, ThumbnailMap, ThumbnailRecord } from "./types";

/**
 * Browser-side persistence.
 *
 * DSH's browser half has no key-value service (`ctx.kv` does not exist) and no
 * Host RPC that reads files, so localStorage is the only durable channel — the
 * same trade the shipped sibling plugin makes. Two keys are kept apart on
 * purpose: thumbnails are bulky data URLs, while preferences are read on every
 * rail mount. A quota failure on one must never take the other down, so each
 * key is written independently and swallowed on failure.
 *
 * Cross-page sync rides the native `storage` event: it fires in every page
 * EXCEPT the one that wrote, which is exactly the semantics needed here, so no
 * de-duplication is required.
 */

const THUMBNAIL_KEY = "dsh.wsr.thumbnails.v1";
const PREFS_KEY = "dsh.wsr.prefs.v1";
const RUNTIME_KEY = "dsh.wsr.runtime.v1";
const DIAG_KEY = "dsh.wsr.diag.v1";

/**
 * Record which build is live in this page.
 *
 * DSH client plugins are loaded as page modules, so after rebuilding the bundle
 * the open window keeps running the old code until it reloads. This stamp turns
 * that invisible state into an inspectable one: "which version actually ran?"
 * is answerable from storage alone, without opening the window (or asking the
 * user to hover a tooltip).
 *
 * @param version - the build's package version.
 */
export function markRuntime(version: string): void {
  writeJson(RUNTIME_KEY, { version, at: Date.now() });
}

/**
 * Publish the flat-list scoping state for remote diagnosis.
 *
 * The scoping hides rows through unmanaged DOM attributes, so a silent failure
 * (wrong mode, no rows matched, an owner map that covers nothing) is invisible
 * from outside the window. This snapshot keeps every input of that decision
 * readable from storage, the same way {@link markRuntime} is.
 *
 * @param state - the values the scoping effect last saw.
 */
export function markScopeDiag(state: {
  mode: string;
  scoped: boolean;
  scopeId: string | undefined;
  activeWorkspaceId: string | undefined;
  recentWorkspaceId: string | undefined;
  workspaces: number;
  owners: number;
  rows: number;
  hidden: number;
}): void {
  writeJson(DIAG_KEY, { ...state, at: Date.now() });
}

/**
 * localStorage can be absent (SSR / tests) and can throw on access in private
 * modes. Every call is guarded so a broken storage never breaks the rail.
 */
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** @returns whether the write landed (false = quota exceeded or storage absent). */
function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate one stored thumbnail and rebuild it as a typed record.
 *
 * The v1 shape was image-only with no `kind`; absence means an image. A text
 * record must carry non-empty text and color. One bad entry is dropped rather
 * than poisoning the whole map.
 *
 * @param value - the raw value read from storage.
 * @returns the typed record, or null when the entry is unusable.
 */
export function normalizeThumbnail(value: unknown): ThumbnailRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt)) return null;
  if (raw.kind === "text") {
    if (typeof raw.text === "string" && raw.text !== ""
      && typeof raw.color === "string" && raw.color !== "") {
      return { kind: "text", text: raw.text, color: raw.color, updatedAt: raw.updatedAt };
    }
    return null;
  }
  if (typeof raw.src === "string" && raw.src.startsWith("data:image/")
    && typeof raw.bytes === "number" && Number.isFinite(raw.bytes)) {
    return { kind: "image", src: raw.src, bytes: raw.bytes, updatedAt: raw.updatedAt };
  }
  return null;
}

/** Load the whole thumbnail map, dropping entries that do not validate. */
export function loadThumbnails(): ThumbnailMap {
  const raw = readJson<Record<string, unknown>>(THUMBNAIL_KEY, {});
  const map: ThumbnailMap = {};
  for (const [workspaceId, value] of Object.entries(raw)) {
    const record = normalizeThumbnail(value);
    if (record !== null) map[workspaceId] = record;
  }
  return map;
}

/** Read one workspace's thumbnail, or undefined when it has none. */
export function loadThumbnail(workspaceId: string): ThumbnailRecord | undefined {
  return loadThumbnails()[workspaceId];
}

/** Persist the whole map. @returns whether it landed. */
export function saveThumbnails(map: ThumbnailMap): boolean {
  return writeJson(THUMBNAIL_KEY, map);
}

/** Default preferences: a 72px rail, shown, every parent expanded, titles on. */
export const DEFAULT_PREFS: RailPreferences = { width: 72, enabled: true, collapsed: [], iconsOnly: false };

/** Clamp the persisted width into a range the frame can always accommodate. */
const MIN_WIDTH = 48;
const MAX_WIDTH = 160;

/** Load rail preferences, clamping a corrupt or out-of-range width back into range. */
export function loadPrefs(): RailPreferences {
  const raw = readJson<Partial<RailPreferences>>(PREFS_KEY, {});
  const width = typeof raw.width === "number" && Number.isFinite(raw.width)
    ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(raw.width)))
    : DEFAULT_PREFS.width;
  const collapsed = Array.isArray(raw.collapsed)
    ? raw.collapsed.filter((id): id is string => typeof id === "string" && id !== "")
    : [];
  return {
    width,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_PREFS.enabled,
    collapsed: [...new Set(collapsed)],
    iconsOnly: raw.iconsOnly === true,
  };
}

/** Persist rail preferences. @returns whether it landed. */
export function savePrefs(prefs: RailPreferences): boolean {
  return writeJson(PREFS_KEY, prefs);
}

/** Remove one workspace's thumbnail. @returns whether it landed. */
export function removeThumbnail(workspaceId: string): boolean {
  const map = loadThumbnails();
  delete map[workspaceId];
  return saveThumbnails(map);
}

/**
 * Subscribe to cross-page thumbnail changes.
 *
 * The `storage` event does not fire in the writing page, so this callback only
 * ever reports OTHER pages' edits — no de-duplication needed.
 * @returns an unsubscribe function.
 */
export function onThumbnailsChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: StorageEvent) => {
    if (event.key === null || event.key === THUMBNAIL_KEY) handler();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** Subscribe to cross-page preference changes. @returns an unsubscribe function. */
export function onPrefsChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: StorageEvent) => {
    if (event.key === null || event.key === PREFS_KEY) handler();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
