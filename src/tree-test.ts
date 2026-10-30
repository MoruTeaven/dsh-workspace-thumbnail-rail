/**
 * Workspace hierarchy tests.
 *
 * These cover the two rules the rail depends on but cannot see at runtime:
 * a Workspace nests under its NEAREST registered ancestor, and the "single
 * list" scope only hides rows whose owner is KNOWN to be another Workspace.
 */

import { strict as assert } from "node:assert";
import {
  ancestorsOf,
  buildWorkspaceTree,
  computeIndentStep,
  hiddenFlatSessionIds,
  maxTreeDepth,
  normalizePath,
  owningParentPath,
  sessionOwners,
} from "./tree";

interface Item {
  workspaceId: string;
  path: string;
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("workspace tree");

check("normalizePath folds Windows separators and trailing slashes", () => {
  assert.equal(normalizePath("F:\\Code\\dsh\\"), "F:/Code/dsh");
  assert.equal(normalizePath("F:/Code/dsh///"), "F:/Code/dsh");
  assert.equal(normalizePath("C:\\"), "C:");
  assert.equal(normalizePath(""), "");
});

check("normalizePath keeps POSIX backslashes as name characters", () => {
  assert.equal(normalizePath("/home/me/a\\b"), "/home/me/a\\b");
  assert.equal(normalizePath("/home/me/a/"), "/home/me/a");
});

check("owningParentPath picks the nearest registered ancestor", () => {
  const registered = ["F:\\a", "F:\\a\\b", "F:\\a\\b\\c", "G:\\other"];
  assert.equal(owningParentPath("F:\\a\\b\\c\\d", registered), "F:\\a\\b\\c");
  assert.equal(owningParentPath("F:\\a\\b", registered), "F:\\a");
});

check("owningParentPath ignores the directory itself and sibling prefixes", () => {
  const registered = ["F:\\a\\b", "F:\\ab"];
  assert.equal(owningParentPath("F:\\a\\b", registered), undefined);
  // `F:\a\bc` shares a string prefix with `F:\a\b` but is not inside it.
  assert.equal(owningParentPath("F:\\a\\bc", registered), undefined);
  assert.equal(owningParentPath("F:\\ab\\x", registered), "F:\\ab");
});

check("owningParentPath is case-sensitive, like Workspace identity", () => {
  assert.equal(owningParentPath("f:\\a\\b", ["F:\\a"]), undefined);
});

check("buildWorkspaceTree keeps input order at every level", () => {
  const items: Item[] = [
    { workspaceId: "root", path: "F:\\code" },
    { workspaceId: "z-child", path: "F:\\code\\z" },
    { workspaceId: "a-child", path: "F:\\code\\a" },
    { workspaceId: "loose", path: "G:\\loose" },
  ];
  const tree = buildWorkspaceTree(items);
  assert.deepEqual(tree.roots.map((item) => item.workspaceId), ["root", "loose"]);
  assert.deepEqual(tree.children.get("root")?.map((item) => item.workspaceId), ["z-child", "a-child"]);
  assert.equal(tree.parentOf.get("z-child"), "root");
  assert.equal(tree.parentOf.get("loose"), undefined);
});

check("buildWorkspaceTree nests a grandchild under its direct parent only", () => {
  const items: Item[] = [
    { workspaceId: "a", path: "F:\\a" },
    { workspaceId: "b", path: "F:\\a\\b" },
    { workspaceId: "c", path: "F:\\a\\b\\c" },
  ];
  const tree = buildWorkspaceTree(items);
  assert.deepEqual(tree.children.get("a")?.map((item) => item.workspaceId), ["b"]);
  assert.deepEqual(tree.children.get("b")?.map((item) => item.workspaceId), ["c"]);
});

check("buildWorkspaceTree leaves a duplicate-path twin as a root", () => {
  const items: Item[] = [
    { workspaceId: "first", path: "F:\\a" },
    { workspaceId: "twin", path: "F:\\a\\" },
  ];
  const tree = buildWorkspaceTree(items);
  assert.deepEqual(tree.roots.map((item) => item.workspaceId), ["first", "twin"]);
  assert.equal(tree.parentOf.size, 0);
});

check("maxTreeDepth counts levels with roots as level 1", () => {
  assert.equal(maxTreeDepth(buildWorkspaceTree([] as Item[])), 0);
  assert.equal(maxTreeDepth(buildWorkspaceTree([{ workspaceId: "a", path: "F:\\a" }])), 1);
  const items: Item[] = [
    { workspaceId: "a", path: "F:\\a" },
    { workspaceId: "b", path: "F:\\a\\b" },
    { workspaceId: "c", path: "F:\\a\\b\\c" },
    { workspaceId: "d", path: "F:\\a\\d" },
  ];
  assert.equal(maxTreeDepth(buildWorkspaceTree(items)), 3);
});

check("computeIndentStep clamps into the readable range", () => {
  // A wide rail with one level takes the full step.
  assert.equal(computeIndentStep(160, 1), 15);
  // No nesting needs no step at all; the range maximum is a safe default.
  assert.equal(computeIndentStep(48, 0), 15);
  // A narrow rail with deep nesting bottoms out at the minimum, never below.
  assert.equal(computeIndentStep(48, 8), 4);
  assert.ok(computeIndentStep(48, 3) >= 4);
});

check("computeIndentStep keeps the deepest tile inside the rail", () => {
  // The invariant the column's overflow:hidden depends on: gutter + the
  // deepest level's indent + its tile must not exceed the rail width. It is
  // guaranteed for every rail width down to the deepest tree the plugin
  // renders for, and at the minimum width for the depths users actually hit;
  // below the 4px clamp the step stays at the clamp (a 48px rail with 6+
  // levels simply clips, and the user can drag it wider).
  const fits = (width: number, levels: number): boolean => {
    const step = computeIndentStep(width, levels);
    const gutter = Math.max(0, (width - 47) / 2);
    const deepestTile = Math.max(24, 47 - 6 * levels);
    return gutter + step * levels + deepestTile <= width;
  };
  for (const width of [72, 96, 120, 160]) {
    for (let levels = 1; levels <= 8; levels += 1) {
      assert.ok(fits(width, levels), `width ${width} levels ${levels} overflows`);
    }
  }
  for (let levels = 1; levels <= 5; levels += 1) {
    assert.ok(fits(48, levels), `narrow rail levels ${levels} overflows`);
  }
  // Deeper trees step in, never out: the step is monotone in the levels.
  for (const width of [48, 72, 160]) {
    let previous = computeIndentStep(width, 0);
    for (let levels = 1; levels <= 8; levels += 1) {
      const step = computeIndentStep(width, levels);
      assert.ok(step <= previous, `width ${width}: step grew at level ${levels}`);
      previous = step;
    }
  }
});

check("ancestorsOf lists outermost first and stops at the root", () => {
  const items: Item[] = [
    { workspaceId: "a", path: "F:\\a" },
    { workspaceId: "b", path: "F:\\a\\b" },
    { workspaceId: "c", path: "F:\\a\\b\\c" },
  ];
  const { parentOf } = buildWorkspaceTree(items);
  assert.deepEqual(ancestorsOf("c", parentOf), ["a", "b"]);
  assert.deepEqual(ancestorsOf("a", parentOf), []);
  assert.deepEqual(ancestorsOf("missing", parentOf), []);
});

check("ancestorsOf survives a cyclic parent map", () => {
  const parentOf = new Map([["a", "b"], ["b", "a"]]);
  const chain = ancestorsOf("a", parentOf);
  assert.equal(chain.length, 1);
  assert.equal(chain[0], "b");
});

check("sessionOwners assigns the first owning Workspace", () => {
  const owners = sessionOwners([
    { workspaceId: "w1", sessionIds: ["s1", "s2"] },
    { workspaceId: "w2", sessionIds: ["s2", "s3"] },
  ]);
  assert.equal(owners.get("s1"), "w1");
  assert.equal(owners.get("s2"), "w1");
  assert.equal(owners.get("s3"), "w2");
});

check("hiddenFlatSessionIds scopes to the active Workspace", () => {
  const owners = sessionOwners([
    { workspaceId: "w1", sessionIds: ["s1"] },
    { workspaceId: "w2", sessionIds: ["s2"] },
  ]);
  assert.deepEqual([...hiddenFlatSessionIds(owners, "w1", ["s1", "s2"])], ["s2"]);
});

check("hiddenFlatSessionIds hides nothing without an active Workspace", () => {
  const owners = sessionOwners([{ workspaceId: "w1", sessionIds: ["s1"] }]);
  assert.equal(hiddenFlatSessionIds(owners, undefined, ["s1", "s2"]).size, 0);
});

check("hiddenFlatSessionIds keeps a row whose owner is still unknown", () => {
  const owners = sessionOwners([{ workspaceId: "w1", sessionIds: ["s1"] }]);
  assert.equal(hiddenFlatSessionIds(owners, "w1", ["s1", "s-new"]).size, 0);
});

console.log(`\n${passed} checks passed`);
