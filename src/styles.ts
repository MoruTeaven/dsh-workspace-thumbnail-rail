/**
 * Injected CSS — DSH theme variables with fallbacks, so the browser follows both
 * color schemes instead of hard-coding them.
 *
 * The whole surface sits inside the sidebar's `regionArea` seat, which the Host
 * already lays out as a flex column that fills the column (SidebarRoot.module.css
 * :227-236). This stylesheet turns that into the two-column explorer: a fixed
 * workspace column and a flexible session column.
 */
export const CSS = `
.dsh-wsr-browser {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  font-family: var(--dsw-font-family, inherit);
}

/* Collapsed sidebar: a single icon column of workspace thumbnails. */
.dsh-wsr-browser--rail {
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 7px 0;
  overflow-y: auto;
  scrollbar-width: none;
}

.dsh-wsr-browser--rail::-webkit-scrollbar {
  display: none;
}

.dsh-wsr-browser__rail-scroll {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
}

/* ── Workspace column ── */
.dsh-wsr-column {
  flex: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1));
}

.dsh-wsr-column__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  padding: 8px 6px;
}

.dsh-wsr-column__scroll::-webkit-scrollbar {
  display: none;
}

.dsh-wsr-tile-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  max-width: 100%;
}

/* One workspace: a rounded thumbnail tile. */
.dsh-wsr-tile {
  position: relative;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-interactive-bg-default, rgba(128, 128, 128, 0.1));
  color: var(--dsw-alias-label-tertiary, #81858c);
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.dsh-wsr-tile:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.18));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.dsh-wsr-tile--active {
  border-color: var(--dsw-alias-state-business-primary, #4f46e5);
  color: var(--dsw-alias-state-business-primary, #4f46e5);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f46e5) 12%, transparent);
}

.dsh-wsr-tile__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.dsh-wsr-tile__busy {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, #22c55e);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base, #fff);
}

.dsh-wsr-tile__label {
  font-size: 10px;
  line-height: 1.3;
  color: var(--dsw-alias-label-tertiary, #8e8e8e);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-wsr-resize {
  flex: none;
  height: 8px;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  touch-action: none;
}

.dsh-wsr-resize::after {
  content: "";
  width: 20px;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.16));
}

.dsh-wsr-resize:hover::after {
  background: var(--dsw-alias-state-business-primary, #4f46e5);
}

/* ── Session column ── */
.dsh-wsr-sessions {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.dsh-wsr-sessions__head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  height: 36px;
  padding: 0 6px;
  box-sizing: border-box;
}

.dsh-wsr-sessions__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary, #81858c);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-wsr-sessions__new {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  cursor: pointer;
}

.dsh-wsr-sessions__new:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.dsh-wsr-sessions__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 6px 8px;
}

.dsh-wsr-sessions__empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-dimmed, #a0a0a0);
}

/* Mirrors the Host browser's session row (hIlkoa_sessionRow): 32px tall,
   hover and selection share the same wash — no separate "selected" token
   exists in the Host palette. */
.dsh-wsr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  padding: 0 8px;
  border: none;
  border-radius: var(--dsw-radius-md, 12px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  font-size: 13px;
  line-height: 20px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.dsh-wsr-row:hover,
.dsh-wsr-row--active,
.dsh-wsr-row--active:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12));
}

.dsh-wsr-row__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, #22c55e);
}

.dsh-wsr-row__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Context menu — styled after the Host's own dropdown (menu surface +
   menuItem in the shell stylesheet): hairline l2 stroke, elevation shadow,
   translucent backdrop blur, 12px items with radius-md. ── */
.dsh-wsr-menu {
  position: fixed;
  z-index: 100000;
  display: flex;
  flex-direction: column;
  min-width: 158px;
  padding: 4px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-lg, 16px);
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 88%, transparent);
  box-shadow: var(--dsw-elevation-soft, 0 4px 16px rgba(0, 0, 0, 0.03), 0 0 24px rgba(0, 0, 0, 0.03));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
  font-family: var(--dsw-font-family, inherit);
}

.dsh-wsr-menu__item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 4px 7px;
  border: none;
  border-radius: var(--dsw-radius-md, 12px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
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

.dsh-wsr-menu__sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
}

/* Transient message shown when an image fails to become a thumbnail. */
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

/** Inject the browser stylesheet once; safe to call on every mount. */
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