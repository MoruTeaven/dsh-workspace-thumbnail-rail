import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveIcon, FolderIcon, ImageIcon, ImageOffIcon, OpenIcon, TrashIcon } from "./icons";
import { ThumbnailError, makeThumbnail } from "./image";
import { resolveSelectedWorkspace, sessionsOfWorkspace } from "./sessions";
import { loadPrefs, loadThumbnails, savePrefs, saveThumbnails } from "./storage";
import type {
  RailPreferences,
  SessionListState,
  ThumbnailMap,
  WorkspaceListState,
  WorkspaceView,
} from "./types";

/**
 * The sidebar browser: a workspace column on the left and that workspace's
 * sessions on the right, in the shape VS Code uses for its explorer.
 *
 * This plugin takes over the `sidebar.workspaces` seat, so the Host's own
 * workspace browser is replaced wholesale (the seat is single-kind; a second
 * entry would shadow it anyway — see slots.ts:33-39). Everything below is
 * therefore rendered from the framework's standard hooks and the register
 * `inject` face, never by reaching into the Host's DOM.
 */

/** Actions the plugin body injects into this component. */
export interface RailActions {
  /** Open a session by id. */
  openSession: (sessionId: string) => void;
  /** Connect a workspace's blank session and navigate to it. */
  startWorkspace: (workspaceId: string) => void;
  /** Start a new session inside a workspace. */
  newSessionIn: (workspaceId: string) => void;
  /** Unregister a workspace (directory, files and session logs stay). */
  removeWorkspace: (workspaceId: string) => Promise<void>;
  /** Archive a session so it leaves every list. */
  archiveSession: (sessionId: string) => Promise<void>;
}

/** Owner props the sidebar passes to this seat (contract/slots.ts:43-48). */
export interface RailOwnerProps {
  /** Shell fold state: wide renders the full browser, rail the icon column. */
  wide: boolean;
  /** Rail icons request expansion; the browser rides the wide flip for focus. */
  expandSidebar: () => void;
}

/** Props the framework injects into every global (root-scoped) slot component. */
export interface RailProps extends RailActions, RailOwnerProps {
  useWorkspaces: <T,>(selector: (state: WorkspaceListState) => T) => T;
  useSessions: <T,>(selector: (state: SessionListState) => T) => T;
}

/** Rail column geometry bounds, matching the storage clamp. */
const MIN_RAIL_WIDTH = 56;
const MAX_RAIL_WIDTH = 120;

/** Milliseconds a transient message stays on screen. */
const TOAST_MS = 2600;

/** An open context menu, anchored in viewport coordinates. */
interface MenuState {
  x: number;
  y: number;
  /** Which row the menu acts on. */
  target:
    | { kind: "workspace"; workspaceId: string }
    | { kind: "session"; sessionId: string };
}

/** The browser root. */
export function Rail({
  wide,
  expandSidebar,
  useWorkspaces,
  useSessions,
  openSession,
  startWorkspace,
  newSessionIn,
  removeWorkspace,
  archiveSession,
}: RailProps) {
  const workspaces = useWorkspaces((state) => state.items);
  const archived = useWorkspaces((state) => state.archivedSessionIds);
  const sessions = useSessions((state) => ({
    ids: state.ids,
    byId: state.byId,
    current: state.current,
  }));

  const [thumbnails, setThumbnails] = useState<ThumbnailMap>(() => loadThumbnails());
  const [prefs, setPrefs] = useState<RailPreferences>(() => loadPrefs());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPickRef = useRef<string | null>(null);
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

  useEffect(() => () => {
    if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
  }, []);

  /**
   * The workspace whose sessions are listed: a remembered selection, else the
   * one owning the current session, else the first.
   */
  const selectedId = useMemo(
    () => resolveSelectedWorkspace(workspaces, prefs.selectedWorkspaceId, sessions.current),
    [workspaces, prefs.selectedWorkspaceId, sessions.current],
  );

  const selected = useMemo(
    () => workspaces.find((item) => item.workspaceId === selectedId),
    [workspaces, selectedId],
  );

  const rows = useMemo(
    () => (selected === undefined
      ? []
      : sessionsOfWorkspace(selected, sessions, { archived, current: sessions.current })),
    [selected, sessions, archived],
  );

  /** Remember the selected workspace and open its conversation. */
  const select = useCallback((workspaceId: string) => {
    setPrefs((current) => {
      const next = { ...current, selectedWorkspaceId: workspaceId };
      savePrefs(next);
      return next;
    });
    startWorkspace(workspaceId);
  }, [startWorkspace]);

  /** Show a transient message, replacing any in flight. */
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
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

  /** Drag the column's inner edge to resize it. */
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
    setPrefs((current) => {
      const next = { ...current };
      if (next.selectedWorkspaceId === workspaceId) delete next.selectedWorkspaceId;
      savePrefs(next);
      return next;
    });
    try {
      await removeWorkspace(workspaceId);
    } catch {
      notify("移除工作区失败");
    }
  }, [clearFor, notify]);

  /**
   * Archive a session from its context menu, with visible feedback — the
   * archive undo toast belongs to the Host's own browser, which this seat
   * replaces, so without a local notice a right-click silently deleted a row.
   */
  const onArchiveSession = useCallback(async (sessionId: string) => {
    try {
      await archiveSession(sessionId);
      notify("已归档会话");
    } catch {
      notify("归档失败：会话可能有正在运行的工作");
    }
  }, [archiveSession, notify]);

  /** Render whichever context menu is open (workspace tile or session row). */
  const menuView = menu === null ? null : menu.target.kind === "workspace" ? (
    <Menu
      menu={menu}
      hasThumbnail={thumbnails[menu.target.workspaceId] !== undefined}
      onClose={() => setMenu(null)}
      onSet={() => { setMenu(null); pickFor((menu.target as { workspaceId: string }).workspaceId); }}
      onClear={() => { clearFor((menu.target as { workspaceId: string }).workspaceId); setMenu(null); }}
      onDelete={() => { setMenu(null); void onDeleteWorkspace((menu.target as { workspaceId: string }).workspaceId); }}
    />
  ) : (
    <SessionMenu
      menu={menu}
      onOpen={() => { openSession((menu.target as { sessionId: string }).sessionId); setMenu(null); }}
      onArchive={() => { setMenu(null); void onArchiveSession((menu.target as { sessionId: string }).sessionId); }}
    />
  );

  // The shared hidden file input and the context menu render in both modes.
  const chrome = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onFileChosen}
      />
      {menuView}
      {toast !== null && <div className="dsh-wsr-toast">{toast}</div>}
    </>
  );

  /** One thumbnail tile, shared by both sidebar widths. */
  const tile = (workspace: WorkspaceView, inColumn: boolean) => {
    const thumb = thumbnails[workspace.workspaceId];
    const isActive = workspace.workspaceId === selectedId;
    const busy = workspace.sessionIds.some((id) => sessions.byId[id]?.running);
    return (
      <button
        type="button"
        className={`dsh-wsr-tile${isActive ? " dsh-wsr-tile--active" : ""}`}
        title={workspace.title}
        aria-label={workspace.title}
        aria-current={inColumn && isActive ? true : undefined}
        onClick={() => {
          if (!wide) expandSidebar();
          select(workspace.workspaceId);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({
            target: { kind: "workspace", workspaceId: workspace.workspaceId },
            x: rect.right + 6,
            y: rect.top,
          });
        }}
      >
        {thumb === undefined
          ? <FolderIcon size={18} />
          : <img className="dsh-wsr-tile__img" src={thumb.src} alt="" draggable={false} />}
        {busy && <span className="dsh-wsr-tile__busy" aria-label="有正在运行的会话" />}
      </button>
    );
  };

  if (!wide) {
    // Collapsed sidebar: the same thumbnails as an icon column, the affordance
    // the Host's own browser gives its session list.
    return (
      <div className="dsh-wsr-browser dsh-wsr-browser--rail">
        {chrome}
        <div className="dsh-wsr-browser__rail-scroll">
          {workspaces.map((workspace) => tile(workspace, false))}
        </div>
      </div>
    );
  }

  const columnWidth = prefs.enabled ? prefs.width : 0;

  return (
    <div className="dsh-wsr-browser">
      {chrome}

      {columnWidth > 0 && (
        <div className="dsh-wsr-column" style={{ width: columnWidth }}>
          <div className="dsh-wsr-column__scroll">
            {workspaces.map((workspace) => (
              <div className="dsh-wsr-tile-wrap" key={workspace.workspaceId}>
                {tile(workspace, true)}
                <span className="dsh-wsr-tile__label">{workspace.title}</span>
              </div>
            ))}
          </div>
          {workspaces.length > 0 && (
            <div
              className="dsh-wsr-resize"
              onPointerDown={onResize}
              role="separator"
              aria-label="调整缩略图列宽度"
            />
          )}
        </div>
      )}

      <div className="dsh-wsr-sessions">
        <div className="dsh-wsr-sessions__head">
          <span className="dsh-wsr-sessions__title">{selected?.title ?? "会话"}</span>
          {selected !== undefined && (
            <button
              type="button"
              className="dsh-wsr-sessions__new"
              title="在此工作区新建会话"
              aria-label="在此工作区新建会话"
              onClick={() => newSessionIn(selected.workspaceId)}
            >
              <ImageIcon size={14} />
            </button>
          )}
        </div>
        <div className="dsh-wsr-sessions__scroll">
          {rows.length === 0 && <div className="dsh-wsr-sessions__empty">暂无会话</div>}
          {rows.map((row) => (
            <button
              type="button"
              key={row.id}
              className={`dsh-wsr-row${row.id === sessions.current ? " dsh-wsr-row--active" : ""}`}
              title={row.displayTitle}
              onClick={() => openSession(row.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({
                  target: { kind: "session", sessionId: row.id },
                  x: rect.right + 6,
                  y: rect.top,
                });
              }}
            >
              {row.running && <span className="dsh-wsr-row__dot" aria-label="运行中" />}
              <span className="dsh-wsr-row__title">{row.displayTitle}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Props the context menu needs. */
interface MenuProps {
  menu: MenuState;
  hasThumbnail: boolean;
  onClose(): void;
  onSet(): void;
  onClear(): void;
  onDelete(): void;
}

/** The right-click menu for one workspace tile. */
function Menu(props: MenuProps) {
  const x = Math.max(4, Math.min(props.menu.x, window.innerWidth - 166));
  const y = Math.max(4, Math.min(props.menu.y, window.innerHeight - 120));
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

/** Props the session context menu needs. */
interface SessionMenuProps {
  menu: MenuState;
  onOpen(): void;
  onArchive(): void;
}

/** The right-click menu for one session row: open it, or archive with feedback. */
function SessionMenu(props: SessionMenuProps) {
  const x = Math.max(4, Math.min(props.menu.x, window.innerWidth - 166));
  const y = Math.max(4, Math.min(props.menu.y, window.innerHeight - 77));
  return (
    <div
      className="dsh-wsr-menu"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onOpen}>
        <OpenIcon size={14} /> 打开
      </button>
      <button
        type="button"
        className="dsh-wsr-menu__item dsh-wsr-menu__item--danger"
        role="menuitem"
        onClick={props.onArchive}
      >
        <ArchiveIcon size={14} /> 归档会话
      </button>
    </div>
  );
}