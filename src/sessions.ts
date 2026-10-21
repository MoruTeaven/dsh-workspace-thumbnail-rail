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