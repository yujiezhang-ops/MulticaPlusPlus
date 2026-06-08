import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createGuiServer } from "./gui-server.js";

test("gui server creates the image2 agent through a POST button endpoint and writes audit log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-server-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      exec: async (args) => {
        calls.push(args);
        if (args[0] === "daemon") {
          return textResult("Daemon:      running\nVersion:     0.3.15\n");
        }
        if (args[0] === "workspace") {
          return jsonResult([{ id: "ws-1", name: "SparkProject", slug: "sparkproject" }]);
        }
        if (args[0] === "project") {
          return jsonResult([{ id: "project-1", title: "MulticaPlusPlus", workspace_id: "ws-1" }]);
        }
        if (args[0] === "runtime") {
          return jsonResult([{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }]);
        }
        if (args[0] === "agent" && args[1] === "list") {
          return jsonResult([{ id: "agent-source", name: "Codex Full Access Worker", model: "pa/gpt-5.5", runtime_id: "rt-codex", custom_args: ["-c", "approval_policy=never"] }]);
        }
        if (args[0] === "skill" && args[1] === "list") {
          return jsonResult([]);
        }
        if (args[0] === "skill" && args[1] === "create") {
          return jsonResult({ id: "skill-created", name: "paigod-imagegen" });
        }
        if (args[0] === "agent" && args[1] === "create") {
          return jsonResult({ id: "agent-created", name: "Multica++ Image2 Codex Agent" });
        }
        if (args[0] === "agent" && args[1] === "skills") {
          return jsonResult([{ id: "skill-created", name: "paigod-imagegen" }]);
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/agent-config/image2/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "CREATE-MULTICA-IMAGE2-CODEX-AGENT" }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.result.targetAgentId, "agent-created");
      assert.equal(payload.result.skillIds.paigodImagegen, "skill-created");
      assert.deepEqual(calls.slice(-3).map((args) => args.slice(0, 3)), [
        ["skill", "create", "--name"],
        ["agent", "create", "--name"],
        ["agent", "skills", "add"],
      ]);

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.length, 1);
      assert.equal(auditEvents[0].event_type, "image2_agent_create");
      assert.equal(auditEvents[0].status, "success");
      assert.equal(auditEvents[0].target_agent_id, "agent-created");
      assert.equal(JSON.stringify(auditEvents).includes("sk-"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server normalizes goal, locks it, generates plan, and previews issue split without Multica writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-goal-plan-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      exec: async (args) => {
        calls.push(args);
        throw new Error("goal plan preview should not call multica");
      },
    });

    try {
      const normalizeResponse = await fetch(`http://127.0.0.1:${server.port}/api/goal/normalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request: "实现 Goal Plan 模块，复杂任务可以拆成一个或多个 Multica issue",
          context: { owner: "Codex", source: "gui-test" },
        }),
      });
      assert.equal(normalizeResponse.status, 200);
      const normalizePayload = await normalizeResponse.json();
      assert.equal(normalizePayload.ok, true);
      assert.equal(normalizePayload.goal.status, "clarified");

      const lockResponse = await fetch(`http://127.0.0.1:${server.port}/api/goal/lock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: normalizePayload.goal, approvedBy: "human" }),
      });
      assert.equal(lockResponse.status, 200);
      const lockPayload = await lockResponse.json();
      assert.equal(lockPayload.goal.status, "locked");

      const planResponse = await fetch(`http://127.0.0.1:${server.port}/api/plan/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: lockPayload.goal, complexity: "complex" }),
      });
      assert.equal(planResponse.status, 200);
      const planPayload = await planResponse.json();
      assert.equal(planPayload.plan.issueSplitRecommendation, "multiple");

      const previewResponse = await fetch(`http://127.0.0.1:${server.port}/api/plan/preview-issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: lockPayload.goal, plan: planPayload.plan }),
      });
      assert.equal(previewResponse.status, 200);
      const previewPayload = await previewResponse.json();
      assert.equal(previewPayload.issueSplit.mode, "multiple");
      assert.equal(previewPayload.issueSplit.confirmationRequired, true);

      assert.deepEqual(calls, []);
      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.deepEqual(
        auditEvents.map((event) => event.event_type),
        ["goal_normalized", "goal_locked", "plan_generated", "issue_split_previewed"],
      );
      assert.ok(JSON.stringify(auditEvents).includes(normalizePayload.goal.id));
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server previews business issues from an Agent planSet without Multica writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-plan-set-preview-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      exec: async (args) => {
        calls.push(args);
        throw new Error("planSet issue preview should not call multica");
      },
    });

    try {
      const goal = sampleLockedGoal();
      const planSet = samplePlanSet(goal);
      const response = await fetch(`http://127.0.0.1:${server.port}/api/plan/preview-issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, planSet, language: "zh-CN" }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.issueSplit.mode, "plan_set");
      assert.equal(payload.issueSplit.issues.length, 2);
      assert.equal(payload.issueSplit.issues[0].metadata.plan_set_id, planSet.id);
      assert.equal(payload.issueSplit.issues[0].metadata.subplan_id, planSet.plans[0].id);
      assert.equal(calls.length, 0);

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "issue_split_previewed");
      assert.equal(auditEvents.at(-1).status, "plan_set");
      assert.equal(auditEvents.at(-1).plan_set_id, planSet.id);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server applies business issue split only with explicit confirmation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-issue-apply-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      exec: async (args) => {
        calls.push(args);
        if (args[0] === "issue" && args[1] === "create") {
          return jsonResult({ id: `created-${calls.length}`, identifier: `SPA-${100 + calls.length}`, title: args[args.indexOf("--title") + 1] });
        }
        if (args[0] === "issue" && args[1] === "metadata" && args[2] === "set") {
          return jsonResult({ ok: true });
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });

    try {
      const issueSplit = sampleIssueSplit();
      const dryRun = await fetch(`http://127.0.0.1:${server.port}/api/plan/apply-issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issueSplit, execute: false }),
      });
      assert.equal(dryRun.status, 200);
      const dryRunPayload = await dryRun.json();
      assert.equal(dryRunPayload.ok, true);
      assert.equal(dryRunPayload.result.mode, "dry-run");
      assert.equal(calls.length, 0);

      const rejected = await fetch(`http://127.0.0.1:${server.port}/api/plan/apply-issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issueSplit, execute: true, confirm: "wrong" }),
      });
      assert.equal(rejected.status, 403);
      const rejectedPayload = await rejected.json();
      assert.equal(rejectedPayload.ok, false);
      assert.match(rejectedPayload.error, /confirmation token required/);
      assert.equal(calls.length, 0);

      const applied = await fetch(`http://127.0.0.1:${server.port}/api/plan/apply-issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issueSplit, execute: true, confirm: "APPLY-MULTICA-ISSUE-SPLIT" }),
      });
      assert.equal(applied.status, 200);
      const appliedPayload = await applied.json();
      assert.equal(appliedPayload.ok, true);
      assert.equal(appliedPayload.result.mode, "execute");
      assert.equal(appliedPayload.result.createdIssues.length, 2);
      assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "create"));
      assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "metadata" && args[2] === "set"));

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "issue_split_apply");
      assert.equal(auditEvents.at(-1).status, "success");
      assert.equal(auditEvents.at(-1).issue_count, 2);
      assert.equal(JSON.stringify(auditEvents).includes(issueSplit.issues[0].description), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server applies a single business issue candidate and registers its subscription", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-single-issue-apply-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const subscriptionStorePath = join(dir, "issue-subscriptions.json");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      subscriptionStorePath,
      exec: async (args) => {
        calls.push(args);
        if (args[0] === "issue" && args[1] === "create") {
          return jsonResult({ id: "created-2", identifier: "SPA-202", title: args[args.indexOf("--title") + 1], status: "todo" });
        }
        if (args[0] === "issue" && args[1] === "metadata" && args[2] === "set") {
          return jsonResult({ ok: true });
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });

    try {
      const issueSplit = sampleIssueSplit();
      const response = await fetch(`http://127.0.0.1:${server.port}/api/plan/apply-issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          issueSplit,
          issuePreviewId: "issue-preview-2",
          execute: true,
          confirm: "APPLY-MULTICA-ISSUE-SPLIT",
        }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.deepEqual(payload.result.createdIssues.map((issue) => issue.issuePreviewId), ["issue-preview-2"]);
      assert.equal(calls.filter((args) => args[0] === "issue" && args[1] === "create").length, 1);

      const listResponse = await fetch(`http://127.0.0.1:${server.port}/api/issue-subscriptions`);
      const listPayload = await listResponse.json();
      assert.equal(listPayload.ok, true);
      assert.equal(listPayload.subscriptions.length, 1);
      assert.equal(listPayload.subscriptions[0].kind, "business_issue");
      assert.equal(listPayload.subscriptions[0].issueId, "created-2");
      assert.equal(listPayload.subscriptions[0].issueSplitId, issueSplit.id);
      assert.equal(listPayload.subscriptions[0].subplanId, "subplan-2");
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server subscription sync uses read-only issue commands and exposes grouped state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-subscriptions-sync-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const subscriptionStorePath = join(dir, "issue-subscriptions.json");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      subscriptionStorePath,
      exec: async (args) => {
        calls.push(args);
        if (args[0] === "issue" && args[1] === "create") {
          return jsonResult({ id: "business-1", identifier: "SPA-301", title: args[args.indexOf("--title") + 1], status: "todo" });
        }
        if (args[0] === "issue" && args[1] === "metadata" && args[2] === "set") {
          return jsonResult({ ok: true });
        }
        if (args.join(" ") === "issue list --output json") {
          return jsonResult([{ id: "business-1", identifier: "SPA-301", title: "业务 Issue", status: "in_progress" }]);
        }
        if (args.join(" ") === "issue runs business-1 --output json") {
          return jsonResult([{ id: "run-business-1", status: "running" }]);
        }
        if (args.join(" ") === "issue comment list business-1 --output json") {
          return jsonResult([{ id: "comment-1", content: "正在处理业务 Issue，token=secret-value" }]);
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });

    try {
      const issueSplit = {
        ...sampleIssueSplit(),
        issues: [sampleIssueSplit().issues[0]],
      };
      const apply = await fetch(`http://127.0.0.1:${server.port}/api/plan/apply-issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issueSplit, execute: true, confirm: "APPLY-MULTICA-ISSUE-SPLIT" }),
      });
      assert.equal(apply.status, 200);

      const sync = await fetch(`http://127.0.0.1:${server.port}/api/issue-subscriptions/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredIssueIds: ["business-1"] }),
      });
      assert.equal(sync.status, 200);
      const syncPayload = await sync.json();
      assert.equal(syncPayload.ok, true);
      assert.equal(syncPayload.synced[0].lastKnownStatus, "in_progress");
      assert.equal(syncPayload.synced[0].lastRunStatus, "running");
      assert.equal(syncPayload.synced[0].lastCommentExcerpt.includes("secret-value"), false);
      assert.deepEqual(
        calls.filter((args) => args[0] === "issue").map((args) => args.slice(0, 3)).filter((parts) => parts[1] !== "create" && parts[1] !== "metadata"),
        [
          ["issue", "list", "--output"],
          ["issue", "runs", "business-1"],
          ["issue", "comment", "list"],
        ],
      );

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "issue_subscriptions_synced");
      assert.equal(JSON.stringify(auditEvents).includes("secret-value"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server normalizes a goal through LLM with a mock provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-goal-llm-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const llmCalls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      llmProviderConfig: {
        provider: "codex",
        command: "mock-codex",
        model: "mock-model",
      },
      llmCommandExists: async () => true,
      llmPathExists: async () => true,
      llmExec: async (args) => {
        llmCalls.push(args);
        const outputFile = args[args.indexOf("--output-last-message") + 1];
        await writeFile(outputFile, JSON.stringify(sampleLlmGoalDraft()), "utf8");
        return { stdout: JSON.stringify({ type: "turn_completed" }) + "\n", stderr: "", code: 0 };
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/goal/normalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "llm",
          request: "实现真实 LLM Goal 澄清",
          context: { owner: "Codex", source: "gui-test" },
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.goal.status, "clarified");
      assert.equal(payload.goal.title, sampleLlmGoalDraft().title);
      assert.equal(payload.goal.llm.model, "mock-model");
      assert.equal(llmCalls.length, 1);

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "goal_normalized");
      assert.equal(auditEvents.at(-1).mode, "llm");
      assert.equal(auditEvents.at(-1).provider_kind, "codex");
      assert.equal(JSON.stringify(auditEvents).includes("sk-"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server returns blocked when LLM goal clarification has no provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-goal-llm-blocked-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      llmHomeDir: join(dir, "empty-home"),
      llmCommandExists: async () => false,
      llmPathExists: async () => false,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/goal/normalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "llm", request: "澄清目标" }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.blocked, true);
      assert.equal(payload.reason, "no_llm_provider");

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "goal_normalization_blocked");
      assert.equal(auditEvents.at(-1).blocked_reason, "no_llm_provider");
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server lists sanitized LLM providers without exposing secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-llm-providers-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      llmProviderConfig: {
        provider: "codex",
        command: "codex",
        model: "gpt-5-codex",
        apiKey: "sk-secret-never",
      },
      llmCommandExists: async () => true,
      llmPathExists: async () => true,
      llmEnv: { OPENAI_API_KEY: "sk-env-never" },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/llm/providers`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.status, "available");
      assert.equal(payload.selectedProvider.kind, "codex");
      const serialized = JSON.stringify(payload);
      assert.equal(serialized.includes("sk-secret-never"), false);
      assert.equal(serialized.includes("sk-env-never"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server lists sanitized Multica assist agents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-assist-agents-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      assistExec: mockAssistExec({ planDraft: sampleLlmPlanDraft(), goalDraft: sampleLlmGoalDraft() }),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/assist/agents`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.status, "available");
      assert.equal(payload.selectedAgent.id, "agent-lead");
      assert.equal(JSON.stringify(payload).includes("sk-"), false);

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "assist_agents_discovered");
      assert.equal(auditEvents.at(-1).selected_agent_id, "agent-lead");
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server normalizes a goal through Multica Agent assist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-goal-agent-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const prompts = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      assistExec: mockAssistExec({ calls, prompts, planDraft: sampleLlmPlanDraft(), goalDraft: sampleLlmGoalDraft() }),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/goal/normalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "agent",
          request: "实现真实 Agent Goal 澄清",
          language: "zh-CN",
          context: { owner: "Codex", source: "gui-test", language: "zh-CN" },
          assist: { selectionMode: "auto" },
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.goal.status, "clarified");
      assert.equal(payload.goal.llm.provider, "multica-agent");
      assert.equal(payload.goal.assist.issue.identifier, "SPA-99");
      assert.equal(payload.goal.language, "zh-CN");
      assert.match(prompts[0], /Output language: zh-CN/);
      assert.match(prompts[0], /用户可见字段必须使用简体中文/);
      assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "create"));

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "goal_normalized");
      assert.equal(auditEvents.at(-1).mode, "agent");
      assert.equal(auditEvents.at(-1).agent_id, "agent-lead");
      assert.equal(auditEvents.at(-1).issue_identifier, "SPA-99");
      assert.equal(auditEvents.at(-1).language, "zh-CN");
      assert.equal(JSON.stringify(auditEvents).includes("Provider discovery"), false);
      assert.equal(JSON.stringify(auditEvents).includes("sk-"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server starts async Multica Agent goal clarification and later reads comment JSON result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-goal-agent-async-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      assistExec: mockAssistExec({
        calls,
        planDraft: sampleLlmPlanDraft(),
        goalDraft: sampleLlmGoalDraft(),
        asyncRuns: true,
        goalCommentDraft: sampleLlmGoalDraft(),
      }),
    });

    try {
      const startResponse = await fetch(`http://127.0.0.1:${server.port}/api/goal/normalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request: "澄清一个复杂目标",
          mode: "agent",
          async: true,
          language: "zh-CN",
          assist: { selectionMode: "auto" },
        }),
      });

      assert.equal(startResponse.status, 200);
      const startPayload = await startResponse.json();
      assert.equal(startPayload.ok, true);
      assert.equal(startPayload.pending, true);
      assert.equal(startPayload.assist.issue.id, "issue-goal");
      assert.equal(calls.filter((args) => args[0] === "issue" && args[1] === "create").length, 1);

      const resultResponse = await fetch(`http://127.0.0.1:${server.port}/api/assist/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "goal",
          issueId: "issue-goal",
          agent: startPayload.assist.agent,
          request: "澄清一个复杂目标",
          context: { project: "MulticaPlusPlus" },
          language: "zh-CN",
        }),
      });

      assert.equal(resultResponse.status, 200);
      const resultPayload = await resultResponse.json();
      assert.equal(resultPayload.ok, true);
      assert.equal(resultPayload.status, "completed");
      assert.equal(resultPayload.goal.title, sampleLlmGoalDraft().title);
      assert.equal(resultPayload.diagnostic.outputSource, "comments");
      assert.equal(calls.filter((args) => args[0] === "issue" && args[1] === "create").length, 1);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server streams assist inbox subscription completion from comment JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-assist-subscribe-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      assistExec: mockAssistExec({
        calls,
        planDraft: sampleLlmPlanDraft(),
        goalDraft: sampleLlmGoalDraft(),
        asyncRuns: true,
        goalCommentDraft: sampleLlmGoalDraft(),
      }),
    });

    try {
      const startResponse = await fetch(`http://127.0.0.1:${server.port}/api/goal/normalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request: "澄清一个复杂目标",
          mode: "agent",
          async: true,
          language: "zh-CN",
          assist: {
            selectionMode: "auto",
            chainId: "assist_goal_test",
            requestId: "request_goal_test",
          },
        }),
      });
      const startPayload = await startResponse.json();
      assert.equal(startPayload.pending, true);
      assert.equal(startPayload.assistChainId, "assist_goal_test");
      assert.equal(startPayload.assistRequestId, "request_goal_test");

      const streamResponse = await fetch(`http://127.0.0.1:${server.port}/api/assist/subscribe?kind=goal&issueId=issue-goal&assistRequestId=request_goal_test&intervalMs=1000&timeoutMs=30000`);
      assert.equal(streamResponse.status, 200);
      const text = await streamResponse.text();
      assert.match(text, /event: ready/);
      assert.match(text, /event: completed/);
      assert.match(text, /"outputSource":"comments"/);
      assert.equal(calls.filter((args) => args[0] === "issue" && args[1] === "create").length, 1);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server splits a locked goal into LLM-assisted planSet with a mock provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-plan-split-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const multicaCalls = [];
    const llmCalls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      exec: async (args) => {
        multicaCalls.push(args);
        throw new Error("plan split should not call Multica");
      },
      llmProviderConfig: {
        provider: "codex",
        command: "mock-codex",
        model: "mock-model",
      },
      llmCommandExists: async () => true,
      llmPathExists: async () => true,
      llmExec: async (args) => {
        llmCalls.push(args);
        const outputFile = args[args.indexOf("--output-last-message") + 1];
        await writeFile(outputFile, JSON.stringify(sampleLlmPlanDraft()), "utf8");
        return { stdout: JSON.stringify({ type: "turn_completed" }) + "\n", stderr: "", code: 0 };
      },
    });

    try {
      const goal = {
        id: "goal-1",
        status: "locked",
        title: "LLM split",
        objective: "Split a locked goal into multiple plans.",
        successCriteria: ["Plan set returned"],
        constraints: ["preview-first"],
      };
      const response = await fetch(`http://127.0.0.1:${server.port}/api/plan/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, mode: "llm", availableAgents: [{ id: "planner-agent", role: "planner" }] }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.planSet.goalId, goal.id);
      assert.equal(payload.planSet.plans.length, 2);
      assert.equal(payload.planSet.provider.model, "mock-model");
      assert.equal(multicaCalls.length, 0);
      assert.equal(llmCalls.length, 1);
      assert.ok(Array.isArray(llmCalls[0]));

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "plan_set_generated");
      assert.equal(auditEvents.at(-1).provider_source, "user-config");
      assert.equal(auditEvents.at(-1).provider_kind, "codex");
      assert.equal(auditEvents.at(-1).model, "mock-model");
      assert.equal(auditEvents.at(-1).provider_version, "");
      assert.equal(auditEvents.at(-1).plan_count, 2);
      assert.equal(JSON.stringify(auditEvents).includes("Provider discovery"), false);
      assert.equal(JSON.stringify(auditEvents).includes("Detect local Agent CLI providers"), false);
      assert.equal(JSON.stringify(auditEvents).includes("sk-"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server splits a locked goal through Multica Agent assist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-plan-agent-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const prompts = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      assistExec: mockAssistExec({ calls, prompts, planDraft: sampleLlmPlanDraft(), goalDraft: sampleLlmGoalDraft() }),
    });

    try {
      const goal = {
        id: "goal-1",
        status: "locked",
        title: "Agent split",
        objective: "Split a locked goal into multiple plans.",
        successCriteria: ["Plan set returned"],
        constraints: ["preview-first"],
      };
      const response = await fetch(`http://127.0.0.1:${server.port}/api/plan/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, mode: "agent", language: "zh-CN", assist: { selectionMode: "auto" }, availableAgents: [{ id: "planner-agent", role: "planner" }] }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.planSet.goalId, goal.id);
      assert.equal(payload.planSet.provider.kind, "multica-agent");
      assert.equal(payload.planSet.plans.length, 2);
      assert.equal(payload.planSet.assist.issue.identifier, "SPA-100");
      assert.equal(payload.planSet.language, "zh-CN");
      assert.match(prompts[0], /Output language: zh-CN/);
      assert.match(prompts[0], /Plan steps/);
      assert.match(prompts[0], /用户可见字段必须使用简体中文/);
      assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "create"));

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "plan_set_generated");
      assert.equal(auditEvents.at(-1).mode, "agent");
      assert.equal(auditEvents.at(-1).agent_id, "agent-lead");
      assert.equal(auditEvents.at(-1).issue_identifier, "SPA-100");
      assert.equal(auditEvents.at(-1).plan_count, 2);
      assert.equal(auditEvents.at(-1).language, "zh-CN");
      assert.equal(JSON.stringify(auditEvents).includes("Detect local Agent CLI providers"), false);
      assert.equal(JSON.stringify(auditEvents).includes("sk-"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server starts async Multica Agent plan split and later reads comment JSON result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-plan-agent-async-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      assistExec: mockAssistExec({
        calls,
        planDraft: sampleLlmPlanDraft(),
        goalDraft: sampleLlmGoalDraft(),
        asyncRuns: true,
        planCommentDraft: sampleLlmPlanDraft(),
      }),
    });

    try {
      const goal = {
        id: "goal-1",
        status: "locked",
        title: "Agent async split",
        objective: "Split a locked goal into multiple plans.",
        successCriteria: ["Plan set returned"],
        constraints: ["preview-first"],
        language: "zh-CN",
      };
      const startResponse = await fetch(`http://127.0.0.1:${server.port}/api/plan/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal,
          mode: "agent",
          async: true,
          language: "zh-CN",
          assist: { selectionMode: "auto" },
          availableAgents: [{ id: "planner-agent", role: "planner" }],
        }),
      });

      assert.equal(startResponse.status, 200);
      const startPayload = await startResponse.json();
      assert.equal(startPayload.ok, true);
      assert.equal(startPayload.pending, true);
      assert.equal(startPayload.assist.issue.id, "issue-plan");
      assert.equal(calls.filter((args) => args[0] === "issue" && args[1] === "create").length, 1);

      const resultResponse = await fetch(`http://127.0.0.1:${server.port}/api/assist/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "planSet",
          issueId: "issue-plan",
          agent: startPayload.assist.agent,
          lockedGoal: goal,
          availableAgents: [{ id: "planner-agent", role: "planner" }],
          language: "zh-CN",
        }),
      });

      assert.equal(resultResponse.status, 200);
      const resultPayload = await resultResponse.json();
      assert.equal(resultPayload.ok, true);
      assert.equal(resultPayload.status, "completed");
      assert.equal(resultPayload.planSet.goalId, goal.id);
      assert.equal(resultPayload.planSet.plans.length, 2);
      assert.equal(resultPayload.diagnostic.outputSource, "comments");
      assert.equal(calls.filter((args) => args[0] === "issue" && args[1] === "create").length, 1);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server returns blocked when LLM split has no available provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-plan-split-blocked-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      llmHomeDir: join(dir, "empty-home"),
      llmCommandExists: async () => false,
      llmPathExists: async () => false,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/plan/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "llm",
          goal: { id: "goal-1", status: "locked", objective: "Split goal" },
        }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.blocked, true);
      assert.equal(payload.reason, "no_llm_provider");
      assert.deepEqual(payload.candidates, []);
      const auditEvents = (await readFile(join(dir, "audit.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "plan_set_generation_blocked");
      assert.equal(auditEvents.at(-1).blocked_reason, "no_llm_provider");
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server diagnoses LLM provider readiness without exposing secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-llm-diagnose-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      llmProviderConfig: {
        provider: "codex",
        command: process.execPath,
      },
      llmCommandExists: async () => true,
      llmPathExists: async () => true,
      llmExec: async () => ({ code: 1, stdout: "", stderr: "Auth required token=sk-never-print" }),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/llm/diagnose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ probe: false }),
      });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.ok, false);
      assert.equal(payload.reason, "llm_auth_required");
      const serialized = JSON.stringify(payload);
      assert.equal(serialized.includes("sk-never-print"), false);
      assert.equal(serialized.includes("[redacted]"), true);

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "llm_provider_diagnosed");
      assert.equal(auditEvents.at(-1).blocked_reason, "llm_auth_required");
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server returns redacted LLM secret metadata only with confirmation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-secret-metadata-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const home = join(dir, "home");
    const codexDir = join(home, ".codex");
    const rawSecret = "sk-gui-secret-never-print";
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, "config.toml"), 'model_provider = "custom"\nmodel = "pa/gpt-5.5"\n', "utf8");
    await writeFile(join(codexDir, "auth.json"), JSON.stringify({ OPENAI_API_KEY: rawSecret }), "utf8");

    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      llmHomeDir: home,
    });

    try {
      const rejected = await fetch(`http://127.0.0.1:${server.port}/api/llm/secret-metadata`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "wrong", llm: { provider: "codex" } }),
      });
      assert.equal(rejected.status, 403);
      const rejectedPayload = await rejected.json();
      assert.equal(rejectedPayload.reason, "secret_metadata_confirmation_required");

      const response = await fetch(`http://127.0.0.1:${server.port}/api/llm/secret-metadata`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "READ-LOCAL-LLM-SECRET-METADATA", llm: { provider: "codex" } }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(JSON.stringify(payload).includes(rawSecret), false);
      assert.ok(payload.metadata.some((item) => item.keyName === "OPENAI_API_KEY" && item.fingerprint));

      const auditText = await readFile(auditPath, "utf8");
      assert.equal(auditText.includes(rawSecret), false);
      const auditEvents = auditText.trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "llm_secret_metadata_read");
      assert.equal(auditEvents.at(-1).risk, "secret-metadata-redacted");
      assert.ok(auditEvents.at(-1).entries.some((item) => item.keyName === "OPENAI_API_KEY"));
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server returns sanitized LLM split diagnostics on command failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-plan-split-diagnostic-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      llmProviderConfig: {
        provider: "codex",
        command: process.execPath,
      },
      llmCommandExists: async () => true,
      llmPathExists: async () => true,
      llmExec: async () => ({ code: 124, stdout: "", stderr: "command timed out after 1ms token=sk-never-print" }),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/plan/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "llm",
          goal: { id: "goal-1", status: "locked", objective: "Split goal" },
        }),
      });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.ok, false);
      assert.equal(payload.reason, "llm_timeout");
      assert.equal(payload.diagnostic.result.code, 124);
      const serialized = JSON.stringify(payload);
      assert.equal(serialized.includes("sk-never-print"), false);
      assert.equal(serialized.includes("[redacted]"), true);

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "plan_set_generation_blocked");
      assert.equal(auditEvents.at(-1).blocked_reason, "llm_timeout");
      assert.equal(auditEvents.at(-1).exit_code, 124);
      assert.equal(JSON.stringify(auditEvents).includes("sk-never-print"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server rejects image2 creation without the confirmation token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-server-reject-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      exec: async () => {
        throw new Error("should not run multica without confirmation");
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/agent-config/image2/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "wrong" }),
      });

      assert.equal(response.status, 403);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.match(payload.error, /confirmation/i);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server uses a bounded discovery timeout for preset preview failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-timeout-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      discoveryTimeoutMs: 25,
      discoveryRetries: 0,
      exec: async () => new Promise(() => {}),
    });

    try {
      const startedAt = Date.now();
      const response = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets/team-gui-builder/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overrides: {
            agent: {
              name: "Edited GUI Builder",
            },
          },
        }),
      });
      const elapsed = Date.now() - startedAt;
      const payload = await response.json();

      assert.equal(response.status, 500);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /timed out/i);
      assert.ok(elapsed < 1000, `expected bounded failure, took ${elapsed}ms`);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server uses a bounded discovery timeout for preset create failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-create-timeout-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      discoveryTimeoutMs: 25,
      discoveryRetries: 0,
      exec: async () => new Promise(() => {}),
    });

    try {
      const startedAt = Date.now();
      const response = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets/team-gui-builder/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "CREATE-MULTICA-AGENT-FROM-PRESET",
          overrides: {
            agent: {
              name: "Edited GUI Builder",
            },
          },
        }),
      });
      const elapsed = Date.now() - startedAt;
      const payload = await response.json();

      assert.equal(response.status, 500);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /timed out/i);
      assert.ok(elapsed < 1000, `expected bounded failure, took ${elapsed}ms`);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server creates a team preset in the current local server session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-team-preset-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      exec: async () => {
        throw new Error("team preset creation should not call multica");
      },
    });

    try {
      const createResponse = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Team Image Review Agent",
          createdBy: "DesignOps",
          description: "Review generated image concepts before sharing.",
          role: "Image review",
          agent: {
            instructions: "Review generated image concepts for quality, consistency, and launch risk.",
            model: "pa/gpt-5.5",
            runtimeHint: "local-codex",
          },
          skills: [{ name: "paigod-imagegen" }],
          mcpServers: [{ name: "filesystem", purpose: "Read local assets.", required: true }],
          permissions: {
            scopes: ["workspace:read", "asset:read"],
            ttl: "1 hour",
            approvalRequired: true,
            riskLevel: "medium",
          },
          environment: [{ key: "OPENAI_API_KEY", pathHint: "%USERPROFILE%\\.codex\\auth.json", required: true }],
          guardrails: ["preview first", "no secret logging"],
        }),
      });

      assert.equal(createResponse.status, 201);
      const createPayload = await createResponse.json();
      assert.equal(createPayload.ok, true);
      assert.equal(createPayload.preset.source, "team");
      assert.equal(createPayload.preset.name, "Team Image Review Agent");
      assert.equal(JSON.stringify(createPayload).includes("sk-"), false);

      const listResponse = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets`);
      const listPayload = await listResponse.json();
      assert.ok(listPayload.presets.some((preset) => preset.id === createPayload.preset.id));
      assert.ok(listPayload.presets.some((preset) => preset.name === "Team Image Review Agent"));
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server lists presets and creates an agent from an edited team preset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-preset-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      exec: async (args) => {
        calls.push(args);
        if (args[0] === "daemon") {
          return textResult("Daemon:      running\nVersion:     0.3.15\n");
        }
        if (args[0] === "workspace") {
          return jsonResult([{ id: "ws-1", name: "SparkProject", slug: "sparkproject" }]);
        }
        if (args[0] === "project") {
          return jsonResult([{ id: "project-1", title: "MulticaPlusPlus", workspace_id: "ws-1" }]);
        }
        if (args[0] === "runtime") {
          return jsonResult([{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }]);
        }
        if (args[0] === "agent" && args[1] === "list") {
          return jsonResult([{ id: "agent-source", name: "Codex Full Access Worker", model: "pa/gpt-5.5", runtime_id: "rt-codex", custom_args: ["-c", "approval_policy=never"] }]);
        }
        if (args[0] === "skill" && args[1] === "list") {
          return jsonResult([{ id: "skill-launch", name: "launch-review" }]);
        }
        if (args[0] === "agent" && args[1] === "create") {
          return jsonResult({ id: "agent-preset-created", name: "Edited GUI Builder" });
        }
        if (args[0] === "agent" && args[1] === "skills") {
          return jsonResult([{ id: "skill-launch", name: "launch-review" }]);
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });

    try {
      const listResponse = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets`);
      assert.equal(listResponse.status, 200);
      const listPayload = await listResponse.json();
      assert.equal(listPayload.ok, true);
      assert.ok(listPayload.presets.some((preset) => preset.source === "team"));

      const previewResponse = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets/team-gui-builder/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overrides: {
            agent: {
              name: "Edited GUI Builder",
              instructions: "Implement the preset-backed GUI flow.",
            },
            skills: [{ name: "launch-review" }],
          },
        }),
      });
      assert.equal(previewResponse.status, 200);
      const previewPayload = await previewResponse.json();
      assert.equal(previewPayload.ok, true);
      assert.equal(previewPayload.plan.target.name, "Edited GUI Builder");
      assert.ok(previewPayload.plan.blockedOperations.some((operation) => operation.type === "agent:mcp:set"));

      const createResponse = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets/team-gui-builder/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "CREATE-MULTICA-AGENT-FROM-PRESET",
          overrides: {
            agent: {
              name: "Edited GUI Builder",
              instructions: "Implement the preset-backed GUI flow.",
            },
            skills: [{ name: "launch-review" }],
          },
        }),
      });
      assert.equal(createResponse.status, 200);
      const createPayload = await createResponse.json();
      assert.equal(createPayload.ok, true);
      assert.equal(createPayload.result.targetAgentId, "agent-preset-created");
      assert.ok(calls.some((args) => args[0] === "agent" && args[1] === "create"));

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "agent_preset_create");
      assert.equal(auditEvents.at(-1).target_agent_id, "agent-preset-created");
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function jsonResult(value) {
  return { stdout: JSON.stringify(value), stderr: "", code: 0 };
}

function textResult(stdout) {
  return { stdout, stderr: "", code: 0 };
}

function sampleLockedGoal() {
  return {
    id: "goal-1",
    status: "locked",
    title: "实现 Plan 到 Issue 闭环",
    objective: "从 PlanSet 预览并创建业务 Multica Issue。",
    owner: "Codex",
    source: "gui-test",
    successCriteria: ["Issue preview returned", "Issue creation requires confirmation"],
    constraints: ["preview-first"],
    language: "zh-CN",
  };
}

function samplePlanSet(goal = sampleLockedGoal()) {
  return {
    id: "plan-set-1",
    goalId: goal.id,
    status: "draft",
    language: "zh-CN",
    splitMode: "parallel",
    strategy: "llm-assisted-workstreams",
    provider: { id: "provider-multica-agent", kind: "multica-agent", source: "multica-agent" },
    plans: [
      {
        id: "subplan-1",
        number: 1,
        title: "业务 Issue 预览",
        objective: "生成可审查的业务 Issue 候选。",
        workstream: { id: "preview", label: "Preview", reason: "Independent." },
        suggestedAgent: "planner-agent",
        dependencies: [],
        steps: [
          { number: 1, title: "生成候选", status: "pending", dependencies: [], acceptanceEvidence: "Issue candidate visible." },
          { number: 2, title: "检查 metadata", status: "pending", dependencies: [1], acceptanceEvidence: "Metadata included." },
        ],
        acceptanceEvidence: "Issue preview includes one candidate.",
      },
      {
        id: "subplan-2",
        number: 2,
        title: "业务 Issue 创建",
        objective: "确认后创建真实业务 Issue。",
        workstream: { id: "apply", label: "Apply", reason: "Requires explicit confirmation." },
        suggestedAgent: "executor-agent",
        dependencies: [],
        steps: [
          { number: 1, title: "校验 token", status: "pending", dependencies: [], acceptanceEvidence: "Wrong token is blocked." },
          { number: 2, title: "调用 Multica CLI", status: "pending", dependencies: [1], acceptanceEvidence: "Issue id returned." },
        ],
        acceptanceEvidence: "Issue creation returns created issue ids.",
      },
    ],
    warnings: [],
  };
}

function sampleIssueSplit() {
  const goal = sampleLockedGoal();
  const planSet = samplePlanSet(goal);
  return {
    id: "issue-split-1",
    mode: "plan_set",
    language: "zh-CN",
    confirmationRequired: true,
    confirmationToken: "APPLY-MULTICA-ISSUE-SPLIT",
    summary: "确认后将创建 2 个业务 Issue。",
    issues: planSet.plans.map((plan) => ({
      id: `issue-preview-${plan.number}`,
      title: `${goal.title} · ${plan.title}`,
      description: `目标：${goal.objective}\n\nPlan：${plan.objective}`,
      priority: "medium",
      projectId: "",
      metadata: {
        source: "multicaplusplus",
        goal_id: goal.id,
        plan_set_id: planSet.id,
        subplan_id: plan.id,
        workstream_id: plan.workstream.id,
        split_mode: "plan_set",
        provider_source: "multica-agent",
      },
    })),
    operations: [],
  };
}

function mockAssistExec({
  calls = [],
  prompts = [],
  planDraft,
  goalDraft,
  asyncRuns = false,
  goalCommentDraft,
  planCommentDraft,
}) {
  return async (args) => {
    calls.push(args);
    const key = args.join(" ");
    if (key === "daemon status") {
      return textResult("Daemon:      running (pid 1)\nVersion:     0.3.17\nAgents:      claude, codex\n");
    }
    if (key === "runtime list --output json") {
      return jsonResult([
        { id: "rt-lead", provider: "claude", name: "Claude Local", status: "online", runtime_mode: "local" },
        { id: "rt-worker", provider: "codex", name: "Codex Local", status: "online", runtime_mode: "local" },
      ]);
    }
    if (key === "agent list --output json") {
      return jsonResult([
        { id: "agent-worker", name: "Codex Full Access Worker", description: "danger-full-access worker", model: "pa/gpt-5.5", status: "idle", runtime_id: "rt-worker", runtime_mode: "local" },
        { id: "agent-lead", name: "Claude-Lead", description: "planner architect leader", model: "pa/claude-opus", status: "idle", runtime_id: "rt-lead", runtime_mode: "local" },
      ]);
    }
    if (args[0] === "issue" && args[1] === "search") {
      return jsonResult([]);
    }
    if (args[0] === "issue" && args[1] === "create") {
      const title = args[args.indexOf("--title") + 1] || "";
      const descriptionFile = args[args.indexOf("--description-file") + 1];
      if (descriptionFile) {
        prompts.push(await readFile(descriptionFile, "utf8"));
      }
      const isGoal = title.includes("Goal clarification") || title.includes("Inbox · Goal");
      return jsonResult({
        id: isGoal ? "issue-goal" : "issue-plan",
        identifier: isGoal ? "SPA-99" : "SPA-100",
        title,
        status: "todo",
        assignee_id: args[args.indexOf("--assignee-id") + 1],
        assignee_type: "agent",
      });
    }
    if (args[0] === "issue" && args[1] === "subscriber" && args[2] === "add") {
      return jsonResult({ ok: true, issue_id: args[3] });
    }
    if (key === "issue runs issue-goal --output json") {
      if (asyncRuns) {
        return jsonResult([{ id: "run-goal", status: "completed", agent_id: "agent-lead", runtime_id: "rt-lead", result: { output: "Agent 已完成 Goal 澄清，JSON 已写入评论。" } }]);
      }
      return jsonResult([{ id: "run-goal", status: "completed", agent_id: "agent-lead", runtime_id: "rt-lead", result: { output: JSON.stringify(goalDraft) } }]);
    }
    if (key === "issue runs issue-plan --output json") {
      if (asyncRuns) {
        return jsonResult([{ id: "run-plan", status: "completed", agent_id: "agent-lead", runtime_id: "rt-lead", result: { output: "Agent 已完成 Plan 拆分，JSON 已写入评论。" } }]);
      }
      return jsonResult([{ id: "run-plan", status: "completed", agent_id: "agent-lead", runtime_id: "rt-lead", result: { output: JSON.stringify(planDraft) } }]);
    }
    if (key === "issue run-messages run-goal --issue issue-goal --output json") {
      return jsonResult([{ id: "message-goal", content: "过程摘要：已处理。" }]);
    }
    if (key === "issue run-messages run-plan --issue issue-plan --output json") {
      return jsonResult([{ id: "message-plan", content: "过程摘要：已处理。" }]);
    }
    if (key === "issue comment list issue-goal --output json") {
      return jsonResult([{ id: "comment-goal", content: JSON.stringify(goalCommentDraft || goalDraft) }]);
    }
    if (key === "issue comment list issue-plan --output json") {
      return jsonResult([{ id: "comment-plan", content: JSON.stringify(planCommentDraft || planDraft) }]);
    }
    throw new Error(`unexpected ${key}`);
  };
}

function sampleLlmPlanDraft() {
  return {
    plans: [
      {
        title: "Provider discovery",
        objective: "Detect local Agent CLI providers without reading secrets.",
        workstream: { id: "provider-discovery", label: "Provider Discovery", reason: "Independent setup work." },
        suggestedAgent: "planner-agent",
        dependencies: [],
        steps: [
          { title: "Detect providers", description: "Check paths and commands.", dependencies: [], acceptanceEvidence: "Metadata only." },
          { title: "Report blocked", description: "Return no_llm_provider when needed.", dependencies: [1], acceptanceEvidence: "Blocked JSON." },
        ],
        acceptanceEvidence: "Provider discovery is covered by tests.",
      },
      {
        title: "Plan set rendering",
        objective: "Render multiple parallel sub-plans.",
        workstream: { id: "plan-rendering", label: "Plan Rendering", reason: "Separate GUI work." },
        suggestedAgent: "gui-agent",
        dependencies: [],
        steps: [
          { title: "Render cards", description: "Show each sub-plan.", dependencies: [], acceptanceEvidence: "Cards visible." },
          { title: "Preview issues", description: "One issue candidate per sub-plan.", dependencies: [1], acceptanceEvidence: "Preview metadata." },
        ],
        acceptanceEvidence: "Multiple cards are visible.",
      },
    ],
    risks: ["Unsafe LLM output must be blocked"],
    questions: [],
  };
}

function sampleLlmGoalDraft() {
  return {
    status: "clarified",
    title: "实现真实 LLM Goal 澄清",
    objective: "用本机 Agent CLI 将用户请求澄清为可锁定 Goal 草案。",
    successCriteria: ["LLM 成功时返回 clarified Goal", "LLM 失败时返回 blocked"],
    scope: { in: ["Goal 澄清"], out: ["不写 Multica"] },
    constraints: ["preview-first", "do-not-log-secrets"],
    risks: ["provider 未认证时会阻断"],
    clarificationQuestions: [],
    confidence: "medium",
  };
}
