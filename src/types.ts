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

/**
 * The workspace-list projection the rail subscribes to.
 *
 * Field names mirror the shipped snapshot (dsh-client-ui-workspace reads
 * `items` / `archivedSessionIds` / `pinnedSessionIds` from it). There is no
 * "recent workspace" member: the list of "what the user is in" comes from the
 * Session projection instead — see `currentSessionId` in session.ts.
 */
export interface WorkspaceListState {
  items: readonly WorkspaceView[];
  archivedSessionIds: readonly string[];
}

/**
 * The session-list projection the rail reads.
 *
 * The snapshot is `{ ids, byId, phase, projectionsBySession }` — there is no
 * `current` member; the visible conversation is derived from `retainedBy`
 * (session.ts). Subagent sessions are present in `byId` but belong to no
 * Workspace, which the owner scan tolerates.
 */
export interface SessionListState {
  byId: Record<
    string,
    {
      id: string;
      updatedAt: number;
      blank?: boolean;
      running?: boolean;
      retainedBy?: Readonly<Record<string, number>>;
    } | undefined
  >;
}

/**
 * One session's live UI status, as the slot-standard `useSessionStatus` hook
 * projects it. Field names mirror the official browser's consumption
 * (dsh-client-ui-workspace's sessionNode); every field is optional so a
 * partially-populated entry still aggregates.
 */
export interface SessionUiStatus {
  /** Live turn activity. */
  running?: boolean;
  /** Number of live subagent children. */
  runningSubagentCount?: number;
  /** An interaction awaiting the user (approval / plan-review / question). */
  pendingInteraction?: { kind?: string } | null;
  /** A finished turn the user has not seen yet. */
  completionUnread?: boolean;
}

/**
 * A thumbnail set by the user: either a compressed image or a custom text
 * tile ("文字" mode spells whatever the user typed on a color they picked).
 *
 * The v1 storage shape was image-only and had no `kind`; the loader treats a
 * missing `kind` as an image record, so old maps keep working untouched.
 */
export interface ImageThumbnailRecord {
  kind: "image";
  /** Compressed data URL (image/webp, fallback image/jpeg or image/png). */
  src: string;
  /** Decoded byte length of `src`. */
  bytes: number;
  /** Epoch millis the thumbnail was set, for stable ordering by recency. */
  updatedAt: number;
}

/** A user-typed text tile: 1–4 characters on a user-picked fill. */
export interface TextThumbnailRecord {
  kind: "text";
  /** The glyphs to spell, as typed (already trimmed; 1–4 characters). */
  text: string;
  /** A CSS color for the tile fill. */
  color: string;
  /** Epoch millis the thumbnail was set. */
  updatedAt: number;
}

/** One stored thumbnail: an image or a text tile. */
export type ThumbnailRecord = ImageThumbnailRecord | TextThumbnailRecord;

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
  /**
   * Workspace ids whose children are folded in the rail tree.
   *
   * Collapsed by exception, so a newly added Workspace starts expanded and the
   * stored set never accumulates stale "expanded" entries.
   */
  collapsed: string[];
  /**
   * Whether the rail shows only the tiles (no title rows).
   *
   * Fold carets stay — they move onto the tile's corner — so the tree keeps
   * its fold controls without a label row to host them.
   */
  iconsOnly: boolean;
}

/** What a right-click menu action asks the rail to do. */
export type RailMenuAction =
  | { kind: "set"; workspaceId: string }
  | { kind: "remove"; workspaceId: string }
  | { kind: "clear"; workspaceId: string };
