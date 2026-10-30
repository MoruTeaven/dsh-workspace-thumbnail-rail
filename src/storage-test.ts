/**
 * Storage normalization tests.
 *
 * These cover the thumbnail record loader: the v1 storage shape was
 * image-only with no `kind`, so old maps must keep loading, and one bad
 * entry must be dropped instead of poisoning the map.
 */

import { strict as assert } from "node:assert";
import { DEFAULT_PREFS, normalizeThumbnail } from "./storage";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("thumbnail storage");

check("typed image records round-trip", () => {
  assert.deepEqual(
    normalizeThumbnail({ kind: "image", src: "data:image/webp,AAAA", bytes: 4, updatedAt: 7 }),
    { kind: "image", src: "data:image/webp,AAAA", bytes: 4, updatedAt: 7 },
  );
});

check("v1 records without a kind are read as images", () => {
  assert.deepEqual(
    normalizeThumbnail({ src: "data:image/png,AAAA", bytes: 4, updatedAt: 7 }),
    { kind: "image", src: "data:image/png,AAAA", bytes: 4, updatedAt: 7 },
  );
});

check("typed text records need non-empty text and color", () => {
  assert.deepEqual(
    normalizeThumbnail({ kind: "text", text: "茶", color: "#4f46e5", updatedAt: 7 }),
    { kind: "text", text: "茶", color: "#4f46e5", updatedAt: 7 },
  );
  assert.equal(normalizeThumbnail({ kind: "text", text: "", color: "#4f46e5", updatedAt: 7 }), null);
  assert.equal(normalizeThumbnail({ kind: "text", text: "茶", color: "", updatedAt: 7 }), null);
});

check("garbage is dropped, not thrown", () => {
  assert.equal(normalizeThumbnail(undefined), null);
  assert.equal(normalizeThumbnail(null), null);
  assert.equal(normalizeThumbnail("data:image/png,AAAA"), null);
  assert.equal(normalizeThumbnail({ src: "http://example.com/x.png", bytes: 4, updatedAt: 7 }), null);
  assert.equal(normalizeThumbnail({ src: "data:image/png,AAAA", bytes: "4", updatedAt: 7 }), null);
  assert.equal(normalizeThumbnail({ src: "data:image/png,AAAA", bytes: 4 }), null);
});

check("default preferences include icons-only off", () => {
  assert.equal(DEFAULT_PREFS.iconsOnly, false);
});

console.log(`\n${passed} checks passed`);
