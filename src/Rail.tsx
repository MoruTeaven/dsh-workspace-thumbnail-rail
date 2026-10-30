import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronIcon, ColumnsIcon, FolderIcon, ImageIcon, ImageOffIcon, TrashIcon } from "./icons";
import { ThumbnailError, makeThumbnail } from "./image";
import { installRail, type FramePatch } from "./frame";
import { loadPrefs, loadThumbnails, markRuntime, savePrefs, saveThumbnails } from "./storage";
import {
  ancestorsOf,
  buildWorkspaceTree,
  hiddenFlatSessionIds,
  sessionOwners,
} from "./tree";
import { readGroupBy, watchGroupBy, type WorkspaceGroupBy } from "./view-mode";
import type { SessionListState, ThumbnailMap, WorkspaceListState, WorkspaceView } from "./types";

/**
 * The thumbnail rail: one vertical cell per workspace, drawn in the column the
 * plugin carves out of the host frame.
 *
 * State comes from the framework's standard props (`useWorkspaces` /
 * `useSessions`, runtime/src/client/index.ts:146-150) and from the register
 * `inject` face, so the rail never owns a subscription or reaches for a
 * global — the host re-renders it exactly when the workspace baseline or the
 * current session changes, and the navigation actions arrive as props.
 */

/** Actions the plugin body injects into the rail component. */
export interface RailActions {
  /** Open one existing session (a workspace's conversation), not a new blank. */
  openSession: (sessionId: string) => void;
  /** Connect a workspace's blank session and navigate to it. */
  startWorkspace: (workspaceId: string) => void;
  /** Unregister a workspace (directory, files and session logs stay). */
  removeWorkspace: (workspaceId: string) => Promise<void>;
}

/** Props the framework injects into every global (root-scoped) slot component. */
export interface RailProps extends RailActions {
  useWorkspaces: <T,>(selector: (state: WorkspaceListState) => T) => T;
  useSessions: <T,>(selector: (state: SessionListState) => T) => T;
}

/** Build stamp injected by esbuild (`define`); see storage.markRuntime. */
declare const __WSR_VERSION__: string;

/** Rail column geometry bounds, matching the storage clamp. */
const MIN_RAIL_WIDTH = 48;
const MAX_RAIL_WIDTH = 160;

/** Milliseconds a transient message stays on screen. */
const TOAST_MS = 2600;

/**
 * Resolve which workspace owns the current session.
 *
 * The browser half has no session→workspace service; scanning the workspace
 * list is the shipped precedent
 * (runtime/src/client/workspaces/service.ts:180-182).
 */
function workspaceOfSession(
  workspaces: readonly WorkspaceView[],
  sessionId: string | undefined,
): string | undefined {
  if (sessionId === undefined) return undefined;
  return workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId;
}

/** The rail root. */
export function Rail({
  useWorkspaces,
  useSessions,
  openSession,
  startWorkspace,
  removeWorkspace,
}: RailProps) {
  const workspaces = useWorkspaces((state) => state.items);
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
  const recentWorkspaceId = useWorkspaces((state) => state.recentWorkspaceId);
  const currentSessionId = useSessions((state) => state.current);
  const sessionsById = useSessions((state) => state.byId);

  const [thumbnails, setThumbnails] = useState<ThumbnailMap>(() => loadThumbnails());
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<WorkspaceGroupBy>(() => readGroupBy());

  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPickRef = useRef<string | null>(null);
  const patchRef = useRef<FramePatch | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cross-page sync. The storage event fires in every page EXCEPT the writer,
  // so there is nothing to de-duplicate here.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "dsh.wsr.thumbnails.v1") {
        setThumbnails(loadThumbnails());
      }
      if (event.key === null || event.key === "dsh.wsr.prefs.v1") {
        setPrefs(loadPrefs());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Carve the column out of the host frame, and hand it back on unmount.
  const railWidth = prefs.enabled ? prefs.width : 0;
  useEffect(() => {
    const element = rootRef.current;
    if (element === null) return;
    patchRef.current?.restore();
    patchRef.current = installRail(element, railWidth);
    return () => {
      patchRef.current?.restore();
      patchRef.current = null;
    };
  }, [railWidth]);

  const activeId = useMemo(
    () => workspaceOfSession(workspaces, currentSessionId),
    [workspaces, currentSessionId],
  );

  /**
   * The Workspace the "single list" view is scoped to.
   *
   * The current session is the primary answer, but a brand-new conversation is
   * not in any Workspace's `sessionIds` yet — the official browser then still
   * counts it as belonging to the most recent Workspace, so the rail follows
   * that instead of silently showing every conversation again.
   */
  const scopeId = activeId ?? recentWorkspaceId;

  /** Publish the live build so a stale page is diagnosable from outside. */
  useEffect(() => {
    markRuntime(__WSR_VERSION__);
  }, []);

  /** Follow the official list's grouping mode (it decides the rail's shape). */
  useEffect(() => watchGroupBy(setGroupBy), []);

  /** Workspace hierarchy, shared by the rail tree and the focus ancestor walk. */
  const tree = useMemo(() => buildWorkspaceTree(workspaces), [workspaces]);

  /** Id lookup for the recursive renderer, so depth never rescans the list. */
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace])),
    [workspaces],
  );

  /** Session → owning Workspace, for scoping the official flat list. */
  const owners = useMemo(() => sessionOwners(workspaces), [workspaces]);

  /** Show a transient message, replacing any in flight. */
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
  }, []);

  /**
   * Open a workspace's most recent real conversation.
   *
   * A rail click must NOT create a blank session (that is `openWorkspace`'s
   * behaviour). It should show what the workspace already contains, so this
   * picks the newest non-blank session and opens it; a workspace with only
   * blanks has nothing to show and reports that instead of starting a new one.
   */
  const openWorkspaceConversation = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.workspaceId === workspaceId);
    if (workspace === undefined) return;
    const candidates = workspace.sessionIds
      .map((id) => sessionsById[id])
      .filter((session): session is { id: string; updatedAt: number; blank?: boolean } =>
        session !== undefined
        && session.blank !== true
        && !archivedSessionIds.includes(session.id),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (candidates.length === 0) {
      notify("该工作区还没有对话");
      return;
    }
    openSession(candidates[0].id);
  }, [workspaces, sessionsById, archivedSessionIds, openSession, notify]);

  /**
   * Focus one workspace in the official browser: expand its group and HIDE
   * every other group, so the list shows only that workspace's conversations.
   *
   * The official group container is `div[class*="groupSection"]`; the target is
   * the section whose header carries `data-row-key="workspace:<workspaceId>"`.
   * Hiding uses a data attribute rather than a class or inline style because
   * React re-renders `className`/`style` and would drop those, while an
   * unmanaged attribute survives until the node is replaced (the observer in
   * the effect below re-applies it when that happens).
   *
   * In "Workspace Tree" the sections NEST: a parent's section wraps its
   * children, so hiding every non-target section also hid the focused child's
   * ancestors — and with them the child itself, which is why focusing a child
   * Workspace left the list empty. The target and every section that contains
   * it therefore stay visible; everything else still goes.
   */
  const applyFocus = useCallback((workspaceId: string | null) => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[class*="groupSection"]'));
    if (workspaceId === null) {
      for (const section of sections) section.removeAttribute("data-wsr-hidden");
      return;
    }
    const targetKey = `workspace:${workspaceId}`;
    const target = sections.find((section) => {
      const header = section.querySelector<HTMLElement>('[data-row-key^="workspace:"]');
      return header?.getAttribute("data-row-key") === targetKey;
    });
    if (target === undefined) return;
    for (const section of sections) {
      const keep = section === target || section.contains(target);
      if (keep) section.removeAttribute("data-wsr-hidden");
      else section.setAttribute("data-wsr-hidden", "1");
    }
  }, []);

  useEffect(() => {
    applyFocus(focusId);
    if (focusId === null) return undefined;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        applyFocus(focusId);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [focusId, applyFocus]);

  /**
   * Expand the target group (and, in the tree, every ancestor above it) before
   * hiding the rest.
   *
   * A nested Workspace row only exists once its parents are open, so the walk
   * repeats: opening a parent mounts the next level, which the following pass
   * then opens. It stops as soon as a pass changes nothing.
   */
  const focusWorkspace = useCallback(async (workspaceId: string) => {
    const nextTick = () => new Promise<void>((resolve) => { setTimeout(resolve, 30); });
    const chain = [...ancestorsOf(workspaceId, tree.parentOf), workspaceId];

    for (let pass = 0; pass < 6; pass += 1) {
      let opened = false;
      for (const id of chain) {
        const row = document.querySelector<HTMLElement>(`[data-row-key="workspace:${id}"]`);
        if (row === null || row.getAttribute("aria-expanded") === "true") continue;
        row.click();
        opened = true;
        await nextTick();
      }
      if (!opened) break;
    }

    setFocusId(workspaceId);
    document.querySelector<HTMLElement>(`[data-row-key="workspace:${workspaceId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [tree]);

  /**
   * Narrow the official "In one list" view to the current Workspace.
   *
   * That grouping mode is account-wide by design, so the rail hides every row
   * whose Session belongs to another Workspace. Rows are marked with a data
   * attribute (React owns their class/style) and re-marked on each mutation,
   * because the list virtualizes and rebuilds rows as the user scrolls.
   *
   * Two guards keep the failure mode "shows too much" instead of "shows
   * nothing": no scope is applied while no Workspace can be resolved, and a
   * scope that would hide EVERY rendered row is dropped (a wrong scope must
   * never leave an empty list).
   */
  useEffect(() => {
    const scoped = groupBy === "flat" && scopeId !== undefined;
    const clear = (rows: NodeListOf<HTMLElement>) => {
      for (const row of rows) row.removeAttribute("data-wsr-scope-hidden");
    };
    const apply = () => {
      const rows = document.querySelectorAll<HTMLElement>('[data-row-key^="session:"]');
      if (!scoped) {
        clear(rows);
        return;
      }
      const ids = Array.from(rows, (row) => (row.dataset.rowKey ?? "").slice("session:".length));
      const hidden = hiddenFlatSessionIds(owners, scopeId, ids);
      if (ids.length > 0 && hidden.size >= ids.length) {
        clear(rows);
        return;
      }
      for (const row of rows) {
        const id = (row.dataset.rowKey ?? "").slice("session:".length);
        if (hidden.has(id)) row.setAttribute("data-wsr-scope-hidden", "1");
        else row.removeAttribute("data-wsr-scope-hidden");
      }
    };
    apply();
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        apply();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [groupBy, scopeId, owners]);

  /** Show every workspace group again. */
  const showAllWorkspaces = useCallback(() => {
    setFocusId(null);
  }, []);

  /** Fold or unfold one parent's children in the rail tree. */
  const toggleCollapsed = useCallback((workspaceId: string) => {
    setPrefs((current) => {
      const folded = current.collapsed.includes(workspaceId);
      const next = {
        ...current,
        collapsed: folded
          ? current.collapsed.filter((id) => id !== workspaceId)
          : [...current.collapsed, workspaceId],
      };
      savePrefs(next);
      return next;
    });
  }, []);

  /** Open the OS file picker for one workspace. */
  const pickFor = useCallback((workspaceId: string) => {
    pendingPickRef.current = workspaceId;
    fileInputRef.current?.click();
  }, []);

  /** Compress the chosen image and persist it. */
  const onFileChosen = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    // Read the pending id into a const: the narrowing must survive the await
    // below, which a property access on a ref does not.
    const workspaceId: string | undefined = pendingPickRef.current ?? undefined;
    pendingPickRef.current = null;
    input.value = "";
    if (file === undefined || workspaceId === undefined) return;

    try {
      const record = await makeThumbnail(file);
      const next = { ...loadThumbnails(), [workspaceId]: record };
      if (saveThumbnails(next)) {
        setThumbnails(next);
      } else {
        notify("缩略图保存失败：本地存储空间不足");
      }
    } catch (error) {
      notify(error instanceof ThumbnailError ? error.message : "设置缩略图失败");
    }
  }, [notify]);

  /** Drop one workspace's thumbnail. */
  const clearFor = useCallback((workspaceId: string) => {
    const next = { ...loadThumbnails() };
    delete next[workspaceId];
    saveThumbnails(next);
    setThumbnails(next);
  }, []);

  /** Toggle the rail on or off, persisting the preference. */
  const toggleRail = useCallback(() => {
    setPrefs((current) => {
      const next = { ...current, enabled: !current.enabled };
      savePrefs(next);
      return next;
    });
  }, []);

  /**
   * Put a show/hide toggle into the official workspace header, beside the
   * search / view-options / add actions.
   *
   * The header is rendered by ui-workspace, so the button is a plain DOM node
   * this effect owns: it is re-created when the rail's visibility changes and
   * removed on unmount. A MutationObserver keeps it mounted if the official
   * header re-renders.
   */
  useEffect(() => {
    const HEADER_ACTIONS = '[class*="headerActions"]';
    const ICON_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></svg>';
    const ICON_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>';

    let container: HTMLElement | null = null;
    let button: HTMLButtonElement | null = null;

    const mount = () => {
      const next = document.querySelector<HTMLElement>(HEADER_ACTIONS);
      if (next === null) return;
      if (next === container && button !== null && next.contains(button)) return;
      if (button !== null) button.remove();
      container = next;
      button = document.createElement("button");
      button.type = "button";
      button.className = "dsh-wsr-header-toggle";
      button.title = prefs.enabled ? "收起缩略图栏" : "展开缩略图栏";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(prefs.enabled));
      button.innerHTML = prefs.enabled ? ICON_CLOSE : ICON_OPEN;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleRail();
      });
      next.appendChild(button);
    };

    mount();
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        mount();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (button !== null) button.remove();
    };
  }, [prefs.enabled, toggleRail]);

  /** Drag the rail's inner edge to resize the column. */
  const onResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = loadPrefs().width;
    const move = (e: PointerEvent) => {
      const width = Math.min(
        MAX_RAIL_WIDTH,
        Math.max(MIN_RAIL_WIDTH, startWidth + (e.clientX - startX)),
      );
      setPrefs((current) => (current.width === width ? current : { ...current, width }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      savePrefs(loadPrefs());
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  /** Close the context menu on the next outside click or Escape. */
  useEffect(() => {
    if (menu === null) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Defer binding by a tick so the click that opened the menu does not
    // immediately close it.
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const onDeleteWorkspace = useCallback(async (workspaceId: string) => {
    clearFor(workspaceId);
    try {
      await removeWorkspace(workspaceId);
    } catch {
      notify("移除工作区失败");
    }
  }, [clearFor, notify]);

  /**
   * Render one rail cell, plus its children while the tree mode is on.
   *
   * The rail is at most 160px wide, so depth is NOT expressed with indentation:
   * a hairline guide and a slightly smaller tile say "child" without eating the
   * thumbnail. A parent gains a caret that folds its subtree, and the fold state
   * is persisted, so the shape survives a reload.
   *
   * @param workspaceId - the Workspace to draw.
   * @param isChild - whether this node sits below another one.
   * @returns the cell (with its subtree), or null if the Workspace disappeared.
   */
  const renderNode = (workspaceId: string, isChild: boolean): React.ReactNode => {
    const workspace = workspaceById.get(workspaceId);
    if (workspace === undefined) return null;
    const children = tree.children.get(workspace.workspaceId) ?? [];
    const folded = prefs.collapsed.includes(workspace.workspaceId);
    const thumb = thumbnails[workspace.workspaceId];
    // In the flat mode the list follows `scopeId`, so the tile must highlight
    // whatever the list is scoped to, even when that came from the recency
    // fallback rather than from the current session.
    const isActive = workspace.workspaceId === activeId
      || (groupBy === "flat" && workspace.workspaceId === scopeId);
    const caretLabel = folded
      ? `展开 ${workspace.title} 的子工作区`
      : `收起 ${workspace.title} 的子工作区`;

    return (
      <div
        className={`dsh-wsr-branch${isChild ? " dsh-wsr-branch--child" : ""}`}
        key={workspace.workspaceId}
      >
        <div className={`dsh-wsr-cell-wrap${isChild ? " dsh-wsr-cell-wrap--child" : ""}`}>
          <button
            type="button"
            className={`dsh-wsr-cell${isActive ? " dsh-wsr-cell--active" : ""}`}
            title={workspace.title}
            aria-label={workspace.title}
            aria-current={isActive || undefined}
            onClick={() => {
              // "In one list" has no groups to focus, and the list is scoped to
              // the current Workspace — so a click must MOVE the current
              // Workspace instead, which is what opening its newest
              // conversation does. Without this the click would look dead.
              if (groupBy === "flat") {
                openWorkspaceConversation(workspace.workspaceId);
                return;
              }
              if (focusId === workspace.workspaceId) {
                setFocusId(null);
                return;
              }
              void focusWorkspace(workspace.workspaceId);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              setMenu({ workspaceId: workspace.workspaceId, x: rect.right + 4, y: rect.top });
            }}
          >
            {thumb === undefined
              ? <FolderIcon size={18} />
              : <img className="dsh-wsr-cell__img" src={thumb.src} alt="" draggable={false} />}
          </button>
          <div className="dsh-wsr-cell__meta">
            {children.length > 0 && (
              <button
                type="button"
                className="dsh-wsr-caret"
                aria-expanded={!folded}
                aria-label={caretLabel}
                title={caretLabel}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCollapsed(workspace.workspaceId);
                }}
              >
                <ChevronIcon size={9} open={!folded} />
              </button>
            )}
            <span className="dsh-wsr-cell__label">{workspace.title}</span>
          </div>
        </div>
        {children.length > 0 && !folded
          ? children.map((child) => renderNode(child.workspaceId, true))
          : null}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="dsh-wsr-rail" data-plugin="dsh-workspace-thumbnail-rail">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onFileChosen}
      />

      {groupBy === "workspace-tree"
        ? tree.roots.map((root) => renderNode(root.workspaceId, false))
        : workspaces.map((workspace) => renderNode(workspace.workspaceId, false))}

      {prefs.enabled && workspaces.length > 0 && (
        <div
          className="dsh-wsr-resize"
          onPointerDown={onResize}
          role="separator"
          aria-label="调整缩略图栏宽度"
        />
      )}

      {menu !== null && (
        <Menu
          menu={menu}
          hasThumbnail={thumbnails[menu.workspaceId] !== undefined}
          railVisible={prefs.enabled}
          onClose={() => setMenu(null)}
          onSet={() => { setMenu(null); pickFor(menu.workspaceId); }}
          onClear={() => { clearFor(menu.workspaceId); setMenu(null); }}
          onOpenRecent={() => { const id = menu.workspaceId; setMenu(null); openWorkspaceConversation(id); }}
          onShowAll={() => { setMenu(null); void showAllWorkspaces(); }}
          onDelete={() => { setMenu(null); void onDeleteWorkspace(menu.workspaceId); }}
          onToggleRail={() => { setMenu(null); toggleRail(); }}
        />
      )}

      {toast !== null && <div className="dsh-wsr-toast">{toast}</div>}
    </div>
  );
}

/** An open context menu, anchored in viewport coordinates. */
interface MenuState {
  workspaceId: string;
  x: number;
  y: number;
}

/** Props the context menu needs. */
interface MenuProps {
  menu: MenuState;
  hasThumbnail: boolean;
  railVisible: boolean;
  onClose(): void;
  onSet(): void;
  onClear(): void;
  onOpenRecent(): void;
  onShowAll(): void;
  onDelete(): void;
  onToggleRail(): void;
}

/** The right-click menu for one workspace cell. */
function Menu(props: MenuProps) {
  // Keep the menu inside the viewport.
  const x = Math.max(4, Math.min(props.menu.x, window.innerWidth - 166));
  const y = Math.max(4, Math.min(props.menu.y, window.innerHeight - 260));
  return (
    <div
      className="dsh-wsr-menu"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onSet}>
        <ImageIcon size={14} /> 设置缩略图
      </button>
      {props.hasThumbnail && (
        <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onClear}>
          <ImageOffIcon size={14} /> 移除缩略图
        </button>
      )}
      <div className="dsh-wsr-menu__sep" />
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onOpenRecent}>
        <FolderIcon size={14} /> 打开最近对话
      </button>
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onShowAll}>
        <ColumnsIcon size={14} /> 显示全部工作区
      </button>
      <div className="dsh-wsr-menu__sep" />
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onToggleRail}>
        <ColumnsIcon size={14} /> {props.railVisible ? "隐藏缩略图栏" : "显示缩略图栏"}
      </button>
      <button
        type="button"
        className="dsh-wsr-menu__item dsh-wsr-menu__item--danger"
        role="menuitem"
        onClick={props.onDelete}
      >
        <TrashIcon size={14} /> 移除此工作区
      </button>
    </div>
  );
}
