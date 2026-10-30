/**
 * The official workspace browser's grouping mode.
 *
 * The rail must follow the same three modes the shipped list offers, because
 * its own behaviour depends on them: "Workspace Tree" turns the rail into a
 * collapsible hierarchy, and "In one list" scopes the official list to the
 * current Workspace. The mode lives in the official view store
 * (`dsh-client-ui-workspace`), which persists to localStorage under a
 * versioned key — that key is the only channel a client plugin can read, since
 * the store handle itself is not exposed to other plugins.
 *
 * Reads are defensive on purpose: a missing or reshaped key degrades to the
 * default mode instead of throwing inside the frame.
 */

/** Grouping modes the shipped browser understands. */
export type WorkspaceGroupBy = "workspace" | "workspace-tree" | "flat";

/** Store key shipped with the current client. */
const VIEW_STORE_KEY = "dsh.workspace.view.v5";

/** Prefix shared by every published version of that store key. */
const VIEW_STORE_PREFIX = "dsh.workspace.view.";

/** How often the same-page write is noticed (the `storage` event skips it). */
const POLL_MS = 400;

/** @returns whether an arbitrary string is one of the three known modes. */
export function isWorkspaceGroupBy(value: string): value is WorkspaceGroupBy {
  return value === "workspace" || value === "workspace-tree" || value === "flat";
}

/**
 * Locate the store key currently in use.
 *
 * The exact shipped key wins; any other `dsh.workspace.view.*` key is accepted
 * as a fallback so a client that bumps the store version does not silently pin
 * the rail to the default mode.
 */
function storeKey(): string | undefined {
  try {
    if (localStorage.getItem(VIEW_STORE_KEY) !== null) return VIEW_STORE_KEY;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key !== null && key.startsWith(VIEW_STORE_PREFIX)) return key;
    }
  } catch {
    // Storage can be absent (SSR/tests) or throw in private modes.
  }
  return undefined;
}

/**
 * Read the grouping mode the official list is showing.
 *
 * @returns the mode, or "workspace" when the store is absent or unreadable.
 */
export function readGroupBy(): WorkspaceGroupBy {
  try {
    const key = storeKey();
    if (key === undefined) return "workspace";
    const raw = localStorage.getItem(key);
    if (raw === null) return "workspace";
    // The value is a whole store snapshot; a targeted match avoids parsing it.
    const match = /"groupBy"\s*:\s*"([^"]*)"/.exec(raw);
    const mode = match?.[1];
    return mode !== undefined && isWorkspaceGroupBy(mode) ? mode : "workspace";
  } catch {
    return "workspace";
  }
}

/**
 * Follow the grouping mode until disposed.
 *
 * The `storage` event fires only in OTHER pages, so same-page switches are
 * caught by a light poll of the one key. The callback fires only on change.
 *
 * @param onChange - notified with the new mode.
 * @returns an unsubscribe function.
 */
export function watchGroupBy(onChange: (mode: WorkspaceGroupBy) => void): () => void {
  let last = readGroupBy();
  const tick = (): void => {
    const next = readGroupBy();
    if (next === last) return;
    last = next;
    onChange(next);
  };
  const timer = setInterval(tick, POLL_MS);
  if (typeof window === "undefined") return () => clearInterval(timer);
  const onStorage = (): void => tick();
  window.addEventListener("storage", onStorage);
  return () => {
    clearInterval(timer);
    window.removeEventListener("storage", onStorage);
  };
}
