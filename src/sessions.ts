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