import { Rail, type RailActions } from "./Rail";
import { injectStyles } from "./styles";
import type { SessionSearchHit } from "./types";

/**
 * Browser-half plugin body.
 *
 * `sidebar.workspaces` is the Host's workspace/session browsing region
 * (ui-sidebar/src/client/contract/slots.ts:24): the section header, the search
 * box, the grouped session tree and every workspace dialog. Taking that seat
 * REPLACES the Host's own browser with the two-column explorer this plugin
 * ships — a workspace thumbnail column on the left, that workspace's sessions
 * on the right.
 *
 * The alternative seats were rejected for concrete reasons:
 * - `sidebar` and `conversation` are single slots where a second entry wins by
 *   priority and deletes the shipped surface (runtime/slots.ts:33-39).
 * - `shell.overlay` is additive but its layer paints above the whole frame at
 *   `z-index: 20` (AppFrame.module.css:110-119), so it cannot host a column
 *   that participates in the layout; that was the previous, wrong approach.
 *
 * All navigation is delegated to the Host through the injected face below, so
 * this plugin never mutates session or workspace state directly.
 */

/** Services this plugin waits for before registering. */
const inject = ["slots", "uiWorkspace", "workspaces", "sessions"];

/** The slot this plugin contributes to. */
const SLOT_KEY = "sidebar.workspaces";

/** This plugin's entry id — the Host's own browser registers under another. */
const ENTRY_ID = "workspace-thumbnail-rail";

/**
 * The `uiWorkspace` face owns every open/start navigation: `ctx.sessions` only
 * exposes retain/search/fork, and `connectWorkspace` lives here too, not on
 * `ctx.workspaces` (calling either wrong name throws and the click silently
 * does nothing).
 */
interface UiWorkspaceFace {
  /** Select a session and show its conversation as one navigation action. */
  openSession(target: string): void;
  /** Connect a workspace (reusing its blank session) and open it. */
  openWorkspace(workspaceId: string): Promise<void>;
  /** Start a fresh session in a workspace and open it. */
  startSession(workspaceId?: string): void;
  /** Archive a session, clearing it when it is the current selection. */
  archiveSession(sessionId: string): Promise<void>;
  /**
   * Pin a session to the top of every grouping surface.
   *
   * The Host's own UI calls this (`uiWorkspace.pinSession` in
   * dsh-client-ui-workspace), but the runtime SERVICE_API table does not list
   * it, so it is typed optional and probed before the rail exposes the action.
   */
  pinSession?: (sessionId: string) => Promise<void>;
  /** Remove a session's pin. Same probe applies as {@link pinSession}. */
  unpinSession?: (sessionId: string) => Promise<void>;
}

/** The workspace-controller face, narrowed to the calls this plugin needs. */
interface WorkspaceFace {
  delete(workspaceId: string): Promise<void>;
  /** Restore an archived session to its recorded workspace position. */
  unarchiveSession(sessionId: string): Promise<void>;
}

/** The sessions-service face, narrowed to what the rail needs. */
interface SessionsFace {
  /**
   * Hold one session reference across a synchronous callback.
   *
   * This is how the Host's own UI reaches a single session's actions — the
   * `reference.binding.session` face owns `rename`, which is not on this service
   * itself (see client.js in dsh-client-ui-workspace: `sessions.using(sessionId,
   * { source: "workspaceOperation" }, (reference) => reference.binding.session.rename(title))`).
   */
  using<T>(
    target: string,
    options: { source: string },
    operation: (reference: {
      binding: { session: { rename(title: string): Promise<unknown> } };
    }) => T,
  ): Promise<T>;

  /**
   * Search the Host's visible message-content index.
   *
   * `RemoteResult` is either a success carrying the bounded page or a business
   * error; the rail treats every failure as "no results" and lets the Host log
   * the reason, the same way it treats a refused `openWorkspace`.
   */
  search(query: string, signal: AbortSignal): Promise<unknown>;
}

function apply(ctx: any) {
  const uiWorkspace = ctx.uiWorkspace as UiWorkspaceFace;
  const workspaces = ctx.workspaces as WorkspaceFace;
  const sessions = ctx.sessions as SessionsFace;

  const actions: RailActions = {
    openSession: (sessionId) => uiWorkspace.openSession(sessionId),

    // openWorkspace connects and navigates as one Host action; a refusal is
    // already surfaced through the Host's own workspace notice.
    startWorkspace: (workspaceId) => {
      uiWorkspace.openWorkspace(workspaceId).catch(() => {
        /* the workspace column itself stays usable; the Host logs the reason */
      });
    },

    newSessionIn: (workspaceId) => uiWorkspace.startSession(workspaceId),

    removeWorkspace: (workspaceId) => workspaces.delete(workspaceId),
    archiveSession: (sessionId) => uiWorkspace.archiveSession(sessionId),
    unarchiveSession: (sessionId) => workspaces.unarchiveSession(sessionId),

    // The Host's search answers a RemoteResult — success payload or business
    // error — so the rail unwraps it here rather than making Rail.tsx know the
    // wire shape. Any failure yields null, which the UI renders as "no results".
    searchSessions: async (query, signal) => {
      let raw: unknown;
      try {
        raw = await sessions.search(query, signal);
      } catch {
        return null;
      }
      const result = raw as { ok?: boolean; value?: unknown } | null | undefined;
      if (result === null || result === undefined || result.ok !== true) return null;
      const page = result.value as { items?: unknown; hasMore?: unknown } | undefined;
      if (page === undefined || !Array.isArray(page.items)) return null;
      const items: SessionSearchHit[] = [];
      for (const item of page.items) {
        const hit = item as { sessionId?: unknown; snippet?: unknown };
        if (typeof hit?.sessionId !== "string") continue;
        items.push({
          sessionId: hit.sessionId,
          snippet: typeof hit.snippet === "string" ? hit.snippet : "",
        });
      }
      return { items, hasMore: page.hasMore === true };
    },

    // Rename goes through `sessions.using` because the title write lives on the
    // session's own face, not on the sessions service. `RemoteResult` again:
    // a false `ok` carries an `error.message` worth showing the user.
    renameSession: async (sessionId, title) => {
      const result = await sessions.using(
        sessionId,
        { source: "workspaceOperation" },
        (reference) => reference.binding.session.rename(title),
      ) as { ok?: boolean; error?: { message?: unknown } } | null | undefined;
      if (result === null || result === undefined || result.ok !== true) {
        const message = result?.error?.message;
        throw new Error(typeof message === "string" ? message : "重命名失败");
      }
    },

    // Pin is typed optional because the runtime SERVICE_API table does not
    // list it; the rail hides the action when the Host build lacks it.
    pinSession: uiWorkspace.pinSession === undefined
      ? undefined
      : async (sessionId) => { await uiWorkspace.pinSession?.(sessionId); },
    unpinSession: uiWorkspace.unpinSession === undefined
      ? undefined
      : async (sessionId) => { await uiWorkspace.unpinSession?.(sessionId); },
  };

  ctx.slots.inject(SLOT_KEY, () => {
    injectStyles();
    let dispose: (() => void) | null = null;
    try {
      dispose = ctx.slots.register(
        {
          name: SLOT_KEY,
          id: ENTRY_ID,
          order: 0,
          inject: () => actions,
        },
        Rail as unknown as React.ComponentType<never>,
      );
    } catch {
      // A same-id entry can still occupy the cell when another plugin's load
      // advanced the slot's declaration epoch; without this catch the throw
      // bubbles into SlotRegistry.inject's handler, which stops the injection
      // for the whole page lifetime.
      return undefined;
    }
    return () => {
      dispose?.();
    };
  });
}

export { apply, inject };