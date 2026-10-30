/**
 * Run-state aggregation tests.
 *
 * These cover the official precedence (pending interaction > live activity >
 * unread completion), the session-list `running` fallback for sessions the
 * status Map has not caught up with, and the idle case.
 */

import { strict as assert } from "node:assert";
import { workspaceRunState } from "./status";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("workspace run state");

check("pending interaction outranks everything and short-circuits", () => {
  const status = new Map([
    ["s1", { running: true }],
    ["s2", { pendingInteraction: { kind: "approval" } }],
  ]);
  assert.equal(workspaceRunState(["s1", "s2"], status, undefined), "attention");
});

check("all three pending kinds count as attention", () => {
  for (const kind of ["approval", "plan-review", "question"]) {
    const status = new Map([["s1", { pendingInteraction: { kind } }]]);
    assert.equal(workspaceRunState(["s1"], status, undefined), "attention");
  }
});

check("running outranks an unread completion", () => {
  const status = new Map([
    ["s1", { completionUnread: true }],
    ["s2", { running: true }],
  ]);
  assert.equal(workspaceRunState(["s1", "s2"], status, undefined), "running");
});

check("a running subagent counts as running", () => {
  const status = new Map([["s1", { runningSubagentCount: 2 }]]);
  assert.equal(workspaceRunState(["s1"], status, undefined), "running");
});

check("an unread completion alone is done", () => {
  const status = new Map([["s1", { completionUnread: true }]]);
  assert.equal(workspaceRunState(["s1"], status, undefined), "done");
});

check("the session list's running flag covers sessions the Map missed", () => {
  assert.equal(workspaceRunState(["s1"], undefined, { s1: { running: true } }), "running");
  const status = new Map([["s1", { running: true }]]);
  assert.equal(
    workspaceRunState(["s1", "s2"], status, { s2: { running: true } }),
    "running",
  );
});

check("idle workspaces have no state", () => {
  const status = new Map([["s1", {}]]);
  assert.equal(workspaceRunState(["s1"], status, undefined), undefined);
  assert.equal(workspaceRunState([], undefined, undefined), undefined);
  assert.equal(workspaceRunState(["s1"], undefined, { s1: undefined }), undefined);
});

console.log(`\n${passed} checks passed`);
