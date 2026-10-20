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

/** Reject anything that is not a usable thumbnail record, so one bad entry cannot poison the map. */
function isThumbnailRecord(value: unknown): value is ThumbnailRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ThumbnailRecord>;
  return typeof record.src === "string" && record.src.startsWith("data:image/")
    && typeof record.bytes === "number" && Number.isFinite(record.bytes)
    && typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt);
}

/** Load the whole thumbnail map, dropping entries that do not validate. */
export function loadThumbnails(): ThumbnailMap {
  const raw = readJson<Record<string, unknown>>(THUMBNAIL_KEY, {});
  const map: ThumbnailMap = {};
  for (const [workspaceId, value] of Object.entries(raw)) {
    if (isThumbnailRecord(value)) map[workspaceId] = value;
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

/** Default preferences: a 72px rail, shown. */
export const DEFAULT_PREFS: RailPreferences = { width: 72, enabled: true };

/** Clamp the persisted width into a range the frame can always accommodate. */
const MIN_WIDTH = 48;
const MAX_WIDTH = 160;

/** Load rail preferences, clamping a corrupt or out-of-range width back into range. */
export function loadPrefs(): RailPreferences {
  const raw = readJson<Partial<RailPreferences>>(PREFS_KEY, {});
  const width = typeof raw.width === "number" && Number.isFinite(raw.width)
    ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(raw.width)))
    : DEFAULT_PREFS.width;
  const prefs: RailPreferences = {
    width,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_PREFS.enabled,
  };
  // A selection is only useful while it still names a workspace, but that is
  // re-checked on read (resolveSelectedWorkspace), so persist it verbatim here.
  if (typeof raw.selectedWorkspaceId === "string") {
    prefs.selectedWorkspaceId = raw.selectedWorkspaceId;
  }
  return prefs;
}

/** Persist rail preferences. @returns whether it landed. */
export function savePrefs(prefs: RailPreferences): boolean {
  return writeJson(PREFS_KEY, prefs);
}