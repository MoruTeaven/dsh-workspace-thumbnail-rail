import { Rail, type RailActions } from "./Rail";
import { injectStyles } from "./styles";

/**
 * Browser-half plugin body.
 *
 * `shell.overlay` is chosen deliberately (slots.ts:37-39): it is a LIST slot,
 * so this entry is ADDED beside the shipped ones instead of shadowing any of
 * them, and it stays alive for the whole frame. `sidebar` and `conversation`
 * are single slots where a second entry wins by priority and would delete the
 * shipped surface.
 *
 * The rail's geometry is handled by `frame.ts` (it hugs the workspace region);
 * this registration only supplies the React host (and with it `useWorkspaces` /
 * `useSessions`) and the two Host actions the menu needs.
 */

/** Services this plugin waits for before registering. */
const inject = ["slots", "uiWorkspace", "workspaces"];

/** The list slot this plugin contributes to. */
const SLOT_KEY = "shell.overlay";

/** This plugin's entry id inside that list slot. */
const ENTRY_ID = "workspace-thumbnail-rail";

function apply(ctx: any) {
  const uiWorkspace = ctx.uiWorkspace as {
    openSession(sessionId: string): void;
    openWorkspace(workspaceId: string): Promise<void>;
  };
  const workspaces = ctx.workspaces as {
    delete(id: string): Promise<void>;
  };

  const actions: RailActions = {
    // A rail click shows what the workspace already contains: the rail picks a
    // session and this opens it, so no blank conversation is created.
    openSession: (sessionId) => uiWorkspace.openSession(sessionId),

    // openWorkspace connects (reusing the blank session) and navigates as one
    // Host action; a refusal is already surfaced through the Host's notice.
    startWorkspace: (workspaceId) => {
      uiWorkspace.openWorkspace(workspaceId).catch(() => {
        /* the workspace list itself reports Host failures; stay quiet here */
      });
    },
    removeWorkspace: (workspaceId) => workspaces.delete(workspaceId),
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
