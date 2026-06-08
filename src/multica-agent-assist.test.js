import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  diagnoseAssistAgents,
  discoverAssistAgents,
  invokeMulticaAgentForGoalClarification,
  invokeMulticaAgentForPlanSplit,
  parseAgentJsonResponse,
  selectAssistAgent,
} from "./multica-agent-assist.js";

test("discovers Multica agents and auto-selects a planner-like local online agent", async () => {
  const exec = mockExec({
    "daemon status": textResult("Daemon:      running (pid 1)\nVersion:     0.3.17\nAgents:      codex, claude\n"),
    "runtime list --output json": jsonResult([
      { id: "rt-codex", provider: "codex", name: "Codex Local", status: "online", runtime_mode: "local" },
      { id: "rt-claude", provider: "claude", name: "Claude Local", status: "online", runtime_mode: "local" },
    ]),
    "agent list --output json": jsonResult([
      {
        id: "agent-worker",
        name: "Codex Full Access Worker",
        description: "danger-full-access implementation worker",
        model: "pa/gpt-5.5",
        status: "idle",
        runtime_id: "rt-codex",
        runtime_mode: "local",
      },
      {
        id: "agent-lead",
        name: "Claude-Lead",
        description: "planner architect leader",
        model: "pa/claude-opus",
        status: "idle",
        runtime_id: "rt-claude",
        runtime_mode: "local",
      },
    ]),
  });

  const result = await discoverAssistAgents({ exec });

  assert.equal(result.status, "available");
  assert.equal(result.selectedAgent.id, "agent-lead");
  assert.equal(result.agents.length, 2);
  assert.equal(JSON.stringify(result).includes("danger-full-access implementation worker"), true);
});

test("manual selection uses the requested agent and rejects missing ids", () => {
  const agents = [
    { id: "a", name: "Planner", status: "idle" },
    { id: "b", name: "Worker", status: "idle" },
  ];

  assert.equal(selectAssistAgent({ agents, preferredAgentId: "b" }).selectedAgent.id, "b");
  assert.equal(selectAssistAgent({ agents, preferredAgentId: "missing" }).reason, "assist_agent_not_found");
  assert.equal(selectAssistAgent({ agents, mode: "manual" }).reason, "assist_agent_required");
});

test("invokes Multica agent for goal clarification through issue create and issue runs", async () => {
  const calls = [];
  const exec = async (args) => {
    calls.push(args);
    const key = args.join(" ");
    if (key.startsWith("issue create")) {
      assert.ok(args.includes("--description-file"));
      const promptPath = args[args.indexOf("--description-file") + 1];
      const prompt = await readFile(promptPath, "utf8");
      assert.match(prompt, /Output language: zh-CN/);
      assert.match(prompt, /用户可见字段必须使用简体中文/);
      assert.ok(args.includes("--assignee-id"));
      return jsonResult({ id: "issue-1", identifier: "SPA-99", title: "assist", status: "todo" });
    }
    if (key === "issue runs issue-1 --output json") {
      return jsonResult([
        {
          id: "run-1",
          status: "completed",
          result: {
            output: JSON.stringify(sampleGoalDraft()),
          },
        },
      ]);
    }
    throw new Error(`unexpected command: ${key}`);
  };

  const result = await invokeMulticaAgentForGoalClarification({
    agent: { id: "agent-lead", name: "Claude-Lead", model: "pa/claude-opus" },
    request: "实现 Agent 辅助 Goal 澄清",
    context: { project: "MulticaPlusPlus" },
    exec,
  });

  assert.equal(result.ok, true);
  assert.equal(result.goalDraft.title, "Agent 辅助目标澄清");
  assert.equal(result.assist.issue.id, "issue-1");
  assert.equal(result.assist.run.id, "run-1");
  assert.equal(calls.some((args) => args[0] === "issue" && args[1] === "create"), true);
});

test("invokes Multica agent for plan splitting and parses fenced JSON output", async () => {
  const exec = async (args) => {
    const key = args.join(" ");
    if (key.startsWith("issue create")) {
      const promptPath = args[args.indexOf("--description-file") + 1];
      const prompt = await readFile(promptPath, "utf8");
      assert.match(prompt, /Output language: zh-CN/);
      assert.match(prompt, /Plan steps/);
      assert.match(prompt, /用户可见字段必须使用简体中文/);
      return jsonResult({ id: "issue-2", identifier: "SPA-100", title: "assist", status: "todo" });
    }
    if (key === "issue runs issue-2 --output json") {
      return jsonResult([
        {
          id: "run-2",
          status: "completed",
          result: {
            output: `done\n\n\`\`\`json\n${JSON.stringify(samplePlanSetDraft())}\n\`\`\``,
          },
        },
      ]);
    }
    throw new Error(`unexpected command: ${key}`);
  };

  const result = await invokeMulticaAgentForPlanSplit({
    agent: { id: "agent-lead", name: "Claude-Lead", model: "pa/claude-opus" },
    goal: { id: "goal-1", status: "locked", objective: "Ship", constraints: [] },
    exec,
  });

  assert.equal(result.ok, true);
  assert.equal(result.planSetDraft.plans.length, 2);
  assert.equal(result.assist.issue.identifier, "SPA-100");
});

test("blocks failed, timed-out, and non-json agent outputs", async () => {
  const failed = await invokeMulticaAgentForPlanSplit({
    agent: { id: "agent-lead", name: "Claude-Lead" },
    goal: { id: "goal-1", status: "locked", objective: "Ship", constraints: [] },
    exec: async (args) => {
      const key = args.join(" ");
      if (key.startsWith("issue create")) return jsonResult({ id: "issue-failed" });
      if (key === "issue runs issue-failed --output json") return jsonResult([{ id: "run-failed", status: "failed", error: "no model" }]);
      throw new Error(`unexpected command: ${key}`);
    },
  });
  assert.equal(failed.reason, "multica_agent_run_failed");

  const nonJson = await invokeMulticaAgentForPlanSplit({
    agent: { id: "agent-lead", name: "Claude-Lead" },
    goal: { id: "goal-1", status: "locked", objective: "Ship", constraints: [] },
    exec: async (args) => {
      const key = args.join(" ");
      if (key.startsWith("issue create")) return jsonResult({ id: "issue-json" });
      if (key === "issue runs issue-json --output json") return jsonResult([{ id: "run-json", status: "completed", result: { output: "not json" } }]);
      throw new Error(`unexpected command: ${key}`);
    },
  });
  assert.equal(nonJson.reason, "multica_agent_non_json_output");
});

test("diagnose returns blocked when agent list command fails without exposing secrets", async () => {
  const result = await diagnoseAssistAgents({
    exec: mockExec({
      "daemon status": textResult("Daemon: running\n"),
      "runtime list --output json": jsonResult([]),
      "agent list --output json": { code: 1, stdout: "", stderr: "auth token=sk-never-print required" },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "multica_auth_required");
  assert.equal(JSON.stringify(result).includes("sk-never-print"), false);
});

test("parseAgentJsonResponse extracts raw, fenced, and embedded JSON", () => {
  assert.deepEqual(parseAgentJsonResponse('{"ok":true}'), { ok: true });
  assert.deepEqual(parseAgentJsonResponse('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseAgentJsonResponse('result: {"ok":true, "nested": {"a": 1}} done'), { ok: true, nested: { a: 1 } });
  assert.throws(() => parseAgentJsonResponse("plain text"), /JSON/i);
});

function mockExec(map) {
  return async (args) => {
    const key = args.join(" ");
    if (!Object.hasOwn(map, key)) {
      throw new Error(`unexpected command: ${key}`);
    }
    return map[key];
  };
}

function jsonResult(value) {
  return { code: 0, stdout: JSON.stringify(value), stderr: "" };
}

function textResult(value) {
  return { code: 0, stdout: value, stderr: "" };
}

function sampleGoalDraft() {
  return {
    status: "clarified",
    title: "Agent 辅助目标澄清",
    objective: "通过 Multica Agent 生成真实目标草案。",
    successCriteria: ["返回可锁定 Goal", "不写业务 Issue"],
    scope: { in: ["Goal 澄清"], out: ["业务 Issue 创建"] },
    constraints: ["preview-first"],
    risks: ["Agent 输出需要校验"],
    clarificationQuestions: [],
    confidence: "medium",
  };
}

function samplePlanSetDraft() {
  return {
    plans: [
      minimalPlan("core"),
      minimalPlan("gui"),
    ],
    risks: ["Agent 输出需要人工 review"],
    questions: [],
  };
}

function minimalPlan(id) {
  return {
    title: `${id} plan`,
    objective: `${id} objective`,
    workstream: { id, label: id, reason: "independent" },
    suggestedAgent: "agent-lead",
    dependencies: [],
    steps: [
      { title: "Step 1", description: "Do first", dependencies: [], acceptanceEvidence: "Evidence 1" },
      { title: "Step 2", description: "Do second", dependencies: [1], acceptanceEvidence: "Evidence 2" },
    ],
    acceptanceEvidence: "Done",
  };
}
