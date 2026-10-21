import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  CopyIcon,
  FolderIcon,
  GitForkIcon,
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
import { filterByTitle, orderWithPins, resolveDropPosition, resolveSelectedWorkspace, sessionsOfWorkspace } from "./sessions";
import { loadPrefs, loadThumbnails, savePrefs, saveThumbnails } from "./storage";
import type {
  DirectoryListing,
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
  /** Rename a workspace; a duplicate or blank title is refused by the Host. */
  renameWorkspace: (workspaceId: string, title: string) => Promise<void>;
  /**
   * Fork a session from its latest completed turn.
   *
   * @returns the child session id.
   */
  forkSession: (sessionId: string) => Promise<string>;
  /**
   * Move one session before another within the same workspace.
   *
   * @param beforeSessionId - the row to land above; omitted appends to the tail.
   */
  reorderSessions: (
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ) => Promise<void>;
  /** Open the Host-native directory picker; null when the operator cancels. */
  pickDirectory: () => Promise<string | null | undefined>;
  /** List one host directory level for the in-app browser; null on failure. */
  browseDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing | null>;
  /** Create a child directory; the Host throws with its own reason. */
  createDirectory: (path: string, name: string) => Promise<string>;
  /** Register an existing path as a workspace and return its view. */
  addWorkspace: (path: string) => Promise<WorkspaceView>;
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

/** An open inline rename draft, for one workspace tile. */
interface WorkspaceRenameState {
  workspaceId: string;
  /** The title the tile had when the draft opened. */
  original: string;
  /** What the user has typed so far. */
  draft: string;
  /** The Host's refusal, when the last submit failed. */
  error: string | null;
}

/** A session row being dragged to a new position. */
interface DragState {
  /** The session under the pointer. */
  sessionId: string;
  /** Where the row will land. */
  beforeSessionId: string | undefined;
}

/** The in-app directory browser used to add a workspace. */
interface PickerState {
  /** The listing being shown, or null while the first level loads. */
  listing: DirectoryListing | null;
  /** Why the listing cannot be shown. */
  error: string | null;
  /** The level being loaded, so a superseded reply can be dropped. */
  loadingPath: string | undefined;
  /** The "new folder" draft, when the operator asked for one. */
  newFolder: string | null;
  /** Whether a create is in flight. */
  creating: boolean;
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
  renameWorkspace,
  forkSession,
  reorderSessions,
  pickDirectory,
  browseDirectory,
  createDirectory,
  addWorkspace,
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
  const [renamingWorkspace, setRenamingWorkspace] = useState<WorkspaceRenameState | null>(null);
  const [workspaceRenameBusy, setWorkspaceRenameBusy] = useState(false);
  /** The row being dragged, and where it will land. */
  const [drag, setDrag] = useState<DragState | null>(null);
  /** The add-workspace directory browser, when it is open. */
  const [picker, setPicker] = useState<PickerState | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPickRef = useRef<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Aborts the picker's in-flight directory listing on navigation or close. */
  const pickerAbortRef = useRef<AbortController | null>(null);
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

  /** Fork a session; the Host names the child, so nothing is drafted here. */
  const onForkSession = useCallback(async (sessionId: string) => {
    try {
      await forkSession(sessionId);
      notify("已创建分支会话");
    } catch {
      notify("分支失败");
    }
  }, [forkSession, notify]);

  /** Open the inline rename draft for one workspace tile. */
  const startWorkspaceRename = useCallback((workspaceId: string, current: string) => {
    setRenamingWorkspace({ workspaceId, original: current, draft: current, error: null });
    setWorkspaceRenameBusy(false);
  }, []);

  /** Commit the workspace rename draft, keeping the draft open on a refusal. */
  const submitWorkspaceRename = useCallback(async () => {
    if (renamingWorkspace === null || workspaceRenameBusy) return;
    const trimmed = renamingWorkspace.draft.trim();
    // The Host refuses an empty title and a title another workspace already
    // owns; checking both here keeps the draft from closing on a predictable
    // refusal and spares a round trip.
    if (trimmed === "" || trimmed === renamingWorkspace.original) {
      setRenamingWorkspace(null);
      return;
    }
    if (workspaces.some((item) => item.title === trimmed)) {
      setRenamingWorkspace((current) => (current === null
        ? null
        : { ...current, error: "已存在同名工作区" }));
      return;
    }
    setWorkspaceRenameBusy(true);
    try {
      await renameWorkspace(renamingWorkspace.workspaceId, trimmed);
      setRenamingWorkspace(null);
      setPrefs((current) => {
        const next = { ...current };
        if (next.selectedWorkspaceId === renamingWorkspace.workspaceId) {
          next.selectedWorkspaceId = renamingWorkspace.workspaceId;
        }
        savePrefs(next);
        return next;
      });
      notify("已重命名工作区");
    } catch (error) {
      setWorkspaceRenameBusy(false);
      setRenamingWorkspace((current) => (current === null
        ? null
        : { ...current, error: error instanceof Error ? error.message : "重命名失败" }));
    }
  }, [renamingWorkspace, workspaceRenameBusy, renameWorkspace, workspaces, notify]);

  /**
   * Load one directory level into the picker.
   *
   * Each request aborts the one before it, so a slow level never overwrites a
   * fast one the operator already navigated past. A failure keeps the picker
   * open with the reason, because losing the operator's place over a refused
   * read is worse than showing the error in place.
   */
  const loadPickerLevel = useCallback(async (path?: string) => {
    pickerAbortRef.current?.abort();
    const controller = new AbortController();
    pickerAbortRef.current = controller;
    setPicker((current) => (current === null
      ? null
      : { ...current, loadingPath: path, error: null }));
    const listing = await browseDirectory(path, controller.signal);
    if (controller.signal.aborted) return;
    if (listing === null) {
      setPicker((current) => (current === null
        ? null
        : { ...current, loadingPath: undefined, error: "无法读取该目录" }));
      return;
    }
    setPicker((current) => (current === null
      ? null
      : { ...current, listing, error: null, loadingPath: undefined, newFolder: null }));
  }, [browseDirectory]);

  /** Close the add-workspace browser, dropping whatever it had loaded. */
  const closePicker = useCallback(() => {
    pickerAbortRef.current?.abort();
    setPicker(null);
  }, []);

  /** Confirm the picker's current level as a new workspace. */
  const confirmPicker = useCallback(async () => {
    if (picker === null || picker.listing === null) return;
    const path = picker.listing.path;
    // Register first, then close: a refusal keeps the browser where it was, so
    // the operator can pick a different directory instead of starting over.
    try {
      const created = await addWorkspace(path);
      closePicker();
      setPrefs((current) => {
        const next = { ...current, selectedWorkspaceId: created.workspaceId };
        savePrefs(next);
        return next;
      });
      startWorkspace(created.workspaceId);
    } catch (error) {
      setPicker((current) => (current === null
        ? null
        : { ...current, error: error instanceof Error ? error.message : "添加工作区失败" }));
    }
  }, [picker, addWorkspace, closePicker, setPrefs, startWorkspace]);

  /** Create a child directory inside the picker's current level. */
  const submitNewFolder = useCallback(async () => {
    if (picker === null || picker.listing === null) return;
    const name = picker.newFolder?.trim() ?? "";
    if (name === "") {
      setPicker((current) => (current === null ? null : { ...current, newFolder: null }));
      return;
    }
    setPicker((current) => (current === null ? null : { ...current, creating: true }));
    try {
      await createDirectory(picker.listing.path, name);
      // Re-read the level so the new folder appears in its name-sorted place.
      await loadPickerLevel(picker.listing.path);
    } catch (error) {
      setPicker((current) => (current === null
        ? null
        : {
          ...current,
          creating: false,
          error: error instanceof Error ? error.message : "创建文件夹失败",
        }));
    }
  }, [picker, createDirectory, loadPickerLevel]);

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

  /** Open the add-workspace browser on the Host's home directory. */
  const openPicker = useCallback(() => {
    setPicker({ listing: null, error: null, loadingPath: undefined, newFolder: null, creating: false });
    void loadPickerLevel();
  }, [loadPickerLevel]);

  /**
   * Position a drop inside one row.
   *
   * Pinned rows are not move anchors: their order is the Host's pin order, so
   * inserting a session relative to one would be silently undone. A drop over a
   * pinned row is therefore refused, and the drag position stays where it was.
   */
  const onRowDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>, row: SessionSummary) => {
    if (drag === null) return;
    if (pinnedSet.has(row.id)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const lowerHalf = event.clientY >= rect.top + rect.height / 2;
    const next = resolveDropPosition(rows, drag.sessionId, row.id, lowerHalf);
    if (next === null) return;
    setDrag((current) => (current === null
      || current.beforeSessionId === next.beforeSessionId
      ? current
      : { sessionId: current.sessionId, beforeSessionId: next.beforeSessionId }));
  }, [drag, pinnedSet, rows]);

  /** Commit a drop, then always clear the drag state. */
  const onRowDrop = useCallback(async () => {
    const pending = drag;
    setDrag(null);
    if (pending === null || selected === undefined) return;
    try {
      await reorderSessions(selected.workspaceId, pending.sessionId, pending.beforeSessionId);
    } catch {
      notify("调整顺序失败");
    }
  }, [drag, selected, reorderSessions, notify]);

  /** Render whichever context menu is open (workspace tile or session row). */
  const menuView = menu === null ? null : menu.target.kind === "workspace" ? (
    <Menu
      menu={menu}
      hasThumbnail={thumbnails[menu.target.workspaceId] !== undefined}
      onClose={() => setMenu(null)}
      onSet={() => { setMenu(null); pickFor((menu.target as { workspaceId: string }).workspaceId); }}
      onClear={() => { clearFor((menu.target as { workspaceId: string }).workspaceId); setMenu(null); }}
      onRename={() => {
        const workspaceId = (menu.target as { workspaceId: string }).workspaceId;
        setMenu(null);
        startWorkspaceRename(workspaceId, workspaces.find(
          (item) => item.workspaceId === workspaceId,
        )?.title ?? "");
      }}
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
      onFork={() => { setMenu(null); void onForkSession((menu.target as { sessionId: string }).sessionId); }}
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
      {picker !== null && (
        <Picker
          picker={picker}
          onNavigate={(path) => void loadPickerLevel(path)}
          onNewFolderChange={(value) => setPicker(
            (current) => (current === null ? null : { ...current, newFolder: value }),
          )}
          onNewFolderSubmit={() => void submitNewFolder()}
          onConfirm={() => void confirmPicker()}
          onClose={closePicker}
        />
      )}
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
          <button
            type="button"
            className="dsh-wsr-column__add"
            title="添加工作区"
            aria-label="添加工作区"
            onClick={() => {
              if (picker !== null) {
                closePicker();
              } else {
                openPicker();
              }
            }}
          >
            <PlusIcon size={14} />
          </button>
          <div className="dsh-wsr-column__scroll">
            {workspaces.map((workspace) => (
              renamingWorkspace !== null && renamingWorkspace.workspaceId === workspace.workspaceId ? (
                <div className="dsh-wsr-tile-wrap" key={workspace.workspaceId}>
                  <span className="dsh-wsr-tile dsh-wsr-tile--ghost">
                    <FolderIcon size={18} />
                  </span>
                  <input
                    className="dsh-wsr-rename dsh-wsr-rename--tile"
                    type="text"
                    value={renamingWorkspace.draft}
                    aria-label={`重命名 ${workspace.title}`}
                    autoFocus
                    disabled={workspaceRenameBusy}
                    onChange={(e) => setRenamingWorkspace(
                      (current) => (current === null
                        ? null
                        : { ...current, draft: e.target.value, error: null }),
                    )}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void submitWorkspaceRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRenamingWorkspace(null);
                      }
                    }}
                    onBlur={() => void submitWorkspaceRename()}
                  />
                  {renamingWorkspace.error !== null && (
                    <span className="dsh-wsr-tile__error">{renamingWorkspace.error}</span>
                  )}
                </div>
              ) : (
                <div className="dsh-wsr-tile-wrap" key={workspace.workspaceId}>
                  {tile(workspace, true)}
                  <span className="dsh-wsr-tile__label">{workspace.title}</span>
                </div>
              )
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
                    className={`dsh-wsr-row${
                      row.id === sessions.current ? " dsh-wsr-row--active" : ""
                    }${
                      drag !== null && drag.sessionId === row.id ? " dsh-wsr-row--dragging" : ""
                    }${
                      drag !== null
                        && drag.beforeSessionId === row.id
                        && drag.sessionId !== row.id
                        ? " dsh-wsr-row--drop-before" : ""
                    }${
                      drag !== null
                        && drag.beforeSessionId === undefined
                        && row.id === rows[rows.length - 1]?.id
                        && drag.sessionId !== row.id
                        ? " dsh-wsr-row--drop-after" : ""
                    }`}
                    title={row.displayTitle}
                    draggable={renaming === null}
                    onClick={() => openSession(row.id)}
                    onDragStart={(e) => {
                      if (renaming !== null) return;
                      e.dataTransfer.effectAllowed = "move";
                      setDrag({ sessionId: row.id, beforeSessionId: undefined });
                    }}
                    onDragOver={(e) => {
                      if (drag === null) return;
                      // preventDefault is what makes this element a drop target.
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      onRowDragOver(e, row);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      void onRowDrop();
                    }}
                    onDragEnd={() => setDrag(null)}
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
  onRename(): void;
  onDelete(): void;
}

/** The right-click menu for one workspace tile. */
function Menu(props: MenuProps) {
  const x = Math.max(4, Math.min(props.menu.x, window.innerWidth - 166));
  const y = Math.max(4, Math.min(props.menu.y, window.innerHeight - 160));
  return (
    <div
      className="dsh-wsr-menu"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onRename}>
        <PencilIcon size={14} /> 重命名
      </button>
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

/** Props the add-workspace directory browser needs. */
interface PickerProps {
  picker: PickerState;
  onNavigate(path: string): void;
  onNewFolderChange(value: string): void;
  onNewFolderSubmit(): void;
  onConfirm(): void;
  onClose(): void;
}

/**
 * The in-app directory browser for adding a workspace.
 *
 * It renders the Host's own listing (`crumbs` + `entries`, both with absolute
 * paths the client never has to join) so navigation is a crumb click or a row
 * double-click, and the current level is what the confirm button registers.
 *
 * The Host's native picker remains the one-click path; this browser is for
 * browsing into a nested directory without leaving the app.
 */
function Picker(props: PickerProps) {
  const { listing, error, loadingPath, newFolder, creating } = props.picker;

  // Close on Escape, matching every other dismissible surface in the rail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  return (
    <div className="dsh-wsr-picker" role="dialog" aria-label="添加工作区">
      <div className="dsh-wsr-picker__head">
        <span className="dsh-wsr-picker__title">添加工作区</span>
        <button
          type="button"
          className="dsh-wsr-picker__close"
          aria-label="关闭"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>

      <div className="dsh-wsr-picker__crumbs">
        {listing?.crumbs.map((crumb) => (
          <button
            type="button"
            key={crumb.path}
            className={`dsh-wsr-picker__crumb${
              listing.path === crumb.path ? " dsh-wsr-picker__crumb--current" : ""
            }`}
            onClick={() => props.onNavigate(crumb.path)}
            title={crumb.path}
          >
            {crumb.name}
          </button>
        ))}
      </div>

      <div className="dsh-wsr-picker__body">
        {listing === null && loadingPath !== undefined && (
          <div className="dsh-wsr-picker__empty">读取中…</div>
        )}
        {listing !== null && listing.entries.length === 0 && (
          <div className="dsh-wsr-picker__empty">没有子目录</div>
        )}
        {listing?.entries.map((entry) => (
          <button
            type="button"
            key={entry.path}
            className="dsh-wsr-picker__row"
            onDoubleClick={() => props.onNavigate(entry.path)}
            title={`${entry.name}\n${entry.path}`}
          >
            <FolderIcon size={14} />
            <span className="dsh-wsr-picker__row-name">{entry.name}</span>
          </button>
        ))}
      </div>

      {listing?.truncated === true && (
        <div className="dsh-wsr-picker__note">目录过多，仅显示前面一部分；请输入路径进入更深层级</div>
      )}

      <div className="dsh-wsr-picker__new">
        <input
          type="text"
          className="dsh-wsr-search"
          placeholder="新建文件夹名称"
          aria-label="新建文件夹名称"
          value={newFolder ?? ""}
          disabled={creating}
          onChange={(e) => props.onNewFolderChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              props.onNewFolderSubmit();
            }
          }}
        />
        <button
          type="button"
          className="dsh-wsr-picker__action"
          disabled={creating || (newFolder ?? "").trim() === ""}
          onClick={props.onNewFolderSubmit}
        >
          新建
        </button>
      </div>

      {error !== null && <div className="dsh-wsr-picker__error">{error}</div>}

      <div className="dsh-wsr-picker__foot">
        <span className="dsh-wsr-picker__path" title={listing?.path}>
          {listing?.path ?? ""}
        </span>
        <button
          type="button"
          className="dsh-wsr-picker__action dsh-wsr-picker__action--primary"
          disabled={listing === null}
          onClick={props.onConfirm}
        >
          选择此目录
        </button>
      </div>
    </div>
  );
}

/** Props the session context menu needs. */
interface SessionMenuProps {
  menu: MenuState;
  onOpen(): void;
  onRename(): void;
  onCopyId(): void;
  onFork(): void;
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
  const y = Math.max(4, Math.min(props.menu.y, window.innerHeight - 237));
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
      <button type="button" className="dsh-wsr-menu__item" role="menuitem" onClick={props.onFork}>
        <GitForkIcon size={14} /> 分支此会话
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