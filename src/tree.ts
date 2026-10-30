/**
 * Workspace hierarchy projection.
 *
 * The browser half of DSH shows a Workspace tree by nesting every registered
 * Workspace under its NEAREST registered ancestor directory
 * (`dsh-client-ui-workspace`'s `owningParentFolder`). The rail needs the same
 * relation for two jobs the official list cannot do for it:
 *
 * - focusing a child Workspace must keep its ANCESTORS rendered (the official
 *   group sections nest, so hiding an ancestor hides every child with it);
 * - the rail itself draws a compact tree when the user picks "Workspace Tree".
 *
 * The rules are copied deliberately instead of imported: a client bundle cannot
 * import anything outside the platform module table.
 *
 * Paths are compared case-sensitively, exactly like Workspace identity, so a
 * Workspace spellings mismatch stays visible instead of silently nesting under
 * the wrong parent.
 */

/** The subset of a workspace the tree needs. */
export interface TreeInput {
  workspaceId: string;
  path: string;
}

/**
 * Normalize a registered directory path for containment comparison.
 *
 * Windows paths get backslashes folded to slashes; POSIX paths keep backslashes
 * as ordinary name characters. Trailing separators are dropped so `F:\a\` and
 * `F:\a` are the same node.
 *
 * @param path - raw Workspace directory.
 * @returns the comparison form (empty for a missing path).
 */
export function normalizePath(path: string): string {
  if (typeof path !== "string" || path === "") return "";
  const folded = /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\")
    ? path.replaceAll("\\", "/")
    : path;
  return folded.replace(/\/+$/, "");
}

/**
 * Find the nearest registered ancestor directory of one Workspace.
 *
 * The Workspace's own directory never counts as its parent, and the longest
 * matching prefix wins — so `F:\a\b\c` nests under `F:\a\b` rather than `F:\a`.
 *
 * @param path - the candidate child directory.
 * @param registeredPaths - every registered Workspace directory.
 * @returns the matching registered path, or undefined for a root Workspace.
 */
export function owningParentPath(path: string, registeredPaths: readonly string[]): string | undefined {
  const child = normalizePath(path);
  if (child === "") return undefined;
  let owner: string | undefined;
  let longest = -1;
  for (const candidate of registeredPaths) {
    const root = normalizePath(candidate);
    if (root === "" || root === child) continue;
    if (root.length > longest && child.startsWith(`${root}/`)) {
      owner = candidate;
      longest = root.length;
    }
  }
  return owner;
}

/** One level of the projected tree, keyed by Workspace id. */
export interface WorkspaceTree<T extends TreeInput> {
  /** Workspaces without a registered ancestor, in input order. */
  roots: T[];
  /** Parent Workspace id → its direct children, in input order. */
  children: Map<string, T[]>;
  /** Child Workspace id → its direct parent Workspace id. */
  parentOf: Map<string, string>;
}

/**
 * Project a flat Workspace list into parent/child levels.
 *
 * Order is the caller's order at every level: the rail keeps the official
 * Workspace order instead of re-sorting by path, so the tree never disagrees
 * with the list beside it.
 *
 * @param items - Workspaces in the order the Host reports them.
 * @returns roots, direct children and the parent lookup.
 */
export function buildWorkspaceTree<T extends TreeInput>(items: readonly T[]): WorkspaceTree<T> {
  const registered = items.map((item) => normalizePath(item.path));
  const idByPath = new Map<string, string>();
  for (const item of items) {
    const normalized = normalizePath(item.path);
    if (normalized !== "" && !idByPath.has(normalized)) idByPath.set(normalized, item.workspaceId);
  }

  const children = new Map<string, T[]>();
  const parentOf = new Map<string, string>();
  const roots: T[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as T;
    const parentPath = owningParentPath(item.path, registered);
    const parentId = parentPath === undefined ? undefined : idByPath.get(normalizePath(parentPath));
    // A duplicate path resolves to the first owner; the later twin stays a root
    // rather than becoming its own child.
    if (parentId === undefined || parentId === item.workspaceId) {
      roots.push(item);
      continue;
    }
    parentOf.set(item.workspaceId, parentId);
    const siblings = children.get(parentId);
    if (siblings === undefined) children.set(parentId, [item]);
    else siblings.push(item);
  }

  return { roots, children, parentOf };
}

/**
 * Deepest level reached by the projected tree (roots are level 1).
 *
 * The rail must fit its deepest tile inside the column: a fixed indent would
 * push level 4+ off the right edge of a 48px rail, and the column clips
 * overflow. Knowing the depth lets the renderer shrink the indent step until
 * every level's tile still lands inside the rail.
 *
 * @param tree - the projection from {@link buildWorkspaceTree}.
 * @returns 0 for an empty tree, 1 for roots only, and so on.
 */
export function maxTreeDepth<T extends TreeInput>(tree: WorkspaceTree<T>): number {
  let deepest = 0;
  const walk = (id: string, level: number): void => {
    if (level > deepest) deepest = level;
    for (const child of tree.children.get(id) ?? []) walk(child.workspaceId, level + 1);
  };
  for (const root of tree.roots) walk(root.workspaceId, 1);
  return deepest;
}

/**
 * Tile-geometry constants — MIRROR OF `styles.ts`: `.dsh-wsr-tree` centres a
 * 47px root tile, and `.dsh-wsr-branch` sizes `--wsr-tile` to 47px minus
 * 6px per level, floored at 24px. Change one side, change the other.
 */
const ROOT_TILE_PX = 47;
const TILE_SHRINK_PX = 6;
const MIN_TILE_PX = 24;

/** The indent step range one level of the tree may take. */
const MIN_INDENT_PX = 4;
const MAX_INDENT_PX = 15;

/**
 * The indent one tree level gets, so the DEEPEST tile still fits the rail.
 *
 * A fixed indent reads well on a wide rail and clips on a narrow one: the
 * column hides its overflow, so a level-4 tile would be cut off on a 48px
 * rail. The step is therefore the largest that keeps the deepest row inside
 * the column (the root tile is centred in the gutter the padding leaves),
 * clamped so the tree still reads as a tree.
 *
 * @param railWidth - the live column width in px.
 * @param levels - child levels below the roots (maxTreeDepth − 1).
 * @returns the indent step in px for the children containers.
 */
export function computeIndentStep(railWidth: number, levels: number): number {
  if (levels <= 0) return MAX_INDENT_PX;
  const gutter = Math.max(0, (railWidth - ROOT_TILE_PX) / 2);
  const deepestTile = Math.max(MIN_TILE_PX, ROOT_TILE_PX - TILE_SHRINK_PX * levels);
  const fit = Math.floor((railWidth - gutter - deepestTile) / levels);
  return Math.max(MIN_INDENT_PX, Math.min(MAX_INDENT_PX, fit));
}

/**
 * Ancestor Workspace ids of one node, outermost first.
 *
 * @param workspaceId - the node to climb from.
 * @param parentOf - the parent lookup from {@link buildWorkspaceTree}.
 * @returns ancestors without the node itself; empty for a root.
 */
export function ancestorsOf(workspaceId: string, parentOf: ReadonlyMap<string, string>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([workspaceId]);
  for (let owner = parentOf.get(workspaceId); owner !== undefined; owner = parentOf.get(owner)) {
    if (seen.has(owner)) break;
    seen.add(owner);
    chain.unshift(owner);
  }
  return chain;
}

/**
 * Workspace id owning each Session, for scoping the flat list.
 *
 * A Session belongs to at most one Workspace in the Host projection; the first
 * owner wins so a corrupt duplicate cannot flip a row on every render.
 *
 * @param workspaces - the projected Workspace list.
 * @returns Session id → owning Workspace id.
 */
export function sessionOwners(workspaces: readonly { workspaceId: string; sessionIds: readonly string[] }[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!owners.has(sessionId)) owners.set(sessionId, workspace.workspaceId);
    }
  }
  return owners;
}

/**
 * Which session rows stay visible in the "single list" grouping mode.
 *
 * The official flat list is account-wide by design; the rail narrows it to the
 * Workspace the user is currently in, so the flat view reads like "this
 * Workspace's conversations" instead of every conversation ever made.
 *
 * @param owners - Session → Workspace from {@link sessionOwners}.
 * @param activeWorkspaceId - the Workspace owning the current session.
 * @param sessionIds - every row id the list currently renders.
 * @returns the ids that must be hidden (empty when nothing should be scoped).
 */
export function hiddenFlatSessionIds(
  owners: ReadonlyMap<string, string>,
  activeWorkspaceId: string | undefined,
  sessionIds: Iterable<string>,
): Set<string> {
  const hidden = new Set<string>();
  if (activeWorkspaceId === undefined) return hidden;
  for (const sessionId of sessionIds) {
    const owner = owners.get(sessionId);
    // Unknown owners (a Session the Workspace projection has not listed yet)
    // stay visible: hiding them would make a freshly created conversation
    // vanish before the projection catches up.
    if (owner !== undefined && owner !== activeWorkspaceId) hidden.add(sessionId);
  }
  return hidden;
}
