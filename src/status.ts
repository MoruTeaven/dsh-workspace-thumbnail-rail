/**
 * Workspace run state, aggregated from its sessions' live status.
 *
 * The slot-standard `useSessionStatus` hook projects one Map of per-Session UI
 * status (`running`, `pendingInteraction`, `completionUnread`,
 * `runningSubagentCount`); the Host's session list itself carries a `running`
 * boolean, which the official browser uses as the fallback
 * (dsh-client-ui-workspace's runningChildCount). This module folds a
 * workspace's sessions into ONE ring color with the official precedence:
 * a pending interaction outranks live activity, which outranks an unread
 * completion; idle has no ring at all.
 *
 * The colors live in styles.ts, keyed by the three states below — green,
 * yellow and blue, matching the theme's success / warn / info steps.
 */

/** The aggregated run state of one workspace. */
export type WorkspaceRunState = "running" | "attention" | "done";

/** The per-Session status shape the aggregation reads. */
export interface SessionStatusInput {
  /** Live turn activity (the session list's `running` also fits). */
  running?: boolean;
  /** Number of live subagent children; any count above zero is activity. */
  runningSubagentCount?: number;
  /** An interaction awaiting the user, with the official kinds below. */
  pendingInteraction?: { kind?: string } | null;
  /** A finished turn the user has not seen yet. */
  completionUnread?: boolean;
}

/** Pending-interaction kinds the official browser treats as "needs you". */
const ATTENTION_KINDS = new Set(["approval", "plan-review", "question"]);

/** Precedence when several sessions of one workspace disagree. */
const PRECEDENCE: Record<WorkspaceRunState, number> = { attention: 3, running: 2, done: 1 };

/** Read one session's state, falling back to the session list's `running`. */
function sessionState(
  status: SessionStatusInput | undefined,
  fallbackRunning: boolean | undefined,
): WorkspaceRunState | undefined {
  const kind = status?.pendingInteraction?.kind;
  if (typeof kind === "string" && ATTENTION_KINDS.has(kind)) return "attention";
  if (status?.running === true || (status?.runningSubagentCount ?? 0) > 0) return "running";
  if (status?.completionUnread === true) return "done";
  if (fallbackRunning === true) return "running";
  return undefined;
}

/**
 * Aggregate one workspace's sessions into a single run state.
 *
 * Unknown sessions (the status Map has not caught up) still count through the
 * session list's own `running` flag, exactly like the official browser does.
 *
 * @param sessionIds - the workspace's session ids.
 * @param statusById - the live per-Session status Map, when available.
 * @param sessionsById - the session list's own projection, as the fallback.
 * @returns the highest-precedence state, or undefined when everything is idle.
 */
export function workspaceRunState(
  sessionIds: readonly string[],
  statusById: ReadonlyMap<string, SessionStatusInput> | undefined,
  sessionsById: Readonly<Record<string, SessionStatusInput | undefined>> | undefined,
): WorkspaceRunState | undefined {
  let best: WorkspaceRunState | undefined;
  for (const sessionId of sessionIds) {
    const state = sessionState(statusById?.get(sessionId), sessionsById?.[sessionId]?.running);
    if (state === undefined) continue;
    if (state === "attention") return "attention";
    if (best === undefined || PRECEDENCE[state] > PRECEDENCE[best]) best = state;
  }
  return best;
}

/** The user-facing label of a run state, for tooltips. */
export function runStateLabel(state: WorkspaceRunState): string {
  switch (state) {
    case "running": return "运行中";
    case "attention": return "等待处理";
    case "done": return "已完成";
  }
}
