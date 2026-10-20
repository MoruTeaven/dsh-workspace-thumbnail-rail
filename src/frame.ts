/**
 * Frame integration: give the workspace rail its own column at the FAR LEFT of
 * DSH's three-column AppFrame, pushing the host's sidebar right.
 *
 * Resulting layout — the rail is the leftmost column of the whole frame:
 *
 *   | rail | sidebar (session browser) | conversation | details |
 *
 * Why this shape rather than a slot that lays itself out:
 *
 * - `sidebar` and `conversation` are SINGLE slots; a second entry SHADOWS the
 *   shipped one (slots.ts:33-39) and wins by priority, which would delete the
 *   whole conversation surface. Not an option.
 * - `shell.overlay` IS a list slot (additive) but its layer is
 *   `position:absolute; inset:0; z-index:20` over the whole frame
 *   (AppFrame.module.css:110-119). It is the right place to MOUNT the rail —
 *   it supplies `useWorkspaces` / `useSessions` and real React state — but the
 *   layer itself can never hold a column, because it paints above everything.
 *
 * So this module does the geometry in two moves:
 *
 *   1. widen the frame's FIRST grid track (the sidebar) by `railWidth`, which
 *      shifts the sidebar and everything after it right by exactly that much;
 *   2. pad the sidebar column's content by the same amount, because a widened
 *      grid track does NOT move its content — block children stay flush left —
 *      and without the padding the session list would sit under the rail.
 *
 * The rail is then positioned at `left: 0`, the frame's own left edge.
 *
 * The rail DOM node is never re-parented: it stays exactly where React rendered
 * it inside the overlay layer, because moving a React-managed node out of its
 * parent makes the next reconciliation call `removeChild` on the wrong parent.
 *
 * React rewrites the frame's inline `grid-template-columns` on every panel drag
 * and window resize, discarding our edit — so a MutationObserver re-applies it
 * while the rail is mounted, and `restore()` puts the original values back
 * exactly once on teardown.
 */

/** Stable hook the shell sets on the overlay layer that CONTAINS our rail. */
const OVERLAY_SELECTOR = "[data-shell-overlay]";

/** Parse a computed `grid-template-columns` value into its track pixel widths. */
function parseTracks(value: string): number[] {
  // The computed value is always resolved to px, e.g. "280px 1000px 360px".
  return value
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const px = Number.parseFloat(token);
      return Number.isFinite(px) ? px : 0;
    })
    .filter((px) => px > 0);
}

/** Format pixel tracks back into a `grid-template-columns` value. */
function formatTracks(tracks: readonly number[]): string {
  return tracks.map((px) => `${Math.round(px)}px`).join(" ");
}

/**
 * Widen the FIRST (sidebar) track by `railWidth`, leaving the rest untouched.
 *
 * The previous rail contribution (`appliedWidth`) is subtracted first, so
 * calling this repeatedly with a changed host layout never accumulates: the
 * result depends only on (tracks, railWidth, appliedWidth), not on how many
 * times it ran.
 *
 * @param tracks - the frame's current computed tracks in px.
 * @param railWidth - the rail width in px (0 leaves the layout untouched).
 * @param appliedWidth - how much this function added on the previous call.
 * @returns the new track list, or the input when it cannot be adjusted.
 */
export function widenFirst(
  tracks: readonly number[],
  railWidth: number,
  appliedWidth: number,
): number[] {
  if (railWidth <= 0 || tracks.length < 2) return [...tracks];
  const first = Math.max(0, tracks[0] - appliedWidth);
  return [first + railWidth, ...tracks.slice(1)];
}

/**
 * The frame's sidebar column — the first grid child that is neither the overlay
 * layer nor a drag handle. Drag handles are frame children too
 * (AppFrame.module.css:51-53), and they sit at the end, but filtering by class
 * keeps this correct if the host ever reorders its children.
 */
function findSidebarColumn(frame: HTMLElement, overlay: Element): HTMLElement | null {
  for (const child of Array.from(frame.children)) {
    const element = child as HTMLElement;
    if (element === overlay) continue;
    if (element.dataset.side !== undefined) continue;
    const className = typeof element.className === "string" ? element.className : "";
    if (className.includes("handle")) continue;
    return element;
  }
  return null;
}

/**
 * A live frame patch.
 *
 * `restore()` puts the frame's own inline style back exactly as it was found,
 * so unloading the plugin never leaves a stray column behind.
 */
export interface FramePatch {
  /** Restore the host's original grid and sidebar padding. Idempotent. */
  restore(): void;
  /** Currently applied rail width in px (0 when the rail is hidden). */
  readonly width: number;
  /** The rail's left offset from the frame edge — always 0 by construction. */
  readonly offset: number;
}

/**
 * Carve a rail column out of the frame's left edge and draw the rail into it.
 *
 * @param railElement - the rail's root DOM node, rendered inside the overlay
 *   layer and repositioned (never re-parented) by this function.
 * @param railWidth - desired rail width in px; 0 hides the rail and restores the host.
 * @returns a patch handle, or null when the frame cannot be found.
 */
export function installRail(railElement: HTMLElement, railWidth: number): FramePatch | null {
  const overlay = railElement.closest(OVERLAY_SELECTOR);
  const frame = overlay?.parentElement ?? null;
  // `closest`/`parentElement` are typed as `Element`; the rail can only live in
  // a real HTMLElement, and anything else has no style to patch.
  if (overlay === null || frame === null || !(frame instanceof HTMLElement)) return null;

  const sidebarCol = findSidebarColumn(frame, overlay);
  const originalGrid = frame.style.gridTemplateColumns;
  const originalPadding = sidebarCol?.style.paddingLeft ?? "";

  /**
   * The exact inline value this function wrote last time. React overwrites it
   * with its own solved widths on every panel drag and window resize, so a
   * mismatch against this string is how we detect "the host just rewrote the
   * grid" — at which point our contribution is gone and must NOT be subtracted.
   */
  let ourLastWrite = "";
  let appliedWidth = 0;
  let disposed = false;

  /** Re-write the grid so the sidebar (and everything after it) shifts right. */
  const apply = (): void => {
    if (disposed) return;

    if (railWidth <= 0) {
      if (appliedWidth > 0) {
        appliedWidth = 0;
        ourLastWrite = "";
        frame.style.gridTemplateColumns = originalGrid;
        if (sidebarCol !== null) sidebarCol.style.paddingLeft = originalPadding;
      }
      railElement.style.display = "none";
      return;
    }

    const tracks = parseTracks(getComputedStyle(frame).gridTemplateColumns);
    if (tracks.length < 2) return;

    // Our contribution is still in place only when the inline style is byte
    // for byte the one we wrote. After the host rewrote it, subtracting our
    // width again would shrink the host's own sidebar track by that much.
    const oursIsPresent = ourLastWrite !== "" && frame.style.gridTemplateColumns === ourLastWrite;

    const next = formatTracks(widenFirst(tracks, railWidth, oursIsPresent ? appliedWidth : 0));
    frame.style.gridTemplateColumns = next;

    ourLastWrite = next;
    appliedWidth = railWidth;

    // A widened grid track does not move its content: block children stay
    // flush left, so the session list would end up underneath the rail. Pad it
    // by the same amount to push it clear.
    if (sidebarCol !== null) sidebarCol.style.paddingLeft = `${railWidth}px`;

    railElement.style.display = "";
    railElement.style.left = "0px";
    railElement.style.width = `${railWidth}px`;
  };

  const observer = new MutationObserver(() => apply());
  observer.observe(frame, { attributes: true, attributeFilter: ["style"] });

  apply();

  return {
    get width() {
      return appliedWidth;
    },
    get offset() {
      return 0;
    },
    restore() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      ourLastWrite = "";
      appliedWidth = 0;
      frame.style.gridTemplateColumns = originalGrid;
      if (sidebarCol !== null) sidebarCol.style.paddingLeft = originalPadding;
      railElement.style.display = "none";
      railElement.style.left = "";
      railElement.style.width = "";
    },
  };
}