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
  /** Registry-global pin set, most recently pinned first. */
  pinnedSessionIds: readonly string[];
  state: "idle" | "loading" | "error";
  baselinesReady: boolean;
  recentWorkspaceId: string | undefined;
}

/** The subset of one session summary the rail renders. */
export interface SessionSummary {
  id: string;
  displayTitle: string;
  updatedAt: number;
  running: boolean;
  /** Empty-log bit: only the selected blank entry is ever shown. */
  blank: boolean;
}

/** The session-list projection the rail subscribes to. */
export interface SessionListState {
  ids: string[];
  byId: Record<string, SessionSummary | undefined>;
  current: string | undefined;
}

/** One Host full-text search hit (ctx.sessions.search result item). */
export interface SessionSearchHit {
  /** Session the hit belongs to. */
  sessionId: string;
  /** Matched context around the hit; may be empty. */
  snippet: string;
}

/** The outcome of a Host full-text search the rail requested. */
export interface SessionSearchResult {
  /** Hits in Host rank order, bounded by the Host's limit. */
  items: SessionSearchHit[];
  /** Whether the Host has more hits than it returned. */
  hasMore: boolean;
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

/** Persisted rail preferences (separate from thumbnails, which are bulky). */
export interface RailPreferences {
  /** User-set column width. */
  width: number;
  /** Whether the rail is shown at all. */
  enabled: boolean;
  /** Workspace whose sessions the list column shows, restored across restarts. */
  selectedWorkspaceId?: string;
}

/** One row of the Host's directory listing (a child directory or a crumb). */
export interface DirectoryEntry {
  /** Base name shown in a browser row; a root crumb carries its full path. */
  name: string;
  /** Absolute host path — clients never join path segments themselves. */
  path: string;
  /** Hidden by the host platform's convention (dot-prefixed on POSIX). */
  hidden: boolean;
}

/** One level of the Host's filesystem, as the add-workspace browser reads it. */
export interface DirectoryListing {
  /** The listed directory's absolute path. */
  path: string;
  /** The host account's home directory, rooting the crumb chain. */
  home: string;
  /** Ancestor chain from the filesystem root to `path` inclusive; jump targets. */
  crumbs: DirectoryEntry[];
  /** Direct child directories, name-sorted; symlinks to directories included. */
  entries: DirectoryEntry[];
  /** True when the backend cut `entries` at its bound; the tail is missing. */
  truncated: boolean;
}