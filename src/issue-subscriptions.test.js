import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeIssueSubscription,
  deleteIssueSubscription,
  listIssueSubscriptions,
  registerIssueSubscription,
  setIssueSubscriptionState,
  syncIssueSubscriptions,
} from "./issue-subscriptions.js";

test("registerIssueSubscription is idempotent by issue id and preserves kind mappings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-issue-subscriptions-"));
  try {
    const storePath = join(dir, "subscriptions.json");
    const first = await registerIssueSubscription({
      storePath,
      subscription: {
        kind: "assist_goal",
        issueId: "issue-assist-goal",
        issueIdentifier: "SPA-10",
        title: "Goal 澄清 Assist Issue",
        goalId: "goal-1",
        source: "goal_clarification",
      },
      now: "2026-06-08T00:00:00.000Z",
    });
    const second = await registerIssueSubscription({
      storePath,
      subscription: {
        kind: "assist_goal",
        issueId: "issue-assist-goal",
        issueIdentifier: "SPA-10",
        title: "Goal 澄清 Assist Issue updated",
        goalId: "goal-1",
        source: "goal_clarification",
        lastKnownStatus: "todo",
      },
      now: "2026-06-08T00:01:00.000Z",
    });

    assert.equal(first.subscription.id, second.subscription.id);
    const list = await listIssueSubscriptions({ storePath });
    assert.equal(list.subscriptions.length, 1);
    assert.equal(list.subscriptions[0].kind, "assist_goal");
    assert.equal(list.subscriptions[0].title, "Goal 澄清 Assist Issue updated");
    assert.equal(list.subscriptions[0].lastKnownStatus, "todo");

    const raw = await readFile(storePath, "utf8");
    assert.equal(JSON.parse(raw).subscriptions.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syncIssueSubscriptions batches active subscriptions through read-only Multica commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-issue-subscriptions-sync-"));
  try {
    const storePath = join(dir, "subscriptions.json");
    for (let index = 1; index <= 31; index += 1) {
      await registerIssueSubscription({
        storePath,
        subscription: {
          kind: index === 1 ? "assist_plan_split" : "business_issue",
          issueId: `issue-${index}`,
          issueIdentifier: `SPA-${index}`,
          title: `Issue ${index}`,
          source: index === 1 ? "plan_split" : "business_issue_apply",
          goalId: "goal-1",
        },
        now: "2026-06-08T00:00:00.000Z",
      });
    }
    const calls = [];
    const result = await syncIssueSubscriptions({
      storePath,
      now: "2026-06-08T00:02:00.000Z",
      limit: 30,
      preferredIssueIds: ["issue-31"],
      exec: async (args) => {
        calls.push(args);
        assertReadOnlyIssueCommand(args);
        if (args.join(" ") === "issue list --output json") {
          return {
            code: 0,
            stderr: "",
            stdout: JSON.stringify(
              Array.from({ length: 31 }, (_, index) => ({
                id: `issue-${index + 1}`,
                identifier: `SPA-${index + 1}`,
                status: index === 30 ? "in_progress" : "todo",
              })),
            ),
          };
        }
        if (args[0] === "issue" && args[1] === "runs") {
          return { code: 0, stderr: "", stdout: JSON.stringify([{ id: `run-${args[2]}`, status: "completed" }]) };
        }
        if (args[0] === "issue" && args[1] === "comment" && args[2] === "list") {
          return {
            code: 0,
            stderr: "",
            stdout: JSON.stringify([{ id: `comment-${args[3]}`, content: `完成摘要 sk-secret-${args[3]} token=abc123` }]),
          };
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });

    assert.equal(result.synced.length, 30);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.synced.some((item) => item.issueId === "issue-31"));
    assert.equal(calls[0].join(" "), "issue list --output json");
    assert.ok(calls.every((args) => args[0] === "issue"));

    const list = await listIssueSubscriptions({ storePath });
    const preferred = list.subscriptions.find((item) => item.issueId === "issue-31");
    assert.equal(preferred.lastKnownStatus, "in_progress");
    assert.equal(preferred.lastRunStatus, "completed");
    assert.match(preferred.lastCommentExcerpt, /完成摘要/);
    assert.equal(preferred.lastCommentExcerpt.includes("sk-secret"), false);
    assert.equal(preferred.lastCommentExcerpt.includes("abc123"), false);
    assert.equal(result.warning, "subscription_sync_limited");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pause resume and delete update local subscription state only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-issue-subscriptions-state-"));
  try {
    const storePath = join(dir, "subscriptions.json");
    const registered = await registerIssueSubscription({
      storePath,
      subscription: {
        kind: "business_issue",
        issueId: "issue-business-1",
        issueIdentifier: "SPA-80",
        title: "业务 Issue",
        source: "business_issue_apply",
      },
    });

    const paused = await setIssueSubscriptionState({ storePath, id: registered.subscription.id, state: "paused" });
    assert.equal(paused.subscription.state, "paused");
    const resumed = await setIssueSubscriptionState({ storePath, id: registered.subscription.id, state: "active" });
    assert.equal(resumed.subscription.state, "active");
    const deleted = await deleteIssueSubscription({ storePath, id: registered.subscription.id });
    assert.equal(deleted.ok, true);
    assert.equal((await listIssueSubscriptions({ storePath })).subscriptions.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("closeIssueSubscription previews and token-gates real Multica status cancellation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-issue-subscriptions-close-"));
  try {
    const storePath = join(dir, "subscriptions.json");
    const registered = await registerIssueSubscription({
      storePath,
      subscription: {
        kind: "assist_plan_split",
        issueId: "issue-plan-1",
        issueIdentifier: "SPA-91",
        title: "Plan 拆分 Assist Issue",
        source: "plan_split",
      },
      now: "2026-06-08T00:00:00.000Z",
    });
    const calls = [];
    const exec = async (args) => {
      calls.push(args);
      return { code: 0, stdout: JSON.stringify({ id: args[2], status: "cancelled" }), stderr: "" };
    };

    const preview = await closeIssueSubscription({
      storePath,
      id: registered.subscription.id,
      exec,
      execute: false,
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.mode, "dry-run");
    assert.equal(preview.operation.displayCommand, "multica issue status issue-plan-1 cancelled --output json");
    assert.equal(calls.length, 0);

    const blocked = await closeIssueSubscription({
      storePath,
      id: registered.subscription.id,
      exec,
      execute: true,
      confirm: "WRONG",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.reason, "close_subscription_confirmation_required");
    assert.equal(calls.length, 0);

    const closed = await closeIssueSubscription({
      storePath,
      id: registered.subscription.id,
      exec,
      execute: true,
      confirm: "CLOSE-MULTICA-SUBSCRIBED-ISSUE",
      now: "2026-06-08T00:02:00.000Z",
    });
    assert.equal(closed.ok, true);
    assert.equal(closed.mode, "execute");
    assert.deepEqual(calls, [["issue", "status", "issue-plan-1", "cancelled", "--output", "json"]]);
    assert.equal(closed.subscription.state, "completed");
    assert.equal(closed.subscription.lastKnownStatus, "cancelled");

    const list = await listIssueSubscriptions({ storePath });
    assert.equal(list.subscriptions[0].state, "completed");
    assert.equal(list.subscriptions[0].lastKnownStatus, "cancelled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function assertReadOnlyIssueCommand(args) {
  const text = args.join(" ");
  assert.ok([
    /^issue list --output json$/,
    /^issue runs issue-\d+ --output json$/,
    /^issue comment list issue-\d+ --output json$/,
  ].some((pattern) => pattern.test(text)), `unexpected write-like command: ${text}`);
}
