/**
 * Session resolution tests.
 *
 * The current conversation is not a field on the list snapshot: it is the one
 * the main view retains. Getting this wrong silently disables the single-list
 * scope (every conversation shows) and the active-workspace highlight, so the
 * derivation is pinned down here.
 */

import { strict as assert } from "node:assert";
import { currentSessionId, workspaceOfSession } from "./session";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("session resolution");

check("the main-view retention names the current conversation", () => {
  const id = currentSessionId({
    "a": { id: "a", retainedBy: { mainView: 1 } },
    "b": { id: "b", retainedBy: {} },
  });
  assert.equal(id, "a");
});

check("a panel-retained conversation is not the current one", () => {
  const id = currentSessionId({
    "a": { id: "a", retainedBy: { mainView: 0, panel: 3 } },
    "b": { id: "b", retainedBy: { mainView: 1 } },
  });
  assert.equal(id, "b");
});

check("a blank conversation is still the current one", () => {
  const id = currentSessionId({ "a": { id: "a", blank: true, retainedBy: { mainView: 1 } } });
  assert.equal(id, "a");
});

check("the highest main-view count wins", () => {
  const id = currentSessionId({
    "a": { id: "a", retainedBy: { mainView: 1 } },
    "b": { id: "b", retainedBy: { mainView: 2 } },
  });
  assert.equal(id, "b");
});

check("nothing retained means no current conversation", () => {
  assert.equal(currentSessionId({}), undefined);
  assert.equal(currentSessionId({ "a": { id: "a" }, "b": undefined }), undefined);
  assert.equal(currentSessionId({ "a": { id: "a", retainedBy: { mainView: 0 } } }), undefined);
});

const workspaces = [
  { workspaceId: "ws-a", sessionIds: ["s-a1", "s-a2"] },
  { workspaceId: "ws-b", sessionIds: ["s-b1"] },
];

check("a conversation resolves to its workspace", () => {
  assert.equal(workspaceOfSession(workspaces, "s-a2"), "ws-a");
  assert.equal(workspaceOfSession(workspaces, "s-b1"), "ws-b");
});

check("an unlisted or absent conversation resolves to nothing", () => {
  assert.equal(workspaceOfSession(workspaces, "s-subagent"), undefined);
  assert.equal(workspaceOfSession(workspaces, undefined), undefined);
});

console.log(`\n${passed} checks passed`);
