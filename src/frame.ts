/**
 * Frame integration: widen DSH's three-column AppFrame grid by one rail's worth
 * of pixels and draw the thumbnail rail inside that space.
 *
 * Why this shape rather than a slot that lays itself out:
 *
 * - `sidebar` and `conversation` are SINGLE slots; a second entry SHADOWS the
 *   shipped one (slots.ts:33-39) and wins by priority, which would delete the
 *   whole conversation surface. Not an option.
 * - `shell.overlay` IS a list slot (additive) but its layer is
 *   `position:absolute; inset:0` over the whole frame
 *   (AppFrame.module.css:110). Rendering the rail there means it floats above
 *   the conversation, so it must reserve space in the frame's grid anyway.
 *
 * So the rail is rendered through `shell.overlay` (to get `useWorkspaces` /
 * `useSessions` and real React state) and this module does only the geometric
 * part:
 *
 *   1. widen the CENTER track by `railWidth`, which shifts the conversation
 *      column right by exactly that much — the host owns the concession solve,
 *      we never recompute its widths;
 *   2. position the rail absolutely at `sidebarWidth .. sidebarWidth+railWidth`,
 *      i.e. in the space that widening the center just opened up.
 *
 * The widening deliberately lands on the center track, NOT on the sidebar
 * track: the sidebar's drag handle is absolutely positioned at the sidebar's
 * own pixel boundary (AppFrame.tsx:197 writes `left: cols.sidebar`), so
 * growing the sidebar track would leave that handle stranded mid-column and
 * every sidebar drag would jump. Growing the center moves only the
 * conversation's left edge, which is exactly the boundary we want to move.
 *
 * The rail DOM node is never re-parented: it stays exactly where React rendered
 * it inside the overlay layer, because moving a React-managed node out of its
 * parent makes the next reconciliation call `removeChild` on the wrong parent.
 *
 * React rewrites the frame's inline `grid-template-columns` on every panel drag
 * and window resize, discarding our edit — so a MutationObserver re-applies it
 * while the rail is mounted, and `restore()` puts the original value back
 * exactly once on teardown.
 */

/** Stable hook the shell sets on the overlay layer that CONTAINS our rail. */
const OVERLAY_SELECTOR = "[data-shell-overlay]";

/** Parse a computed `grid-template-columns` value into its track pixel widths. */
function parseTracks(value: string): number[] {
  // The computed value is always resolved to px, e.g. "280px 640px 360px".
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
 * Widen the CENTER track by `railWidth`, leaving every other track untouched.
 *
 * The previous rail contribution (`appliedWidth`) is subtracted first, so
 * calling this repeatedly with a changed host layout never accumulates: the
 * result depends only on (tracks, railWidth), not on how many times it ran.
 *
 * @param tracks - the frame's current computed tracks in px.
 * @param railWidth - the rail width in px (0 leaves the layout untouched).
 * @param appliedWidth - how much this function added on the previous call.
 * @returns the new track list, or the input when it cannot be adjusted.
 */
export function widenCenter(
  tracks: readonly number[],
  railWidth: number,
  appliedWidth: number,
): number[] {
  if (railWidth <= 0 || tracks.length < 2) return [...tracks];
  const center = Math.max(0, tracks[1] - appliedWidth);
  return [tracks[0], center + railWidth, ...tracks.slice(2)];
}

/**
 * A live frame patch.
 *
 * `restore()` puts the frame's own inline style back exactly as it was found,
 * so unloading the plugin never leaves a stray grid behind.
 */
export interface FramePatch {
  /** Restore the frame's original inline grid style. Idempotent. */
  restore(): void;
  /** Currently applied rail width in px (0 when the rail is hidden). */
  readonly width: number;
  /** Currently applied sidebar track width in px (the rail's left offset). */
  readonly offset: number;
}

/**
 * Carve a rail column out of the frame's grid and draw the rail into it.
 *
 * @param railElement - the rail's root DOM node, rendered inside the overlay
 *   layer and repositioned (never re-parented) by this function.
 * @param railWidth - desired rail width in px; 0 hides the rail and restores the grid.
 * @returns a patch handle, or null when the frame cannot be found.
 */
export function installRail(railElement: HTMLElement, railWidth: number): FramePatch | null {
  const overlay = railElement.closest(OVERLAY_SELECTOR);
  const frame = overlay?.parentElement ?? null;
  if (overlay === null || frame === null) return null;

  const originalInline = frame.style.gridTemplateColumns;
  /**
   * The exact inline value this function wrote last time. React overwrites it
   * with its own solved widths on every panel drag and window resize, so a
   * mismatch against this string is how we detect "the host just rewrote the
   * grid" — at which point our contribution is gone and must NOT be subtracted.
   */
  let ourLastWrite = "";
  let appliedWidth = 0;
  let appliedOffset = 0;
  let disposed = false;

  /** Re-write the grid so the conversation column starts `railWidth` further right. */
  const apply = (): void => {
    if (disposed) return;

    if (railWidth <= 0) {
      if (appliedWidth > 0) {
        appliedWidth = 0;
        appliedOffset = 0;
        ourLastWrite = "";
        frame.style.gridTemplateColumns = originalInline;
      }
      railElement.style.display = "none";
      return;
    }

    const tracks = parseTracks(getComputedStyle(frame).gridTemplateColumns);
    if (tracks.length < 2) return;

    // Our contribution is still in place only when the inline style is byte
    // for byte the one we wrote. After the host rewrote it, subtracting our
    // width again would shrink the host's own center track by that much.
    const oursIsPresent = ourLastWrite !== "" && frame.style.gridTemplateColumns === ourLastWrite;

    const next = formatTracks(widenCenter(tracks, railWidth, oursIsPresent ? appliedWidth : 0));
    frame.style.gridTemplateColumns = next;

    ourLastWrite = next;
    appliedWidth = railWidth;
    // The rail occupies the left slice of the widened center track.
    appliedOffset = tracks[0];
    railElement.style.display = "";
    railElement.style.left = `${appliedOffset}px`;
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
      return appliedOffset;
    },
    restore() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      ourLastWrite = "";
      appliedWidth = 0;
      frame.style.gridTemplateColumns = originalInline;
      railElement.style.display = "none";
      railElement.style.left = "";
      railElement.style.width = "";
    },
  };
}