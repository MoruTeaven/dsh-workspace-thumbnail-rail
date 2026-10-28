/**
 * Frame integration: give the workspace rail its own strip at the LEFT SIDE OF
 * THE WORKSPACE REGION (ui-sidebar's `regionArea`, which hosts
 * `sidebar.workspaces`), not the whole window.
 *
 * Resulting layout — the rail only spans the workspace list's vertical band:
 *
 *   ┌ sidebar ──────────────────────────┐
 *   │ logo / new session / panel rows   │
 *   ├───────────────────────────────────┤
 *   │ [rail] [workspace + session list] │  ← rail lives here
 *   ├───────────────────────────────────┤
 *   │ settings / footer                 │
 *   └───────────────────────────────────┘
 *
 * Why not a slot that lays itself out:
 *
 * - `sidebar` and `conversation` are SINGLE slots; a second entry SHADOWS the
 *   shipped one (slots.ts:33-39), deleting the whole surface. Not an option.
 * - `shell.overlay` IS a list slot (additive) but its layer is
 *   `position:absolute; inset:0; z-index:20` over the whole frame. It is the
 *   right place to MOUNT the rail, but it cannot hold a column by itself.
 *
 * So this module reads the region's rect and writes the rail's box directly,
 * then pads the region's content so the list clears the rail.
 */

/** Stable hook the shell sets on the overlay layer that CONTAINS our rail. */
const OVERLAY_SELECTOR = "[data-shell-overlay]";

/** ui-sidebar's container for `sidebar.workspaces`; its class is hashed. */
const REGION_SELECTOR = '[class*="regionArea"]';

/**
 * A live frame patch.
 *
 * `restore()` puts the region's own inline padding back exactly as it was
 * found, so unloading the plugin never leaves a stray strip behind.
 */
export interface FramePatch {
  /** Restore the host's original region padding. Idempotent. */
  restore(): void;
  /** Currently applied rail width in px (0 when the rail is hidden). */
  readonly width: number;
  /** The rail's left offset from the frame edge — always 0 by construction. */
  readonly offset: number;
}

/**
 * Carve a rail strip out of the workspace region's left edge and draw the rail
 * into it.
 *
 * @param railElement - the rail's root DOM node, rendered inside the overlay
 *   layer and repositioned (never re-parented) by this function.
 * @param railWidth - desired rail width in px; 0 hides the rail and restores
 *   the host.
 * @returns a patch handle, or null when the region cannot be found.
 */
export function installRail(railElement: HTMLElement, railWidth: number): FramePatch | null {
  const overlay = railElement.closest(OVERLAY_SELECTOR);
  const frame = overlay?.parentElement ?? null;
  // `closest`/`parentElement` are typed as `Element`; the rail can only live in
  // a real HTMLElement, and anything else has no style to patch.
  if (overlay === null || frame === null || !(frame instanceof HTMLElement)) return null;

  const region = frame.querySelector<HTMLElement>(REGION_SELECTOR);
  if (region === null) return null;

  const originalPadding = region.style.paddingLeft;
  let appliedWidth = 0;
  let disposed = false;

  /** Re-write the rail box and region padding from the live region rect. */
  const apply = (): void => {
    if (disposed) return;

    if (railWidth <= 0) {
      if (appliedWidth > 0) {
        appliedWidth = 0;
        region.style.paddingLeft = originalPadding;
      }
      railElement.style.display = "none";
      return;
    }

    const frameRect = frame.getBoundingClientRect();
    const regionRect = region.getBoundingClientRect();

    railElement.style.display = "";
    railElement.style.position = "absolute";
    railElement.style.left = "0px";
    railElement.style.top = `${Math.max(0, regionRect.top - frameRect.top)}px`;
    railElement.style.height = `${Math.max(0, regionRect.height)}px`;
    railElement.style.width = `${railWidth}px`;

    // The region is a flex column; padding-left pushes the workspace list right
    // without touching the whole-window grid.
    region.style.paddingLeft = `${railWidth}px`;
    appliedWidth = railWidth;
  };

  // React rewrites the frame's inline style on panel drags and window resizes,
  // and the region moves when the sidebar collapses; both invalidate the box.
  const view = frame.ownerDocument.defaultView;
  const MutationObserverCtor = view?.MutationObserver ?? MutationObserver;
  const observer = new MutationObserverCtor(() => apply());
  observer.observe(frame, { attributes: true, attributeFilter: ["style", "class"] });

  // The region's own size changes (sidebar collapse, window resize) do not
  // always touch the frame's style attribute.
  const ResizeObserverCtor = view?.ResizeObserver
    ?? (typeof ResizeObserver === "undefined" ? undefined : ResizeObserver);
  const resizer = ResizeObserverCtor ? new ResizeObserverCtor(() => apply()) : null;
  if (resizer) {
    resizer.observe(frame);
    resizer.observe(region);
  }

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
      if (resizer) resizer.disconnect();
      appliedWidth = 0;
      region.style.paddingLeft = originalPadding;
      railElement.style.display = "none";
      railElement.style.top = "";
      railElement.style.height = "";
      railElement.style.left = "";
      railElement.style.width = "";
    },
  };
}
