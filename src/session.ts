/**
 * Resolving the conversation the main view is showing.
 *
 * The Session list snapshot has no `current` field. The shipped browser derives
 * the current Session from the retention projection instead: the Session the
 * main view holds is the one whose `retainedBy.mainView` count is positive
 * (dsh-client-ui-workspace, SessionTree/FlatList `currentId`). Everything the
 * rail wants to know about "where the user is" — the active Workspace, the
 * default scope of the single-list view — hangs off that answer, so it lives in
 * one tested place rather than in the component.
 *
 * The projections below are the subset the rail reads; every field is optional
 * so a partially-populated snapshot degrades instead of throwing.
 */

/** One Session summary, as the list snapshot projects it. */
export interface SessionSummaryView {
  id: string;
  updatedAt?: number;
  blank?: boolean;
  running?: boolean;
  /**
   * Reference counts by retention source. The main view keeps the open
   * conversation retained under `mainView`; a panel-opened conversation is
   * retained under its own source and must not be mistaken for the main one.
   */
  retainedBy?: Readonly<Record<string, number>>;
}

/**
 * Find the conversation the main view is showing.
 *
 * A blank conversation counts: a brand-new conversation is exactly what the
 * user is looking at, and the single-list scope must follow it to its
 * Workspace.
 *
 * @param byId - the Session list's id → summary projection.
 * @returns the current Session id, or undefined when nothing is retained by
 *   the main view (home screen, or the projection has not caught up yet).
 */
export function currentSessionId(
  byId: Readonly<Record<string, SessionSummaryView | undefined>>,
): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const summary of Object.values(byId)) {
    if (summary === undefined) continue;
    const count = summary.retainedBy?.mainView ?? 0;
    if (count <= bestCount) continue;
    bestCount = count;
    best = summary.id;
  }
  return best;
}

/**
 * Resolve which Workspace owns a Session.
 *
 * The browser half has no Session → Workspace service; scanning the Workspace
 * projection's `sessionIds` is the shipped precedent (the workspace browser's
 * own `owningGroupKey`).
 *
 * @param workspaces - the projected Workspace list.
 * @param sessionId - the Session to locate.
 * @returns the owning Workspace id, or undefined when no Workspace lists it
 *   (a subagent Session, a conversation still being filed, or no session).
 */
export function workspaceOfSession(
  workspaces: readonly { workspaceId: string; sessionIds: readonly string[] }[],
  sessionId: string | undefined,
): string | undefined {
  if (sessionId === undefined) return undefined;
  return workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))?.workspaceId;
}
