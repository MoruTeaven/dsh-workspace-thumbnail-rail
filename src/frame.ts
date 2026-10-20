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
 *   1. add `railWidth` to the frame's first grid track, which pushes the
 *      conversation column right by exactly that much — the host owns the
 *      concession solve, we never recompute its widths;
 *   2. position the rail absolutely at `sidebarWidth .. sidebarWidth+railWidth`,
 *      i.e. inside the space we just carved out.
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
        frame.style.gridTemplateColumns = originalInline;
      }
      railElement.style.display = "none";
      return;
    }

    const tracks = parseTracks(getComputedStyle(frame).gridTemplateColumns);
    if (tracks.length < 2) return;

    // Subtract our own contribution before re-adding it: the computed value
    // reflects the inline style we wrote last time, so this stays idempotent
    // across the MutationObserver's repeated calls.
    const sidebar = Math.max(0, tracks[0] - appliedWidth);
    frame.style.gridTemplateColumns = formatTracks([sidebar + railWidth, ...tracks.slice(1)]);

    appliedWidth = railWidth;
    appliedOffset = sidebar;
    railElement.style.display = "";
    railElement.style.left = `${sidebar}px`;
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
      frame.style.gridTemplateColumns = originalInline;
      railElement.style.display = "none";
      railElement.style.left = "";
      railElement.style.width = "";
    },
  };
}