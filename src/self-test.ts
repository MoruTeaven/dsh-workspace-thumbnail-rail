/**
 * Self-test for the pure logic of the workspace browser.
 *
 * The DOM-facing halves (canvas compression, React rendering) cannot run under
 * node, so this covers what can: the storage validators, the session projection
 * and the workspace-selection rules. It runs through `pnpm test` after an
 * esbuild bundle.
 */

import { strict as assert } from "node:assert";

// Minimal localStorage stand-in so the storage module loads outside a browser.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: () => null,
  length: 0,
} as unknown as Storage;

const { DEFAULT_PREFS, loadPrefs, loadThumbnails, savePrefs, saveThumbnails } = await import("./storage.js");
const { resolveSelectedWorkspace, sessionsOfWorkspace } = await import("./sessions.js");
type SessionList = import("./types.js").SessionListState;
type Workspace = import("./types.js").WorkspaceView;

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("storage");

check("empty storage yields an empty map", () => {
  assert.deepEqual(loadThumbnails(), {});
});

check("round-trips a valid thumbnail", () => {
  const record = { src: "data:image/webp;base64,AAAA", bytes: 3, updatedAt: 1700000000000 };
  assert.equal(saveThumbnails({ "ws-1": record }), true);
  assert.deepEqual(loadThumbnails(), { "ws-1": record });
});

check("drops records with a non-data-URL src", () => {
  store.set("dsh.wsr.thumbnails.v1", JSON.stringify({
    good: { src: "data:image/png;base64,AAAA", bytes: 3, updatedAt: 1 },
    bad: { src: "https://evil.example/x.png", bytes: 9, updatedAt: 1 },
  }));
  assert.deepEqual(Object.keys(loadThumbnails()), ["good"]);
});

check("drops records with missing fields", () => {
  store.set("dsh.wsr.thumbnails.v1", JSON.stringify({
    a: { src: "data:image/png;base64,AAAA" },
    b: { src: "data:image/png;base64,AAAA", bytes: 3, updatedAt: 1 },
  }));
  assert.deepEqual(Object.keys(loadThumbnails()), ["b"]);
});

check("survives corrupt JSON", () => {
  store.set("dsh.wsr.thumbnails.v1", "{not json");
  assert.deepEqual(loadThumbnails(), {});
});

console.log("preferences");

check("defaults to a 72px visible rail", () => {
  store.delete("dsh.wsr.prefs.v1");
  assert.deepEqual(loadPrefs(), DEFAULT_PREFS);
  assert.equal(DEFAULT_PREFS.width, 72);
  assert.equal(DEFAULT_PREFS.enabled, true);
});

check("round-trips preferences", () => {
  assert.equal(savePrefs({ width: 96, enabled: false }), true);
  assert.deepEqual(loadPrefs(), { width: 96, enabled: false });
});

check("clamps an out-of-range width", () => {
  store.set("dsh.wsr.prefs.v1", JSON.stringify({ width: 9999, enabled: true }));
  assert.equal(loadPrefs().width, 160);
  store.set("dsh.wsr.prefs.v1", JSON.stringify({ width: 1, enabled: true }));
  assert.equal(loadPrefs().width, 48);
});

check("falls back on a non-numeric width", () => {
  store.set("dsh.wsr.prefs.v1", JSON.stringify({ width: "wide", enabled: "yes" }));
  assert.deepEqual(loadPrefs(), { width: 72, enabled: true });
});

console.log("session projection");

const ws = (workspaceId: string, sessionIds: string[]): Workspace => ({
  workspaceId,
  path: `C:/tmp/${workspaceId}`,
  title: workspaceId,
  sessionIds,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const session = (id: string, updatedAt: number, blank = false): SessionList["byId"][string] => ({
  id,
  displayTitle: id,
  updatedAt,
  running: false,
  blank,
});

/** A session list snapshot with an explicitly optional current session. */
const list = (
  byId: SessionList["byId"],
  current?: string,
): SessionList => ({ ids: Object.keys(byId), byId, current });

check("lists only the selected workspace's sessions, newest first", () => {
  const rows = sessionsOfWorkspace(
    ws("a", ["s1", "s2"]),
    list({ s1: session("s1", 100), s2: session("s2", 200) }),
    { archived: [], current: undefined },
  );
  assert.deepEqual(rows.map((r) => r.id), ["s2", "s1"]);
});

check("never shows another workspace's sessions", () => {
  const rows = sessionsOfWorkspace(
    ws("a", ["s1"]),
    list({ s1: session("s1", 100), s2: session("s2", 200) }),
    { archived: [], current: undefined },
  );
  assert.deepEqual(rows.map((r) => r.id), ["s1"]);
});

check("hides archived sessions", () => {
  const rows = sessionsOfWorkspace(
    ws("a", ["s1", "s2"]),
    list({ s1: session("s1", 100), s2: session("s2", 200) }),
    { archived: ["s2"], current: undefined },
  );
  assert.deepEqual(rows.map((r) => r.id), ["s1"]);
});

check("hides blank sessions except the open one", () => {
  const blanks = { b1: session("b1", 100, true), b2: session("b2", 200, true) };
  assert.deepEqual(
    sessionsOfWorkspace(ws("a", ["b1", "b2"]), list(blanks), { archived: [], current: undefined }),
    [],
    "a blank row that is not open would do nothing when clicked",
  );
  assert.deepEqual(
    sessionsOfWorkspace(ws("a", ["b1", "b2"]), list(blanks, "b1"), { archived: [], current: "b1" })
      .map((r) => r.id),
    ["b1"],
  );
});

check("skips session ids the list has not seen yet", () => {
  const rows = sessionsOfWorkspace(
    ws("a", ["s1", "ghost"]),
    list({ s1: session("s1", 100) }),
    { archived: [], current: undefined },
  );
  assert.deepEqual(rows.map((r) => r.id), ["s1"]);
});

console.log("workspace selection");

check("a remembered selection wins", () => {
  const list = [ws("a", ["s1"]), ws("b", ["s2"])];
  assert.equal(resolveSelectedWorkspace(list, "b", "s1"), "b");
});

check("falls back to the workspace owning the current session", () => {
  const list = [ws("a", ["s1"]), ws("b", ["s2"])];
  assert.equal(resolveSelectedWorkspace(list, undefined, "s2"), "b");
});

check("falls back to the first workspace", () => {
  const list = [ws("a", ["s1"]), ws("b", ["s2"])];
  assert.equal(resolveSelectedWorkspace(list, undefined, undefined), "a");
});

check("ignores a remembered selection that no longer exists", () => {
  const list = [ws("a", ["s1"]), ws("b", ["s2"])];
  assert.equal(resolveSelectedWorkspace(list, "gone", "s2"), "b");
});

check("returns undefined when there are no workspaces", () => {
  assert.equal(resolveSelectedWorkspace([], "a", undefined), undefined);
});

console.log(`\n${passed} checks passed`);