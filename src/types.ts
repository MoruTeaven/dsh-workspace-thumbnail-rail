/**
 * Types for the workspace thumbnail rail.
 *
 * Everything crossing the storage boundary is plain JSON: the browser half has
 * no Host RPC for reading files, so a thumbnail is a compressed data URL the
 * user picks in the page. The shapes below mirror the Host's wire projection
 * for the subset the rail actually reads — the plugin never imports DSH types
 * (a client bundle cannot import anything outside the platform module table).
 */

/** Wire projection of one workspace, as the rail reads it. */
export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** The workspace-list projection the rail subscribes to. */
export interface WorkspaceListState {
  items: readonly WorkspaceView[];
  archivedSessionIds: readonly string[];
  state: "idle" | "loading" | "error";
  baselinesReady: boolean;
  recentWorkspaceId: string | undefined;
}

/** The session-list projection the rail reads to find the current session. */
export interface SessionListState {
  current: string | undefined;
  byId: Record<string, { id: string; updatedAt: number; blank?: boolean } | undefined>;
}

/**
 * One stored thumbnail.
 *
 * `src` is a data URL. `bytes` is the decoded payload size, kept so the storage
 * budget can be enforced without re-parsing every data URL on each write.
 */
export interface ThumbnailRecord {
  /** Compressed data URL (image/webp, fallback image/jpeg or image/png). */
  src: string;
  /** Decoded byte length of `src`. */
  bytes: number;
  /** Epoch millis the thumbnail was set, for stable ordering by recency. */
  updatedAt: number;
}

/** The whole persisted map: workspace id → its thumbnail. */
export type ThumbnailMap = Record<string, ThumbnailRecord>;

/** Rail geometry: the width of the inserted column, in px. */
export interface RailConfig {
  /** Column width in px. 0 hides the rail without unmounting its subtree. */
  width: number;
  /** Whether the rail is visible. */
  enabled: boolean;
}

/** Persisted rail preferences (separate from thumbnails, which are bulky). */
export interface RailPreferences {
  /** User-set column width. */
  width: number;
  /** Whether the rail is shown at all. */
  enabled: boolean;
}

/** What a right-click menu action asks the rail to do. */
export type RailMenuAction =
  | { kind: "set"; workspaceId: string }
  | { kind: "remove"; workspaceId: string }
  | { kind: "clear"; workspaceId: string };