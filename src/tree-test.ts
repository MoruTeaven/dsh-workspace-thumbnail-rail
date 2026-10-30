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
  hiddenFlatSessionIds,
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
