import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColumnsIcon, FolderIcon, ImageIcon, ImageOffIcon, TrashIcon } from "./icons";
import { ThumbnailError, makeThumbnail } from "./image";
import { installRail, type FramePatch } from "./frame";
import { loadPrefs, loadThumbnails, savePrefs, saveThumbnails } from "./storage";
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
  startWorkspace,
  removeWorkspace,
}: RailProps) {
  const workspaces = useWorkspaces((state) => state.items);
  const currentSessionId = useSessions((state) => state.current);

  const [thumbnails, setThumbnails] = useState<ThumbnailMap>(() => loadThumbnails());
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  /** Show a transient message, replacing any in flight. */
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
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

  return (
    <div ref={rootRef} className="dsh-wsr-rail" data-plugin="dsh-workspace-thumbnail-rail">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onFileChosen}
      />

      {workspaces.map((workspace) => {
        const thumb = thumbnails[workspace.workspaceId];
        const isActive = workspace.workspaceId === activeId;
        return (
          <div className="dsh-wsr-cell-wrap" key={workspace.workspaceId}>
            <button
              type="button"
              className={`dsh-wsr-cell${isActive ? " dsh-wsr-cell--active" : ""}`}
              title={workspace.title}
              aria-label={workspace.title}
              aria-current={isActive || undefined}
              onClick={() => startWorkspace(workspace.workspaceId)}
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
            <span className="dsh-wsr-cell__label">{workspace.title}</span>
          </div>
        );
      })}

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
  onDelete(): void;
  onToggleRail(): void;
}

/** The right-click menu for one workspace cell. */
function Menu(props: MenuProps) {
  // Keep the menu inside the viewport.
  const x = Math.max(4, Math.min(props.menu.x, window.innerWidth - 166));
  const y = Math.max(4, Math.min(props.menu.y, window.innerHeight - 196));
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