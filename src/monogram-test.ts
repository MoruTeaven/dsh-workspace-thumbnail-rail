/**
 * Monogram tests.
 *
 * These cover the two rules the default tile depends on: WHICH glyphs are
 * drawn (two latin/digit characters, or one wide character), and the color
 * staying stable per workspace while spreading across the palette.
 */

import { strict as assert } from "node:assert";
import { hashSeed, monogramChars, monogramColor } from "./monogram";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("workspace monogram");

check("two latin or digit characters, upper-cased", () => {
  assert.equal(monogramChars("dsh-workspace"), "DS");
  assert.equal(monogramChars("77lab"), "77");
  assert.equal(monogramChars("a1"), "A1");
  assert.equal(monogramChars("_cache"), "_C");
});

check("one wide (CJK) character", () => {
  assert.equal(monogramChars("工作区"), "工");
  assert.equal(monogramChars("茶柒快递"), "茶");
  assert.equal(monogramChars("ＡＢＣ"), "Ａ"); // fullwidth form counts as wide
});

check("mixed scripts keep the first glyph only", () => {
  assert.equal(monogramChars("A中文"), "A");
  assert.equal(monogramChars("中A"), "中");
  assert.equal(monogramChars("v2版"), "V2");
});

check("single character, trimmed spaces and blank titles", () => {
  assert.equal(monogramChars("x"), "X");
  assert.equal(monogramChars(" 德 "), "德");
  assert.equal(monogramChars("  "), "?");
  assert.equal(monogramChars(""), "?");
});

check("color is stable per seed", () => {
  assert.equal(monogramColor("ws-1"), monogramColor("ws-1"));
  assert.equal(monogramColor("F:\\Code\\dsh"), monogramColor("F:\\Code\\dsh"));
});

check("colors spread across the palette, not one bucket", () => {
  const seeds = Array.from({ length: 40 }, (_, index) => `workspace-${index}`);
  const colors = new Set(seeds.map(monogramColor));
  assert.ok(colors.size >= 8, `expected variety, got ${colors.size}`);
});

check("hashSeed returns unsigned 32-bit integers", () => {
  for (const seed of ["", "x", "F:\\Code\\dsh", "🚀 rocket", "工作区"]) {
    const hash = hashSeed(seed);
    assert.ok(Number.isInteger(hash) && hash >= 0 && hash <= 0xffffffff);
  }
});

console.log(`\n${passed} checks passed`);
