/**
 * Self-test for the pure logic of the rail.
 *
 * The DOM-facing halves (canvas compression, frame patching) cannot run under
 * node, so this covers what can: the storage validators and the rail's
 * geometry maths. It runs through `pnpm test` after an esbuild bundle.
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
const { widenFirst } = await import("./frame.js");

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

console.log("frame geometry");

check("widens the FIRST track so the rail is the leftmost column", () => {
  assert.deepEqual(widenFirst([280, 1000], 72, 0), [352, 1000]);
});

check("leaves every track after the first untouched", () => {
  const [first, center, details] = widenFirst([280, 1000, 360], 72, 0);
  assert.equal(first, 352);
  assert.equal(center, 1000);
  assert.equal(details, 360);
});

check("is idempotent across repeated observer runs", () => {
  // First call adds 72 to the first track; the observer then sees 352 and must
  // not add another 72 because it subtracts the previous contribution first.
  const once = widenFirst([280, 1000], 72, 0);
  const twice = widenFirst(once, 72, 72);
  assert.deepEqual(twice, once);
});

check("never shrinks the first track below zero", () => {
  assert.deepEqual(widenFirst([30, 1000], 72, 0), [102, 1000]);
});

check("returns the input untouched when the rail is hidden", () => {
  assert.deepEqual(widenFirst([280, 1000, 360], 0, 0), [280, 1000, 360]);
});

check("returns the input untouched with too few tracks", () => {
  assert.deepEqual(widenFirst([280], 72, 0), [280]);
});

console.log(`\n${passed} checks passed`);