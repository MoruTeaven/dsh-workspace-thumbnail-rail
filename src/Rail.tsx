import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  CopyIcon,
  FolderIcon,
  ImageIcon,
  ImageOffIcon,
  OpenIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "./icons";
import { ThumbnailError, makeThumbnail } from "./image";
import { filterByTitle, orderWithPins, resolveSelectedWorkspace, sessionsOfWorkspace } from "./sessions";
import { loadPrefs, loadThumbnails, savePrefs, saveThumbnails } from "./storage";
import type {
  RailPreferences,
  SessionListState,
  SessionSearchHit,
  SessionSummary,
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
  /** Restore an archived session to its recorded workspace position. */
  unarchiveSession: (sessionId: string) => Promise<void>;
  /**
   * Search the Host's message-content index across every workspace.
   *
   * @returns the bounded page, or null when the search failed (already logged
   * by the Host) — the UI shows "no results" either way.
   */
  searchSessions: (
    query: string,
    signal: AbortSignal,
  ) => Promise<{ items: SessionSearchHit[]; hasMore: boolean } | null>;
  /**
   * Rename a session.
   *
   * @throws with the Host's reason when it refuses (empty title, duplicate, or
   * a session whose write is not permitted).
   */
  renameSession: (sessionId: string, title: string) => Promise<void>;
  /** Pin a session; undefined when the Host build does not expose pinning. */
  pinSession?: (sessionId: string) => Promise<void>;
  /** Remove a session's pin; undefined when the Host build lacks pinning. */
  unpinSession?: (sessionId: string) => Promise<void>;
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

/** What the session column shows: the workspace's rows, or a search result. */
type SessionPane =
  | { kind: "list" }
  | { kind: "search"; query: string }
  | { kind: "archive" };

/** An open inline rename draft, for one session row. */
interface RenameState {
  sessionId: string;
  /** The title the row had when the draft opened, so "unchanged" is detectable. */
  original: string;
  /** What the user has typed so far. */
  draft: string;
  /** The Host's refusal, when the last submit failed. */
  error: string | null;
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
  unarchiveSession,
  searchSessions,
  renameSession,
  pinSession,
  unpinSession,
}: RailProps) {
  const workspaces = useWorkspaces((state) => state.items);
  const archived = useWorkspaces((state) => state.archivedSessionIds);
  // The Host's registry-global pin set, in pin order. Pinned sessions are
  // surfaced above every unpinned one on the Host's own grouping surfaces, so
  // the rail mirrors that ordering rather than inventing its own.
  const pinned = useWorkspaces((state) => state.pinnedSessionIds);
  const sessions = useSessions((state) => ({
    ids: state.ids,
    byId: state.byId,
    current: state.current,
  }));

  const [thumbnails, setThumbnails] = useState<ThumbnailMap>(() => loadThumbnails());
  const [prefs, setPrefs] = useState<RailPreferences>(() => loadPrefs());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Search box + which pane the session column renders.
  const [query, setQuery] = useState("");
  const [pane, setPane] = useState<SessionPane>({ kind: "list" });
  const [hits, setHits] = useState<SessionSearchHit[] | null>(null);
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPickRef = useRef<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
   * Run the Host search as the user types.
   *
   * Debounced, because every keystroke is a Host RPC against the message index.
   * A superseded request is aborted rather than awaited, so the newest query
   * always wins and a slow response for abandoned text never lands. Only the
   * search pane shows hits: the title filter in the list pane needs no request.
   */
  useEffect(() => {
    if (pane.kind !== "search") return;
    if (searchTimerRef.current !== undefined) clearTimeout(searchTimerRef.current);
    if (query.trim() === "") {
      searchAbortRef.current?.abort();
      setHits(null);
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      void searchSessions(query, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setHits(result === null ? [] : result.items);
      });
    }, 250);
    return () => {
      if (searchTimerRef.current !== undefined) clearTimeout(searchTimerRef.current);
    };
  }, [pane.kind, query, searchSessions]);

  // Abort whatever search is in flight when the rail unmounts.
  useEffect(() => () => {
    searchAbortRef.current?.abort();
    if (searchTimerRef.current !== undefined) clearTimeout(searchTimerRef.current);
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

  const rows = useMemo(() => {
    if (selected === undefined) return [];
    const all = sessionsOfWorkspace(selected, sessions, { archived, current: sessions.current });
    // The title filter is a local, instant refinement of the same rows; the
    // Host content search is the deeper pane the search button switches to.
    const visible = pane.kind === "list" ? filterByTitle(all, query) : all;
    // Pinned sessions lead, in the Host's own pin order; the rest keep the
    // newest-first order underneath, so the mirror matches what the Host shows.
    return orderWithPins(visible, pinned ?? []);
  }, [selected, sessions, archived, pane.kind, query, pinned]);

  /**
   * The archived sessions, newest first.
   *
   * The archive set is registry-global (it spans every workspace), so these rows
   * are collected from the whole session list rather than from the selected
   * workspace. They keep the same "skip ids the list has not seen yet" rule as
   * the live rows, because a session whose summary is still loading has no title
   * to show and cannot be opened yet.
   */
  const archivedRows = useMemo(() => {
    if (pane.kind !== "archive") return [];
    const rows: SessionSummary[] = [];
    for (const id of archived) {
      const summary = sessions.byId[id];
      if (summary === undefined) continue;
      rows.push(summary);
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [pane.kind, archived, sessions.byId]);

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

  /** Copy a session id, with feedback — the clipboard API is silently refused
   *  outside a secure context, so a failure must not leave the user guessing. */
  const onCopySessionId = useCallback(async (sessionId: string) => {
    try {
      await navigator.clipboard.writeText(sessionId);
      notify("已复制会话 ID");
    } catch {
      notify("复制失败：请检查浏览器剪贴板权限");
    }
  }, [notify]);

  /** Restore one archived session from the archive pane. */
  const onUnarchive = useCallback(async (sessionId: string) => {
    try {
      await unarchiveSession(sessionId);
      notify("已恢复会话");
    } catch {
      notify("恢复失败");
    }
  }, [notify, unarchiveSession]);

  /** Membership test for the pin set, rebuilt only when the Host's set changes. */
  const pinnedSet = useMemo(() => new Set(pinned ?? []), [pinned]);

  /** Pin one session; a Host refusal is reported without losing the row. */
  const onPinSession = useCallback(async (sessionId: string) => {
    if (pinSession === undefined) return;
    try {
      await pinSession(sessionId);
    } catch {
      notify("置顶失败");
    }
  }, [notify, pinSession]);

  /** Remove one session's pin; a Host refusal is reported the same way. */
  const onUnpinSession = useCallback(async (sessionId: string) => {
    if (unpinSession === undefined) return;
    try {
      await unpinSession(sessionId);
    } catch {
      notify("取消置顶失败");
    }
  }, [notify, unpinSession]);

  /** Switch the session column between the workspace list, search and archive. */
  const showPane = useCallback((next: SessionPane) => {
    setPane(next);
    setRenaming(null);
    setRenameBusy(false);
    if (next.kind !== "search") {
      searchAbortRef.current?.abort();
      if (searchTimerRef.current !== undefined) clearTimeout(searchTimerRef.current);
      setHits(null);
    }
    if (next.kind !== "list") setQuery("");
  }, []);

  /** Open the inline rename draft for one session row. */
  const startRename = useCallback((sessionId: string, current: string) => {
    setRenaming({ sessionId, original: current, draft: current, error: null });
    setRenameBusy(false);
  }, []);

  /** Commit the rename draft, surfacing the Host's refusal on the row. */
  const submitRename = useCallback(async () => {
    if (renaming === null || renameBusy) return;
    const trimmed = renaming.draft.trim();
    if (trimmed === "" || trimmed === renaming.original) {
      setRenaming(null);
      return;
    }
    setRenameBusy(true);
    try {
      await renameSession(renaming.sessionId, trimmed);
      setRenaming(null);
      notify("已重命名会话");
    } catch (error) {
      setRenameBusy(false);
      setRenaming((current) => (current === null
        ? null
        : { ...current, error: error instanceof Error ? error.message : "重命名失败" }));
    }
  }, [renaming, renameBusy, renameSession, notify]);

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
      onRename={() => {
        const sessionId = (menu.target as { sessionId: string }).sessionId;
        setMenu(null);
        showPane({ kind: "list" });
        startRename(sessionId, sessions.byId[sessionId]?.displayTitle ?? "");
      }}
      onCopyId={() => { setMenu(null); void onCopySessionId((menu.target as { sessionId: string }).sessionId); }}
      onPin={pinSession === undefined ? undefined : () => {
        const sessionId = (menu.target as { sessionId: string }).sessionId;
        setMenu(null);
        void onPinSession(sessionId);
      }}
      onUnpin={unpinSession === undefined ? undefined : () => {
        const sessionId = (menu.target as { sessionId: string }).sessionId;
        setMenu(null);
        void onUnpinSession(sessionId);
      }}
      pinned={menu.target.kind === "session" && pinnedSet.has(menu.target.sessionId)}
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
        {pane.kind === "list" && (
          <div className="dsh-wsr-sessions__head">
            <span className="dsh-wsr-sessions__title">{selected?.title ?? "会话"}</span>
            <div className="dsh-wsr-sessions__actions">
              <button
                type="button"
                className="dsh-wsr-sessions__new"
                title="查看归档会话"
                aria-label="查看归档会话"
                onClick={() => showPane({ kind: "archive" })}
              >
                <ArchiveRestoreIcon size={14} />
              </button>
              <button
                type="button"
                className="dsh-wsr-sessions__new"
                title="搜索全部会话内容"
                aria-label="搜索全部会话内容"
                onClick={() => showPane({ kind: "search", query: "" })}
              >
                <SearchIcon size={14} />
              </button>
              {selected !== undefined && (
                <button
                  type="button"
                  className="dsh-wsr-sessions__new"
                  title="在此工作区新建会话"
                  aria-label="在此工作区新建会话"
                  onClick={() => newSessionIn(selected.workspaceId)}
                >
                  <PlusIcon size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {pane.kind === "search" && (
          <div className="dsh-wsr-sessions__head">
            <button
              type="button"
              className="dsh-wsr-sessions__new"
              title="返回会话列表"
              aria-label="返回会话列表"
              onClick={() => showPane({ kind: "list" })}
            >
              <ArrowLeftIcon size={14} />
            </button>
            <input
              className="dsh-wsr-search"
              type="text"
              value={query}
              placeholder="搜索会话内容"
              aria-label="搜索会话内容"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") showPane({ kind: "list" });
              }}
            />
          </div>
        )}

        {pane.kind === "archive" && (
          <div className="dsh-wsr-sessions__head">
            <button
              type="button"
              className="dsh-wsr-sessions__new"
              title="返回会话列表"
              aria-label="返回会话列表"
              onClick={() => showPane({ kind: "list" })}
            >
              <ArrowLeftIcon size={14} />
            </button>
            <span className="dsh-wsr-sessions__title">归档的会话</span>
          </div>
        )}

        <div className="dsh-wsr-sessions__scroll">
          {pane.kind === "list" && (
            <>
              {rows.length === 0 && (
                <div className="dsh-wsr-sessions__empty">
                  {query.trim() === "" ? "暂无会话" : "没有匹配的会话"}
                </div>
              )}
              {rows.map((row) => (
                renaming !== null && renaming.sessionId === row.id ? (
                  <div className="dsh-wsr-row dsh-wsr-row--rename" key={row.id}>
                    <input
                      className="dsh-wsr-rename"
                      type="text"
                      value={renaming.draft}
                      aria-label={`重命名 ${row.displayTitle}`}
                      autoFocus
                      disabled={renameBusy}
                      onChange={(e) => setRenaming(
                        (current) => (current === null ? null : { ...current, draft: e.target.value, error: null }),
                      )}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenaming(null);
                        }
                      }}
                      onBlur={() => {
                        // A blur commits the same draft, so clicking away never
                        // silently discards a half-typed title.
                        void submitRename();
                      }}
                    />
                    {renaming.error !== null && (
                      <span className="dsh-wsr-rename__error">{renaming.error}</span>
                    )}
                  </div>
                ) : (
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
                    {pinnedSet.has(row.id) && (
                      <PinIcon size={12} className="dsh-wsr-row__pin" aria-label="已置顶" />
                    )}
                    {row.running && <span className="dsh-wsr-row__dot" aria-label="运行中" />}
                    <span className="dsh-wsr-row__title">{row.displayTitle}</span>
                  </button>
                )
              ))}
            </>
          )}

          {pane.kind === "search" && (
            <>
              {hits === null && (
                <div className="dsh-wsr-sessions__empty">
                  {query.trim() === "" ? "请输入关键词" : "搜索中…"}
                </div>
              )}
              {hits !== null && hits.length === 0 && (
                <div className="dsh-wsr-sessions__empty">没有找到相关会话</div>
              )}
              {hits?.map((hit) => (
                <button
                  type="button"
                  key={hit.sessionId}
                  className={`dsh-wsr-row dsh-wsr-row--stack${hit.sessionId === sessions.current ? " dsh-wsr-row--active" : ""}`}
                  onClick={() => openSession(hit.sessionId)}
                >
                  <span className="dsh-wsr-row__title">
                    {sessions.byId[hit.sessionId]?.displayTitle ?? hit.sessionId}
                  </span>
                  {hit.snippet !== "" && <span className="dsh-wsr-row__snippet">{hit.snippet}</span>}
                </button>
              ))}
            </>
          )}

          {pane.kind === "archive" && (
            <>
              {archivedRows.length === 0 && (
                <div className="dsh-wsr-sessions__empty">没有归档的会话</div>
              )}
              {archivedRows.map((row) => (
                <div
                  key={row.id}
                  className="dsh-wsr-row dsh-wsr-row--stack"
                  title={row.displayTitle}
                >
                  <span className="dsh-wsr-row__title">{row.displayTitle}</span>
                  <button
                    type="button"
                    className="dsh-wsr-row__restore"
                    title="恢复到列表"
                    aria-label={`恢复 ${row.displayTitle}`}
                    onClick={() => void onUnarchive(row.id)}
                  >
                    恢复
                  </button>
                </div>
              ))}
            </>
          )}
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
  onRename(): void;
  onCopyId(): void;
  /** Present only when the Host build exposes pinning. */
  onPin?(): void;
  /** Present only when the Host build exposes pinning. */
  onUnpin?(): void;
  /** Whether this session is currently pinned. */
  pinned: boolean;
  onArchive(): void;
}

/** The right-click menu for one session row. */
function SessionMenu(props: SessionMenuProps) {
  const x = Math.max(4, Math.min(props.menu.x, window.innerWidth - 166));
  const y = Math.max(4, Math.min(props.menu.y, window.innerHeight - 197));
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
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onRename}>
        <PencilIcon size={14} /> 重命名
      </button>
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onCopyId}>
        <CopyIcon size={14} /> 复制会话 ID
      </button>
      {props.onPin !== undefined && props.onUnpin !== undefined && (
        <button
          type="button"
          className="dsh-wsr-menu__item"
          role="menuitem"
          onClick={props.pinned ? props.onUnpin : props.onPin}
        >
          <PinIcon size={14} /> {props.pinned ? "取消置顶" : "置顶"}
        </button>
      )}
      <div className="dsh-wsr-menu__sep" />
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