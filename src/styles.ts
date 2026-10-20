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
  top: 0;
  bottom: 0;
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
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.dsh-wsr-cell:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.dsh-wsr-cell--active {
  border-color: var(--dsw-alias-state-business-primary, #4f46e5);
  color: var(--dsw-alias-state-business-primary, #4f46e5);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f46e5) 10%, transparent);
}

.dsh-wsr-cell__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.dsh-wsr-cell__label {
  font-size: 10px;
  line-height: 1.3;
  color: var(--dsw-alias-label-tertiary, #8e8e8e);
  width: 100%;
  text-align: center;
  padding: 2px 3px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-wsr-cell-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: none;
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