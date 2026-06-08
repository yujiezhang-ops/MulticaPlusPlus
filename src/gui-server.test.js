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

function mockAssistExec({ calls = [], prompts = [], planDraft, goalDraft }) {
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
    if (args[0] === "issue" && args[1] === "create") {
      const title = args[args.indexOf("--title") + 1] || "";
      const descriptionFile = args[args.indexOf("--description-file") + 1];
      if (descriptionFile) {
        prompts.push(await readFile(descriptionFile, "utf8"));
      }
      const isGoal = title.includes("Goal clarification");
      return jsonResult({
        id: isGoal ? "issue-goal" : "issue-plan",
        identifier: isGoal ? "SPA-99" : "SPA-100",
        title,
        status: "todo",
        assignee_id: args[args.indexOf("--assignee-id") + 1],
        assignee_type: "agent",
      });
    }
    if (key === "issue runs issue-goal --output json") {
      return jsonResult([{ id: "run-goal", status: "completed", agent_id: "agent-lead", runtime_id: "rt-lead", result: { output: JSON.stringify(goalDraft) } }]);
    }
    if (key === "issue runs issue-plan --output json") {
      return jsonResult([{ id: "run-plan", status: "completed", agent_id: "agent-lead", runtime_id: "rt-lead", result: { output: JSON.stringify(planDraft) } }]);
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
