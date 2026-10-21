import type { SessionListState, SessionSummary, WorkspaceView } from "./types";

/**
 * Session-list projection for the selected workspace.
 *
 * Kept out of the component so it can be tested under node, and so the rules
 * that decide which rows the user sees live in one readable place.
 */

/** Rules that decide which of a workspace's sessions the column lists. */
export interface SessionFilterOptions {
  /** Sessions the Host archived: hidden everywhere. */
  archived: readonly string[];
  /** The session currently open, if any. */
  current: string | undefined;
}

/**
 * The sessions of one workspace, most recently updated first.
 *
 * Archived sessions are excluded, and blank sessions are placeholders for "new
 * conversation": only the one currently open is shown, so a workspace never
 * lists a row that does nothing. Unknown ids (a session the list has not seen
 * yet) are skipped rather than rendered as an empty row.
 *
 * @param workspace - the selected workspace.
 * @param sessions - the live session list state.
 * @param options - archive set and the current selection.
 * @returns the rows to render, newest first.
 */
export function sessionsOfWorkspace(
  workspace: WorkspaceView,
  sessions: SessionListState,
  options: SessionFilterOptions,
): SessionSummary[] {
  const rows: SessionSummary[] = [];
  for (const id of workspace.sessionIds) {
    if (options.archived.includes(id)) continue;
    const summary = sessions.byId[id];
    if (summary === undefined) continue;
    if (summary.blank && summary.id !== options.current) continue;
    rows.push(summary);
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Order rows so pinned ones lead, in the Host's own pin order.
 *
 * The pin set is registry-global and the Host surfaces it ahead of every
 * unpinned session, so the rail mirrors that ordering instead of inventing its
 * own. Within each group the incoming order is preserved, which is the
 * newest-first order the caller already produced.
 *
 * Pin ids that are not among the rows (a pin belonging to another workspace, or
 * one the list has not loaded yet) are ignored rather than pushing rows around.
 *
 * @param rows - the rows in their incoming display order.
 * @param pinned - the Host's pin set, most recently pinned first.
 * @returns a new array, pinned rows first, then the rest.
 */
export function orderWithPins(
  rows: readonly SessionSummary[],
  pinned: readonly string[],
): SessionSummary[] {
  if (pinned.length === 0) return [...rows];
  const rank = (id: string) => {
    const index = pinned.indexOf(id);
    return index === -1 ? pinned.length : index;
  };
  return [...rows].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * Translate a drop into the `insertSessionBefore` arguments the Host wants.
 *
 * The Host's move API is anchor-based: a session lands *above* `beforeSessionId`,
 * or is appended when the anchor is omitted. A pointer drop is a position, so
 * the two halves of the hovered row map onto that form — the upper half means
 * "above this row", the lower half means "above the row after it", which for the
 * last row is the append case.
 *
 * A drop that does not move anything resolves to null, so the caller skips a
 * pointless write. The test is stated as the move itself rather than as index
 * arithmetic: simulate removing the dragged row, inserting it at the drop
 * position, and compare with the order already on screen.
 *
 * @param rows - the rows in their current display order.
 * @param sessionId - the row being dragged.
 * @param targetId - the row the pointer is over.
 * @param lowerHalf - true when the pointer sits in the target's lower half.
 * @returns the move to apply, or null when nothing would change.
 */
export function resolveDropPosition(
  rows: readonly SessionSummary[],
  sessionId: string,
  targetId: string,
  lowerHalf: boolean,
): { sessionId: string; beforeSessionId: string | undefined } | null {
  if (sessionId === targetId) return null;
  const targetIndex = rows.findIndex((row) => row.id === targetId);
  const dragIndex = rows.findIndex((row) => row.id === sessionId);
  if (targetIndex === -1 || dragIndex === -1) return null;

  // Where the dragged row will sit, as an index into the list it leaves behind.
  // The upper half of row i means "at i"; the lower half means "at i + 1", which
  // past the end is the append case. Working in ids keeps the comparison honest.
  const order = rows.map((row) => row.id);
  const withoutDragged = order.filter((id) => id !== sessionId);
  const insertIndex = lowerHalf ? targetIndex + 1 : targetIndex;
  const moved = [
    ...withoutDragged.slice(0, insertIndex),
    sessionId,
    ...withoutDragged.slice(insertIndex),
  ];
  // No reordering: the simulated move reproduces the order already on screen.
  if (moved.length === order.length && moved.every((id, index) => id === order[index])) {
    return null;
  }

  const anchor = order[insertIndex];
  if (anchor === undefined) return { sessionId, beforeSessionId: undefined };
  return { sessionId, beforeSessionId: anchor };
}

/**
 * Which workspace the session column shows.
 *
 * A remembered selection wins, then the workspace owning the current session,
 * then the first workspace — so the column is never empty right after a restart.
 *
 * @param workspaces - the live workspace list, in host display order.
 * @param remembered - the persisted selection, if any.
 * @param currentSessionId - the session currently open, if any.
 * @returns the workspace id to show, or undefined when there are none.
 */
export function resolveSelectedWorkspace(
  workspaces: readonly WorkspaceView[],
  remembered: string | undefined,
  currentSessionId: string | undefined,
): string | undefined {
  if (remembered !== undefined
    && workspaces.some((item) => item.workspaceId === remembered)) {
    return remembered;
  }
  if (currentSessionId !== undefined) {
    const owner = workspaces.find((item) => item.sessionIds.includes(currentSessionId));
    if (owner !== undefined) return owner.workspaceId;
  }
  return workspaces[0]?.workspaceId;
}

/**
 * Filter a workspace's session rows by a title query.
 *
 * Matching is case-insensitive substring matching on the display title: the
 * rail's own filter runs over the list it already has, so it stays instant and
 * works while the Host's content index is still loading. The Host's full-text
 * search (`ctx.sessions.search`) is a separate, deeper surface that also looks
 * inside message bodies; this one is only about the titles in front of the user.
 *
 * A blank query returns the rows unchanged, so the caller can pass the query
 * straight through without a special case.
 *
 * @param rows - the rows to filter, in their display order.
 * @param query - what the user typed; trimmed before matching.
 * @returns the matching rows, same order.
 */
export function filterByTitle(rows: readonly SessionSummary[], query: string): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) => row.displayTitle.toLowerCase().includes(needle));
}