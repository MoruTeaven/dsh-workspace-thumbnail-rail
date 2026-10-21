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
const { resolveSelectedWorkspace, sessionsOfWorkspace, filterByTitle, orderWithPins, resolveDropPosition } = await import("./sessions.js");
type SessionList = import("./types.js").SessionListState;
type SessionSummary = import("./types.js").SessionSummary;
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

const session = (id: string, updatedAt: number, blank = false): SessionSummary => ({
  id,
  displayTitle: id,
  updatedAt,
  running: false,
  blank,
});

/** A session row with a display title that differs from its id. */
const titled = (id: string, displayTitle: string, updatedAt: number): SessionSummary => ({
  id,
  displayTitle,
  updatedAt,
  running: false,
  blank: false,
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

console.log("title filter");

check("an empty query keeps every row in order", () => {
  const rows = [session("s1", 100), session("s2", 200)];
  assert.deepEqual(filterByTitle(rows, ""), rows);
  assert.deepEqual(filterByTitle(rows, "   "), rows);
});
check("matches case-insensitively on the display title", () => {
  const rows = [titled("s1", "Alpha release", 100), titled("s2", "beta test", 200), titled("s3", "ALPHA two", 300)];
  assert.deepEqual(
    filterByTitle(rows, "alpha").map((r) => r.id),
    ["s1", "s3"],
  );
});

check("matches on the title, not the session id", () => {
  const rows = [titled("session-alpha", "a plain row", 100), titled("s2", "Alpha row", 200)];
  assert.deepEqual(
    filterByTitle(rows, "alpha").map((r) => r.id),
    ["s2"],
  );
});

check("returns nothing when no title matches", () => {
  const rows = [titled("s1", "release notes", 100)];
  assert.deepEqual(filterByTitle(rows, "zzz"), []);
});

check("keeps the display order of the matches", () => {
  const rows = [titled("c", "cat", 1), titled("a", "apple", 2), titled("b", "ant", 3)];
  assert.deepEqual(
    filterByTitle(rows, "a").map((r) => r.id),
    ["c", "a", "b"],
  );
});

console.log("pin ordering");

check("pinned rows lead, the rest keep the incoming order", () => {
  const rows = [titled("a", "a", 1), titled("b", "b", 2), titled("c", "c", 3), titled("d", "d", 4)];
  assert.deepEqual(
    orderWithPins(rows, ["c", "a"]).map((r) => r.id),
    ["c", "a", "b", "d"],
    "the caller already decided the unpinned order; pinning must not re-sort it",
  );
});

check("the pin order comes from the host, not from recency", () => {
  const rows = [titled("new", "new", 500), titled("old", "old", 1)];
  assert.deepEqual(orderWithPins(rows, ["old"]).map((r) => r.id), ["old", "new"]);
});

check("an empty pin set leaves the rows in the incoming order", () => {
  const rows = [titled("a", "a", 1), titled("b", "b", 2)];
  assert.deepEqual(orderWithPins(rows, []).map((r) => r.id), ["a", "b"]);
});

check("pin ids that are not on screen do not disturb the order", () => {
  const rows = [titled("a", "a", 1), titled("b", "b", 2)];
  assert.deepEqual(orderWithPins(rows, ["ghost", "b"]).map((r) => r.id), ["b", "a"]);
});

console.log("drop position");

const four = () => [titled("a", "a", 4), titled("b", "b", 3), titled("c", "c", 2), titled("d", "d", 1)];

/** The order the rows would end up in if this drop were applied. */
function afterDrop(
  rows: readonly SessionSummary[],
  sessionId: string,
  targetId: string,
  lowerHalf: boolean,
): string[] | null {
  const drop = resolveDropPosition(rows, sessionId, targetId, lowerHalf);
  if (drop === null) return null;
  const moved = rows.filter((row) => row.id !== drop.sessionId);
  if (drop.beforeSessionId === undefined) return [...moved.map((r) => r.id), drop.sessionId];
  const at = moved.findIndex((row) => row.id === drop.beforeSessionId);
  return [...moved.slice(0, at).map((r) => r.id), drop.sessionId, ...moved.slice(at).map((r) => r.id)];
}

check("upper half lands the row above the target", () => {
  assert.deepEqual(afterDrop(four(), "d", "b", false), ["a", "d", "b", "c"]);
});

check("lower half lands the row below the target", () => {
  assert.deepEqual(afterDrop(four(), "a", "b", true), ["b", "a", "c", "d"]);
});

check("the lower half of the last row appends", () => {
  assert.deepEqual(afterDrop(four(), "a", "d", true), ["b", "c", "d", "a"]);
});

check("a drop that does not reorder is refused", () => {
  // d already sits immediately below c, so dropping on its lower half — "above
  // the row after c", i.e. above d itself — leaves the order alone.
  assert.equal(resolveDropPosition(four(), "d", "c", true), null);
  // Dropping on c's upper half does move d (it lands above c instead of below).
  assert.deepEqual(afterDrop(four(), "d", "c", false), ["a", "b", "d", "c"]);
});

check("dropping a row onto itself is refused", () => {
  assert.equal(resolveDropPosition(four(), "b", "b", false), null);
  assert.equal(resolveDropPosition(four(), "b", "b", true), null);
});

check("an unknown target is refused", () => {
  assert.equal(resolveDropPosition(four(), "a", "ghost", false), null);
  assert.equal(resolveDropPosition(four(), "ghost", "b", false), null);
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