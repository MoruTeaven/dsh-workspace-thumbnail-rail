import { Rail, type RailActions } from "./Rail";
import { injectStyles } from "./styles";

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
const inject = ["slots", "workspaces", "sessions"];

/** The slot this plugin contributes to. */
const SLOT_KEY = "sidebar.workspaces";

/** This plugin's entry id — the Host's own browser registers under another. */
const ENTRY_ID = "workspace-thumbnail-rail";

/** The Host faces this plugin drives, kept as a narrow local shape. */
interface WorkspaceFace {
  connectWorkspace(workspaceId: string): Promise<string>;
  delete(workspaceId: string): Promise<void>;
  archiveSession(sessionId: string): Promise<void>;
}

interface SessionFace {
  open(sessionId: string): void;
}

function apply(ctx: any) {
  const workspaces = ctx.workspaces as WorkspaceFace;
  const sessions = ctx.sessions as SessionFace;

  const actions: RailActions = {
    openSession: (sessionId) => sessions.open(sessionId),

    // The Host resolves the workspace's blank session (reusing an existing one)
    // and this call opens it, so navigation semantics stay Host-owned.
    startWorkspace: (workspaceId) => {
      workspaces
        .connectWorkspace(workspaceId)
        .then((sessionId) => sessions.open(sessionId))
        .catch(() => {
          /* the workspace column itself stays usable; the Host logs the reason */
        });
    },

    newSessionIn: (workspaceId) => {
      workspaces
        .connectWorkspace(workspaceId)
        .then((sessionId) => sessions.open(sessionId))
        .catch(() => {
          /* same as startWorkspace */
        });
    },

    removeWorkspace: (workspaceId) => workspaces.delete(workspaceId),
    archiveSession: (sessionId) => workspaces.archiveSession(sessionId),
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