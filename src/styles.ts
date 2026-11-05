/**
 * Injected CSS — DSH theme variables with fallbacks, so the rail follows both
 * color schemes instead of hard-coding them.
 *
 * The rail is absolutely positioned INSIDE the shell's overlay layer (which is
 * `position:absolute; inset:0`), so its geometry is written by frame.ts and
 * only its paint lives here. That also means it must not claim pointer events
 * where it is not drawn — the overlay layer is click-through except for its
 * direct children, and the rail IS a direct child, so the whole column is
 * clickable and the empty strip is only as tall as the column.
 */
export const CSS = `
.dsh-wsr-rail {
  position: absolute;
  /* top/height/left/width are written by frame.ts from the region rect. */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 9px 0;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  font-family: var(--dsw-font-family, inherit);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, transparent));
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1));
  z-index: 1;
}

.dsh-wsr-rail::-webkit-scrollbar {
  display: none;
}

/* One workspace cell: a rounded thumbnail tile. */
.dsh-wsr-cell {
  position: relative;
  flex: none;
  width: 47px;
  height: 47px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-interactive-bg-default, rgba(128, 128, 128, 0.08));
  color: var(--dsw-alias-label-tertiary, #8e8e8e);
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s;
  flex-shrink: 0;
}

.dsh-wsr-cell:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f46e5) 38%, transparent);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16));
  color: var(--dsw-alias-label-primary, #1a1a1a);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f46e5) 14%, transparent);
}

/* A tile's content (image or monogram fill) brightens slightly on hover so
   the state stays visible even when the tile is fully covered. */
.dsh-wsr-cell:hover :is(.dsh-wsr-cell__img, .dsh-wsr-cell__mono) {
  filter: brightness(1.08);
}

.dsh-wsr-cell--active {
  border-color: var(--dsw-alias-label-primary, #1a1a1a);
  color: var(--dsw-alias-label-primary, #1a1a1a);
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #1a1a1a) 10%, transparent);
  /* Neutral selection ring leaves blue, yellow and green to run status. */
  box-shadow:
    0 0 0 2.5px var(--dsw-alias-label-primary, #1a1a1a),
    0 0 0 5.5px var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #fff));
  /* Scale is the one signal hover never gets: at thumbnail sizes a size
     change is the clearest "this tile is different" cue there is. */
  transform: scale(1.15);
}

/* A neutral wash over the image/monogram keeps selection visible even when
   the tile is completely covered by content. */
.dsh-wsr-cell--active::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #1a1a1a) 13%, transparent);
  pointer-events: none;
  z-index: 1;
}

.dsh-wsr-cell--active :is(.dsh-wsr-cell__img, .dsh-wsr-cell__mono) {
  filter: brightness(1.05) saturate(1.1);
}

/*
 * Run-state ring: one workspace's sessions fold into a single state (status.ts)
 * drawn as an outline OUTSIDE the tile — outline never fights the hover/active
 * box-shadow rings, follows the tile's radius, and colors follow the theme's
 * state aliases: blue = running, yellow = waiting for you, green = completed.
 */
.dsh-wsr-cell--status-running {
  outline: 2px solid var(--dsw-alias-state-info-primary, #3b82f6);
  outline-offset: 1px;
}

.dsh-wsr-cell--status-attention {
  outline: 2px solid var(--dsw-alias-state-warn-primary, #d97706);
  outline-offset: 1px;
}

.dsh-wsr-cell--status-done {
  outline: 2px solid var(--dsw-alias-state-success-primary, #16a34a);
  outline-offset: 1px;
}

/* On a selected tile the neutral selection ring occupies the border area.
   Move the independent run-state color to a corner marker instead of stacking
   two similarly shaped outlines (especially confusing when running is blue). */
.dsh-wsr-cell--active:is(
  .dsh-wsr-cell--status-running,
  .dsh-wsr-cell--status-attention,
  .dsh-wsr-cell--status-done
) {
  outline: none;
}

.dsh-wsr-cell--active:is(
  .dsh-wsr-cell--status-running,
  .dsh-wsr-cell--status-attention,
  .dsh-wsr-cell--status-done
)::before {
  content: "";
  position: absolute;
  top: 3px;
  right: 3px;
  z-index: 2;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #fff));
  background: var(--wsr-status-color);
  pointer-events: none;
}

.dsh-wsr-cell--status-running { --wsr-status-color: var(--dsw-alias-state-info-primary, #3b82f6); }
.dsh-wsr-cell--status-attention { --wsr-status-color: var(--dsw-alias-state-warn-primary, #d97706); }
.dsh-wsr-cell--status-done { --wsr-status-color: var(--dsw-alias-state-success-primary, #16a34a); }

/* The selected workspace's title joins the highlight. */
.dsh-wsr-cell-wrap--active .dsh-wsr-cell__label {
  color: var(--dsw-alias-label-primary, #1a1a1a);
  font-weight: 700;
}

/* Ancestors of the selection: label lifted a step (guide lit further down). */
.dsh-wsr-cell-wrap--path .dsh-wsr-cell__label {
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.dsh-wsr-cell__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/*
 * Default tile when no thumbnail is set: a colored monogram of the title
 * (two latin/digit glyphs, or one wide glyph). The fill comes from the
 * workspace id via monogram.tsx; this block only sizes and shades it.
 */
.dsh-wsr-cell__mono {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 600;
  line-height: 1;
  color: #fff;
  user-select: none;
  /* A whisper of shading keeps flat fills from reading as error blocks. */
  background-image: linear-gradient(rgba(255, 255, 255, 0.14), rgba(0, 0, 0, 0.1));
}

.dsh-wsr-cell__mono--wide {
  font-size: 27px;
  font-weight: 500;
}

/* User-typed tiles of 3–4 glyphs drop further to stay inside the tile. */
.dsh-wsr-cell__mono--long {
  font-size: 11px;
  padding: 0 2px;
}

/* Child tile glyphs scale with the tile itself, so a third-level tile never
   carries text sized for the root. */
.dsh-wsr-cell-wrap--child .dsh-wsr-cell__mono {
  font-size: calc(var(--wsr-tile, 41px) * 0.34);
}

.dsh-wsr-cell-wrap--child .dsh-wsr-cell__mono--wide {
  font-size: calc(var(--wsr-tile, 41px) * 0.52);
}

.dsh-wsr-cell-wrap--child .dsh-wsr-cell__mono--long {
  font-size: calc(var(--wsr-tile, 41px) * 0.22);
}

.dsh-wsr-cell__label {
  font-size: 10px;
  line-height: 1.3;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  width: 100%;
  text-align: center;
  padding: 2px 3px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-wsr-cell-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: none;
  /* Pin the row to its tile's width so a long title ellipsizes inside the
     tile instead of widening the row and pushing the tree out of the rail. */
  width: var(--wsr-tile, 47px);
}

/* Label row: an optional fold caret sits beside the title. */
.dsh-wsr-cell__meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 100%;
  min-width: 0;
}

.dsh-wsr-caret {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  cursor: pointer;
}

.dsh-wsr-caret:hover {
  color: var(--dsw-alias-label-primary, #1a1a1a);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16));
}

/* Fold caret on the tile's top-right corner: the only placement that stays
   visible in both the labelled and the icons-only layout. */
.dsh-wsr-caret--overlay {
  position: absolute;
  top: -6px;
  right: -6px;
  z-index: 2;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #2a2a2a));
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  box-shadow: var(--dsw-shadow-lv1, 0 1px 4px rgba(0, 0, 0, 0.28));
  color: var(--dsw-alias-label-secondary, #c8c8c8);
}

.dsh-wsr-caret--overlay:hover {
  color: var(--dsw-alias-label-primary, #fff);
  border-color: var(--dsw-alias-state-business-primary, #4f46e5);
}

/*
 * Tree layout: one left-aligned column inside a centred gutter.
 *
 * A tree is only legible when every child sits to the RIGHT of its parent and
 * each level steps in. The indent is a live CSS variable (--wsr-indent,
 * written by Rail.tsx from computeIndentStep) because the column clips its
 * overflow: a fixed indent clips the deepest tile on a narrow rail. The
 * gutter keeps a ROOT tile centred, and every connector reads the same
 * variables — nothing is positioned by hand, so a line cannot miss its tile.
 */
.dsh-wsr-tree {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  width: 100%;
  box-sizing: border-box;
  /* Centre the root tile: (rail width - 47px) / 2. */
  padding-left: max(0px, calc((100% - 47px) / 2));
}

.dsh-wsr-branch {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  flex: none;
  width: 100%;
  /* This level's tile edge, shared by the tile box and the connectors. The
     floor matches computeIndentStep's deepest-tile clamp. */
  --wsr-tile: max(24px, calc(47px - var(--wsr-depth, 0) * 6px));
}

/*
 * A child row: a shaded track from the tile edge to the right of the column,
 * with a hairline inset edge. The tint is mixed from the theme's tertiary
 * label in low alpha, so one layer stays subtle in both schemes while nested
 * levels compound into progressively darker (or lighter) shading — no
 * per-depth class needed.
 */
.dsh-wsr-branch--child {
  position: relative;
  padding: 3px 0;
  border-radius: var(--dsw-radius-md, 10px);
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8e8e8e) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-tertiary, #8e8e8e) 13%, transparent);
}

/* Children container: one indent step per level (inherited --wsr-indent),
   and the vertical rail that drops from the parent tile through every
   sibling below it. --wsr-rail-x is the joint every elbow starts from, so
   the rail sits at the centre of the indent at any step width. */
.dsh-wsr-branch__children {
  --wsr-rail-x: calc(var(--wsr-indent, 12px) / 2);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  width: 100%;
  box-sizing: border-box;
  padding-left: var(--wsr-indent, 12px);
}

.dsh-wsr-branch__children::before {
  content: "";
  position: absolute;
  /* Reaches up into the gap so the rail starts at the parent tile, not at the
     container's own top edge. */
  top: -5px;
  bottom: 0;
  left: calc(var(--wsr-rail-x) - 0.75px);
  width: 1.5px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8e8e8e) 55%, transparent);
}

/* Elbow: a stub from the rail to the child tile's left edge, on the tile's
   midline (3px track padding + half the level's tile). The row box's left
   edge IS the tile edge, so the elbow spans exactly indent − rail px. */
.dsh-wsr-branch--child::before {
  content: "";
  position: absolute;
  top: calc(3px + var(--wsr-tile) / 2 - 0.75px);
  left: calc(var(--wsr-rail-x, 6px) - var(--wsr-indent, 12px));
  width: calc(var(--wsr-indent, 12px) - var(--wsr-rail-x, 6px) + 1px);
  height: 1.5px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8e8e8e) 55%, transparent);
}

/* The joint dot, centred on the rail where the elbow starts. The branch box
   is already (rail-x) px right of the rail's own left, hence the subtraction. */
.dsh-wsr-branch--child::after {
  content: "";
  position: absolute;
  top: calc(3px + var(--wsr-tile) / 2 - 2.5px);
  left: calc(var(--wsr-rail-x, 6px) - var(--wsr-indent, 12px) - 2.5px);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8e8e8e) 75%, transparent);
}

/* The selected route uses the same neutral as selection. Run-state colors
   remain reserved for the tile's outline or corner marker. */
.dsh-wsr-branch__children--path::before,
.dsh-wsr-branch--path::before,
.dsh-wsr-branch--path::after {
  background: var(--dsw-alias-label-primary, #1a1a1a);
}

/* A child tile is smaller than its parent's, and every level past the first
   shrinks one more step. */
.dsh-wsr-cell-wrap--child .dsh-wsr-cell {
  width: var(--wsr-tile);
  height: var(--wsr-tile);
  border-radius: var(--dsw-radius-sm, 7px);
}

.dsh-wsr-cell-wrap--child .dsh-wsr-cell__label {
  font-size: 9px;
  color: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8e8e8e) 82%, transparent);
}

.dsh-wsr-resize {
  flex: none;
  width: 100%;
  height: 7px;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
}

.dsh-wsr-resize::after {
  content: "";
  width: 22px;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.16));
}

.dsh-wsr-resize:hover::after {
  background: var(--dsw-alias-state-business-primary, #4f46e5);
}

/* ── Thumbnail picker ── */
.dsh-wsr-scrim {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: rgba(0, 0, 0, 0.32);
}

.dsh-wsr-picker {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 100001;
  width: 264px;
  max-width: calc(100vw - 24px);
  padding: 12px;
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1));
  box-shadow: var(--dsw-shadow-lv2, 0 8px 28px rgba(0, 0, 0, 0.18));
  font-family: var(--dsw-font-family, inherit);
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.dsh-wsr-picker__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  margin-bottom: 10px;
}

.dsh-wsr-picker__title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-wsr-picker__close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 7px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #8e8e8e);
  cursor: pointer;
}

.dsh-wsr-picker__close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.dsh-wsr-picker__tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--dsw-radius-sm, 7px);
  background: var(--dsw-alias-interactive-bg-default, rgba(128, 128, 128, 0.08));
  margin-bottom: 10px;
}

.dsh-wsr-picker__tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #8e8e8e);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.dsh-wsr-picker__tab--on {
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #1a1a1a);
  box-shadow: var(--dsw-shadow-lv1, 0 1px 4px rgba(0, 0, 0, 0.12));
  font-weight: 600;
}

.dsh-wsr-picker__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dsh-wsr-picker__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #8e8e8e);
}

.dsh-wsr-picker__input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-sm, 7px);
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.dsh-wsr-picker__input:focus {
  border-color: var(--dsw-alias-state-business-primary, #4f46e5);
}

.dsh-wsr-picker__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.dsh-wsr-picker__swatch {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
}

.dsh-wsr-picker__swatch--on {
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base, #fff), 0 0 0 4px var(--dsw-alias-state-business-primary, #4f46e5);
}

.dsh-wsr-picker__swatch--custom {
  border: 1px dashed var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.16));
  background: transparent;
}

.dsh-wsr-picker__swatch--custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.dsh-wsr-picker__previewrow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dsh-wsr-picker__preview {
  position: relative;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: var(--dsw-radius-md, 10px);
  overflow: hidden;
}

.dsh-wsr-picker__save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 7px);
  background: var(--dsw-alias-state-business-primary, #4f46e5);
  color: #fff;
  font-size: 12px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}

.dsh-wsr-picker__save:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dsh-wsr-picker__foot {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
}

.dsh-wsr-picker__remove {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 7px);
  background: transparent;
  color: var(--dsw-alias-state-error-primary, #dc2626);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.dsh-wsr-picker__remove:hover {
  background: var(--dsw-alias-interactive-bg-danger-hover, rgba(220, 38, 38, 0.1));
}

/* ── Context menu ── */
.dsh-wsr-menu {
  position: fixed;
  z-index: 100000;
  min-width: 158px;
  padding: 4px;
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1));
  box-shadow: var(--dsw-shadow-lv2, 0 8px 28px rgba(0, 0, 0, 0.18));
  font-family: var(--dsw-font-family, inherit);
}

.dsh-wsr-menu__item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--dsw-radius-sm, 7px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.dsh-wsr-menu__item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12));
}

.dsh-wsr-menu__item--danger {
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

.dsh-wsr-menu__item--danger:hover {
  background: var(--dsw-alias-interactive-bg-danger-hover, rgba(220, 38, 38, 0.1));
}

.dsh-wsr-menu__sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
}

/* Toast shown when an image fails to become a thumbnail. */
.dsh-wsr-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100001;
  padding: 8px 14px;
  border-radius: var(--dsw-radius-sm, 7px);
  background: var(--dsw-alias-state-error-primary, #dc2626);
  color: #fff;
  font-size: 12px;
  font-family: var(--dsw-font-family, inherit);
  box-shadow: var(--dsw-shadow-lv2, 0 8px 28px rgba(0, 0, 0, 0.18));
}

/* Header toggle injected beside the official search/filter/add actions. */
.dsh-wsr-header-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 7px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #8e8e8e);
  cursor: pointer;
  flex: none;
}

.dsh-wsr-header-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.dsh-wsr-header-toggle svg {
  display: block;
}

/* Official workspace groups hidden while the rail focuses one workspace. */
[data-wsr-hidden="1"] {
  display: none !important;
}

/* Official sessions outside the current workspace, in the "single list" mode. */
[data-wsr-scope-hidden="1"] {
  display: none !important;
}

/* Official rows hidden while the rail focuses one workspace: the ancestors'
   headers and their direct sessions. The ancestor SECTIONS stay rendered as
   bare wrappers (the official tree nests them around the target). */
[data-wsr-row-hidden="1"] {
  display: none !important;
}

/* Match the rail's neutral selection without borrowing blue from run status. */
[data-wsr-current="1"] {
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #1a1a1a) 12%, transparent) !important;
  box-shadow: inset 2.5px 0 0 var(--dsw-alias-label-primary, #1a1a1a);
}
`;

/** Inject the rail stylesheet once; safe to call on every mount. */
export function injectStyles(): void {
  const tagId = "@moruteaven/dsh-workspace-thumbnail-rail/style";
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-plugin-css="${tagId}"]`)) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "@moruteaven/dsh-workspace-thumbnail-rail";
  tag.dataset.pluginCss = tagId;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
