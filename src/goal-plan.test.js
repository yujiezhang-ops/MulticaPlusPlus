import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  generatePlanFromGoal,
  lockGoalDraft,
  normalizeGoal,
  normalizeGoalWithAgent,
  normalizeGoalWithLlm,
  previewIssueSplitFromPlanSet,
  previewIssueSplit,
  splitGoalIntoPlansWithAgent,
  splitGoalIntoPlansWithLlm,
} from "./goal-plan.js";

test("normalizes a fuzzy request into a clarified goal draft", () => {
  const goal = normalizeGoal({
    request: "帮我把插件做得更好，可以让团队成员一键配置 agent",
    context: {
      project: "MulticaPlusPlus",
      source: "gui",
      owner: "Codex",
    },
  });

  assert.equal(goal.status, "clarified");
  assert.equal(goal.title, "完善 MulticaPlusPlus 的一键配置 Agent 能力");
  assert.match(goal.objective, /团队成员/);
  assert.ok(goal.successCriteria.includes("用户可以从 GUI 输入需求并获得明确 Goal"));
  assert.ok(goal.successCriteria.includes("用户可以预览 Plan 到 Multica issue 的拆分建议"));
  assert.ok(goal.scope.in.includes("Goal 归一化"));
  assert.ok(goal.scope.out.includes("不自动创建 Multica issue"));
  assert.equal(goal.owner, "Codex");
  assert.equal(goal.source, "gui");
  assert.equal(goal.confidence, "medium");
});

test("keeps highly ambiguous requests in draft with clarification questions", () => {
  const goal = normalizeGoal({ request: "做一下" });

  assert.equal(goal.status, "draft");
  assert.ok(goal.clarificationQuestions.length >= 2);
  assert.match(goal.clarificationQuestions[0], /具体要完成/);
});

test("normalizes a goal with LLM semantic fields while keeping trusted local metadata", async () => {
  const createdAt = "2026-06-08T00:00:00.000Z";
  const goal = await normalizeGoalWithLlm({
    request: "请实现真实 LLM Goal 澄清",
    context: { owner: "Codex", source: "gui", project: "MulticaPlusPlus" },
    provider: { id: "provider-codex", kind: "codex", command: "codex", model: "gpt-5", source: "codex" },
    createdAt,
    invokeLlm: async () => ({
      ok: true,
      goalDraft: sampleLlmGoalDraft(),
    }),
  });

  assert.equal(goal.status, "clarified");
  assert.equal(goal.createdAt, createdAt);
  assert.equal(goal.updatedAt, createdAt);
  assert.equal(goal.owner, "Codex");
  assert.equal(goal.source, "gui");
  assert.equal(goal.project, "MulticaPlusPlus");
  assert.equal(goal.rawRequest, "请实现真实 LLM Goal 澄清");
  assert.equal(goal.title, sampleLlmGoalDraft().title);
  assert.equal(goal.llm.provider, "codex");
  assert.equal(goal.llm.model, "gpt-5");
  assert.ok(goal.id.startsWith("goal_"));
});

test("normalizes a goal with Multica Agent assist while keeping trusted local metadata", async () => {
  const createdAt = "2026-06-08T00:00:00.000Z";
  const goal = await normalizeGoalWithAgent({
    request: "请通过 Multica Agent 澄清目标",
    context: { owner: "Codex", source: "gui", project: "MulticaPlusPlus" },
    agent: { id: "agent-lead", name: "Claude-Lead", model: "pa/claude-opus" },
    createdAt,
    invokeAgent: async () => ({
      ok: true,
      goalDraft: sampleLlmGoalDraft(),
      assist: {
        agent: { id: "agent-lead", name: "Claude-Lead" },
        issue: { id: "issue-1", identifier: "SPA-99" },
        run: { id: "run-1", status: "completed" },
      },
    }),
  });

  assert.equal(goal.status, "clarified");
  assert.equal(goal.llm.provider, "multica-agent");
  assert.equal(goal.llm.model, "pa/claude-opus");
  assert.equal(goal.assist.issue.identifier, "SPA-99");
  assert.equal(goal.owner, "Codex");
  assert.equal(goal.createdAt, createdAt);
});

test("returns blocked when LLM goal clarification fails or outputs invalid fields", async () => {
  const blocked = await normalizeGoalWithLlm({
    request: "澄清目标",
    provider: { kind: "codex", command: "codex" },
    invokeLlm: async () => ({
      ok: false,
      blocked: true,
      reason: "llm_auth_required",
      diagnostic: { result: { code: 1, stderrExcerpt: "Auth required [redacted]" } },
    }),
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "llm_auth_required");
  assert.equal(blocked.diagnostic.result.code, 1);

  const invalid = await normalizeGoalWithLlm({
    request: "澄清目标",
    provider: { kind: "codex", command: "codex" },
    invokeLlm: async () => ({
      ok: true,
      goalDraft: { ...sampleLlmGoalDraft(), successCriteria: [] },
    }),
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "missing_success_criteria");
});

test("locks only clarified goals", () => {
  const clarified = normalizeGoal({
    request: "实现 Goal 和 Plan 模块，把模糊需求拆成可以审查的计划",
  });
  const locked = lockGoalDraft(clarified, { approvedBy: "human" });

  assert.equal(locked.status, "locked");
  assert.equal(locked.approvedBy, "human");
  assert.ok(locked.lockedAt);

  const draft = normalizeGoal({ request: "做一下" });
  assert.throws(() => lockGoalDraft(draft), /cannot lock goal in draft state/);
});

test("generates an ordered plan from a locked goal", () => {
  const goal = lockGoalDraft(normalizeGoal({
    request: "实现 Goal Plan 模块，并且可以预览是否拆成一个或多个 Multica issue",
    context: { owner: "Codex" },
  }));
  const plan = generatePlanFromGoal({
    goal,
    complexity: "medium",
    availableAgents: [
      { id: "planner-agent", role: "planner" },
      { id: "review-agent", role: "review" },
    ],
  });

  assert.equal(plan.status, "draft");
  assert.equal(plan.goalId, goal.id);
  assert.equal(plan.complexity, "medium");
  assert.equal(plan.steps.length, 5);
  assert.deepEqual(plan.steps.map((step) => step.status), [
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
  assert.equal(plan.steps[0].suggestedAgent, "planner-agent");
  assert.match(plan.steps[0].acceptanceEvidence, /Goal/);
});

test("requires locked goal before plan generation", () => {
  const goal = normalizeGoal({ request: "实现 Goal Plan 模块" });

  assert.throws(() => generatePlanFromGoal({ goal }), /locked goal required/);
});

test("splits a locked goal into multiple LLM-assisted draft plans", async () => {
  const createdAt = "2026-06-08T00:00:00.000Z";
  const goal = lockGoalDraft(normalizeGoal({
    request: "实现 LLM 辅助 Goal 到多个 Plan 的拆分，并保留 preview-first 边界",
  }));

  const planSet = await splitGoalIntoPlansWithLlm({
    goal,
    provider: { id: "provider-codex", kind: "codex", command: "codex", model: "gpt-5-codex", source: "codex" },
    availableAgents: [{ id: "planner-agent", role: "planner" }],
    createdAt,
    invokeLlm: async () => ({
      ok: true,
      planSetDraft: sampleLlmPlanDraft(),
      rawText: JSON.stringify(sampleLlmPlanDraft()),
    }),
  });

  assert.equal(planSet.status, "draft");
  assert.equal(planSet.goalId, goal.id);
  assert.equal(planSet.splitMode, "parallel");
  assert.equal(planSet.strategy, "llm-assisted-workstreams");
  assert.equal(planSet.provider.kind, "codex");
  assert.equal(planSet.plans.length, 2);
  assert.deepEqual(planSet.plans.map((plan) => plan.number), [1, 2]);
  assert.equal(planSet.plans[0].goalId, goal.id);
  assert.equal(planSet.plans[0].planSetId, planSet.id);
  assert.equal(planSet.plans[0].status, "draft");
  assert.equal(planSet.plans[0].steps.length, 2);
  assert.equal(planSet.plans[0].steps[0].status, "pending");
  assert.equal(planSet.plans[0].issueSplitRecommendation, "single");
});

test("splits a locked goal into multiple Multica Agent assisted draft plans", async () => {
  const goal = lockGoalDraft(normalizeGoal({
    request: "实现 Multica Agent 辅助 Goal 到多个 Plan 的拆分，并保留 preview-first 边界",
  }));
  const planSet = await splitGoalIntoPlansWithAgent({
    goal,
    agent: { id: "agent-lead", name: "Claude-Lead", model: "pa/claude-opus" },
    availableAgents: [{ id: "planner-agent", role: "planner" }],
    invokeAgent: async () => ({
      ok: true,
      planSetDraft: sampleLlmPlanDraft(),
      assist: {
        agent: { id: "agent-lead", name: "Claude-Lead" },
        issue: { id: "issue-2", identifier: "SPA-100" },
        run: { id: "run-2", status: "completed" },
      },
    }),
  });

  assert.equal(planSet.provider.kind, "multica-agent");
  assert.equal(planSet.strategy, "llm-assisted-workstreams");
  assert.equal(planSet.plans.length, 2);
  assert.equal(planSet.assist.issue.identifier, "SPA-100");
});

test("rejects LLM split unless the goal is locked", async () => {
  const goal = normalizeGoal({ request: "实现 LLM Goal Plan 拆分能力" });

  await assert.rejects(
    splitGoalIntoPlansWithLlm({
      goal,
      provider: { id: "provider-codex", kind: "codex", command: "codex", source: "codex" },
      invokeLlm: async () => ({ ok: true, planSetDraft: sampleLlmPlanDraft() }),
    }),
    /locked goal required/,
  );
});

test("blocks dangerous LLM plan instructions before building planSet", async () => {
  const goal = lockGoalDraft(normalizeGoal({
    request: "实现 LLM Goal Plan 拆分能力，但所有写入仍然必须先预览",
  }));
  const dangerousDraft = sampleLlmPlanDraft();
  dangerousDraft.plans[0].steps[0].description = "Run multica issue create immediately and write metadata without confirmation.";

  const result = await splitGoalIntoPlansWithLlm({
    goal,
    provider: { id: "provider-codex", kind: "codex", command: "codex", source: "codex" },
    invokeLlm: async () => ({ ok: true, planSetDraft: dangerousDraft }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "unsafe_plan_content");
});

test("preserves sanitized LLM diagnostic details when split is blocked", async () => {
  const goal = lockGoalDraft(normalizeGoal({
    request: "实现 LLM Goal Plan 拆分能力",
  }));

  const result = await splitGoalIntoPlansWithLlm({
    goal,
    provider: { id: "provider-codex", kind: "codex", command: "codex", source: "codex" },
    invokeLlm: async () => ({
      ok: false,
      blocked: true,
      reason: "llm_auth_required",
      diagnostic: {
        result: {
          code: 1,
          stderrExcerpt: "Auth required [redacted]",
        },
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "llm_auth_required");
  assert.equal(result.diagnostic.result.code, 1);
  assert.equal(JSON.stringify(result).includes("[redacted]"), true);
});

test("previews one Multica issue candidate per LLM sub-plan", async () => {
  const goal = lockGoalDraft(normalizeGoal({
    request: "实现 LLM 辅助 Goal 到多个 Plan 的拆分，并为每个工作流预览 issue",
  }));
  const planSet = await splitGoalIntoPlansWithLlm({
    goal,
    provider: { id: "provider-codex", kind: "codex", command: "codex", source: "codex" },
    invokeLlm: async () => ({ ok: true, planSetDraft: sampleLlmPlanDraft() }),
  });

  const issueSplit = previewIssueSplitFromPlanSet({ goal, planSet, projectId: "project-1" });

  assert.equal(issueSplit.mode, "plan_set");
  assert.equal(issueSplit.issues.length, planSet.plans.length);
  assert.equal(issueSplit.language, "zh-CN");
  assert.match(issueSplit.summary, /确认后/);
  assert.match(issueSplit.issues[0].description, /目标：/);
  assert.deepEqual(issueSplit.issues.map((issue) => issue.metadata.split_mode), ["plan_set", "plan_set"]);
  assert.ok(issueSplit.issues.every((issue) => issue.metadata.plan_set_id === planSet.id));
  assert.ok(issueSplit.issues.every((issue, index) => issue.metadata.subplan_id === planSet.plans[index].id));
  assert.ok(issueSplit.operations.every((operation) => operation.displayCommand.includes("multica issue create")));
});

test("previews no issue, single issue, and multi issue split without creating issues", () => {
  const goal = lockGoalDraft(normalizeGoal({
    request: "实现 Goal Plan 模块，复杂任务可拆成多个 Multica issue",
  }));

  const simplePlan = generatePlanFromGoal({ goal, complexity: "simple" });
  assert.equal(previewIssueSplit({ goal, plan: simplePlan }).mode, "none");

  const mediumPlan = generatePlanFromGoal({ goal, complexity: "medium" });
  const single = previewIssueSplit({ goal, plan: mediumPlan });
  assert.equal(single.mode, "single");
  assert.equal(single.issues.length, 1);
  assert.match(single.summary, /确认后/);
  assert.match(single.issues[0].description, /目标：/);
  assert.match(single.issues[0].description, /成功标准：/);
  assert.equal(single.confirmationRequired, true);

  const complexPlan = generatePlanFromGoal({ goal, complexity: "complex" });
  const multiple = previewIssueSplit({ goal, plan: complexPlan });
  assert.equal(multiple.mode, "multiple");
  assert.ok(multiple.issues.length >= 3);
  assert.ok(multiple.issues.every((issue) => issue.metadata.goal_id === goal.id));
  assert.equal(multiple.operations.length, multiple.issues.length);
  assert.ok(multiple.operations.every((operation) => operation.type === "issue:create"));
});

test("keeps deterministic Plan and Issue preview language aligned with zh-CN and en-US", () => {
  const zhGoal = lockGoalDraft(normalizeGoal({
    request: "实现 Goal Plan 模块，复杂任务可拆成多个 Multica issue",
    language: "zh-CN",
  }));
  const zhPlan = generatePlanFromGoal({ goal: zhGoal, complexity: "medium", language: "zh-CN" });
  const zhIssueSplit = previewIssueSplit({ goal: zhGoal, plan: zhPlan, language: "zh-CN" });

  assert.equal(zhPlan.language, "zh-CN");
  assert.equal(zhIssueSplit.language, "zh-CN");
  assert.match(zhPlan.steps[0].title, /锁定/);
  assert.match(zhIssueSplit.summary, /确认后/);
  assert.match(zhIssueSplit.issues[0].description, /计划步骤：/);
  assert.doesNotMatch(zhIssueSplit.issues[0].description, /^Goal:/m);

  const enGoal = lockGoalDraft(normalizeGoal({
    request: "Implement Goal Plan module",
    language: "en-US",
  }));
  const enPlan = generatePlanFromGoal({ goal: enGoal, complexity: "medium", language: "en-US" });
  const enIssueSplit = previewIssueSplit({ goal: enGoal, plan: enPlan, language: "en-US" });

  assert.equal(enGoal.language, "en-US");
  assert.equal(enPlan.language, "en-US");
  assert.equal(enIssueSplit.language, "en-US");
  assert.match(enPlan.steps[0].title, /Lock Goal/);
  assert.match(enIssueSplit.summary, /Create one Multica issue/);
  assert.match(enIssueSplit.issues[0].description, /^Goal:/m);
});

test("cli normalizes goal, generates plan, and previews issue split from files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-goal-plan-cli-"));
  try {
    const requestPath = join(dir, "request.json");
    const goalPath = join(dir, "goal.json");
    const lockedGoalPath = join(dir, "locked-goal.json");
    const planPath = join(dir, "plan.json");
    const splitPath = join(dir, "issue-split.json");
    await writeFile(requestPath, JSON.stringify({
      request: "实现 Goal Plan 模块，并且可以预览是否拆成一个或多个 Multica issue",
      context: { owner: "Codex", source: "cli-test" },
    }), "utf8");

    const normalize = spawnSync(
      process.execPath,
      ["src/cli.js", "goal", "normalize", "--input", requestPath, "--goal-out", goalPath, "--output", "json"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(normalize.status, 0, normalize.stderr);
    const normalizedGoal = JSON.parse(normalize.stdout);
    assert.equal(normalizedGoal.status, "clarified");

    const lock = spawnSync(
      process.execPath,
      ["src/cli.js", "goal", "lock", "--input", goalPath, "--goal-out", lockedGoalPath, "--approved-by", "human", "--output", "json"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(lock.status, 0, lock.stderr);
    const lockedGoal = JSON.parse(lock.stdout);
    assert.equal(lockedGoal.status, "locked");

    const plan = spawnSync(
      process.execPath,
      ["src/cli.js", "plan", "generate", "--input", lockedGoalPath, "--complexity", "complex", "--plan-out", planPath, "--output", "json"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(plan.status, 0, plan.stderr);
    const generatedPlan = JSON.parse(plan.stdout);
    assert.equal(generatedPlan.goalId, lockedGoal.id);
    assert.equal(generatedPlan.issueSplitRecommendation, "multiple");

    const preview = spawnSync(
      process.execPath,
      ["src/cli.js", "plan", "preview-issues", "--goal", lockedGoalPath, "--plan", planPath, "--issue-split-out", splitPath, "--output", "json"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(preview.status, 0, preview.stderr);
    const issueSplit = JSON.parse(preview.stdout);
    assert.equal(issueSplit.mode, "multiple");
    assert.ok(issueSplit.confirmationRequired);
    assert.ok(issueSplit.operations.every((operation) => operation.displayCommand.includes("multica issue create")));

    assert.deepEqual(JSON.parse(await readFile(goalPath, "utf8")), normalizedGoal);
    assert.deepEqual(JSON.parse(await readFile(lockedGoalPath, "utf8")), lockedGoal);
    assert.deepEqual(JSON.parse(await readFile(planPath, "utf8")), generatedPlan);
    assert.deepEqual(JSON.parse(await readFile(splitPath, "utf8")), issueSplit);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli goal normalize --agent uses Multica Agent assist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-goal-normalize-agent-"));
  try {
    const requestPath = join(dir, "request.json");
    const goalPath = join(dir, "goal.json");
    const mockMultica = await writeMockMulticaCli(dir, { planDraft: sampleLlmPlanDraft(), goalDraft: sampleLlmGoalDraft() });
    await writeFile(requestPath, JSON.stringify({
      request: "实现真实 Agent Goal 澄清",
      context: { owner: "Codex", source: "cli-test" },
    }), "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "goal",
        "normalize",
        "--input",
        requestPath,
        "--agent",
        "--cli-path",
        mockMultica,
        "--goal-out",
        goalPath,
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const goal = JSON.parse(result.stdout);
    assert.equal(goal.status, "clarified");
    assert.equal(goal.title, sampleLlmGoalDraft().title);
    assert.equal(goal.llm.provider, "multica-agent");
    assert.equal(goal.assist.issue.identifier, "SPA-99");
    assert.deepEqual(JSON.parse(await readFile(goalPath, "utf8")), goal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli llm secret-metadata requires confirmation and returns redacted summaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-secret-metadata-"));
  try {
    const codexDir = join(dir, ".codex");
    const rawSecret = "sk-cli-secret-never-print";
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, "config.toml"), 'model_provider = "custom"\nmodel = "pa/gpt-5.5"\n', "utf8");
    await writeFile(join(codexDir, "auth.json"), JSON.stringify({ OPENAI_API_KEY: rawSecret }), "utf8");

    const rejected = spawnSync(
      process.execPath,
      ["src/cli.js", "llm", "secret-metadata", "--output", "json"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, USERPROFILE: dir, HOME: dir },
      },
    );
    assert.notEqual(rejected.status, 0);
    assert.equal(JSON.parse(rejected.stdout).reason, "secret_metadata_confirmation_required");

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "llm",
        "secret-metadata",
        "--confirm",
        "READ-LOCAL-LLM-SECRET-METADATA",
        "--output",
        "json",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, USERPROFILE: dir, HOME: dir },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.provider, "codex");
    assert.equal(result.stdout.includes(rawSecret), false);
    assert.ok(payload.metadata.some((item) => item.keyName === "OPENAI_API_KEY" && item.fingerprint));
    assert.ok(payload.metadata.some((item) => item.keyName === "model" && item.fingerprint));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli discovers LLM providers as sanitized JSON", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli.js", "llm", "discover", "--output", "json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENAI_API_KEY: "sk-test-secret",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(["available", "blocked"].includes(payload.status));
  assert.equal(JSON.stringify(payload).includes("sk-test-secret"), false);
});

test("cli assist agents discovers Multica agents as sanitized JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-assist-discover-"));
  try {
    const mockMultica = await writeMockMulticaCli(dir, { planDraft: sampleLlmPlanDraft(), goalDraft: sampleLlmGoalDraft() });
    const result = spawnSync(
      process.execPath,
      ["src/cli.js", "assist", "agents", "--cli-path", mockMultica, "--output", "json"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "available");
    assert.equal(payload.selectedAgent.id, "agent-lead");
    assert.equal(JSON.stringify(payload).includes("sk-"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli splits a locked goal with Multica Agent assist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-plan-split-agent-"));
  try {
    const lockedGoalPath = join(dir, "locked-goal.json");
    const planSetPath = join(dir, "plan-set.json");
    const mockMultica = await writeMockMulticaCli(dir, { planDraft: sampleLlmPlanDraft(), goalDraft: sampleLlmGoalDraft() });
    const goal = lockGoalDraft(normalizeGoal({
      request: "实现 Agent 辅助 Goal 到多个 Plan 的拆分，并保留 preview-first 边界",
    }));
    await writeFile(lockedGoalPath, JSON.stringify(goal, null, 2), "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "plan",
        "split",
        "--input",
        lockedGoalPath,
        "--agent",
        "--cli-path",
        mockMultica,
        "--plan-set-out",
        planSetPath,
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const planSet = JSON.parse(result.stdout);
    assert.equal(planSet.goalId, goal.id);
    assert.equal(planSet.provider.kind, "multica-agent");
    assert.equal(planSet.assist.issue.identifier, "SPA-100");
    assert.equal(planSet.plans.length, 2);
    assert.deepEqual(JSON.parse(await readFile(planSetPath, "utf8")), planSet);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli --llm compatibility alias maps to Multica Agent assist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-plan-split-llm-alias-"));
  try {
    const lockedGoalPath = join(dir, "locked-goal.json");
    const planSetPath = join(dir, "plan-set.json");
    const mockMultica = await writeMockMulticaCli(dir, { planDraft: sampleLlmPlanDraft(), goalDraft: sampleLlmGoalDraft() });
    const goal = lockGoalDraft(normalizeGoal({
      request: "实现 --llm 兼容别名到 Agent 的拆分",
    }));
    await writeFile(lockedGoalPath, JSON.stringify(goal, null, 2), "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "plan",
        "split",
        "--input",
        lockedGoalPath,
        "--llm",
        "--cli-path",
        mockMultica,
        "--plan-set-out",
        planSetPath,
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const planSet = JSON.parse(result.stdout);
    assert.equal(planSet.goalId, goal.id);
    assert.equal(planSet.provider.kind, "multica-agent");
    assert.equal(planSet.plans.length, 2);
    assert.ok(planSet.warnings.some((warning) => warning.includes("--llm")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli plan split --agent blocks with non-zero exit when no assist agent exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-plan-split-blocked-"));
  try {
    const lockedGoalPath = join(dir, "locked-goal.json");
    const goal = lockGoalDraft(normalizeGoal({
      request: "实现 LLM 辅助 Goal 到多个 Plan 的拆分",
    }));
    await writeFile(lockedGoalPath, JSON.stringify(goal, null, 2), "utf8");

    const result = spawnSync(
      process.execPath,
      ["src/cli.js", "plan", "split", "--input", lockedGoalPath, "--agent", "--cli-path", "missing-multica", "--output", "json"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.blocked, true);
    assert.equal(payload.reason, "multica_cli_not_found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli llm diagnose returns sanitized readiness diagnostics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-llm-diagnose-"));
  try {
    const mockLlm = join(dir, "mock-codex.js");
    await writeFile(mockLlm, `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") === "exec --help") {
  process.stdout.write("Usage: codex exec [OPTIONS]");
  process.exit(0);
}
process.exit(2);
`, "utf8");
    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "llm",
        "diagnose",
        "--llm-provider",
        "codex",
        "--llm-command",
        mockLlm,
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, "ready");
    assert.equal(payload.provider.kind, "codex");
    assert.ok(payload.diagnostic.argvSummary.includes("exec"));
    assert.equal(JSON.stringify(payload).includes("sk-"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli deterministic plan split does not call an external LLM command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-plan-split-deterministic-"));
  try {
    const lockedGoalPath = join(dir, "locked-goal.json");
    const planSetPath = join(dir, "plan-set.json");
    const callsPath = join(dir, "calls.jsonl");
    const mockLlm = join(dir, "mock-llm.js");
    const goal = lockGoalDraft(normalizeGoal({
      request: "实现 Goal Plan 模块，复杂任务可拆成多个工作流",
    }));
    await writeFile(lockedGoalPath, JSON.stringify(goal, null, 2), "utf8");
    await writeFile(mockLlm, `#!/usr/bin/env node
const { appendFileSync } = await import("node:fs");
appendFileSync(${JSON.stringify(callsPath)}, "called\\n");
`, "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "plan",
        "split",
        "--input",
        lockedGoalPath,
        "--llm-command",
        mockLlm,
        "--plan-set-out",
        planSetPath,
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const planSet = JSON.parse(result.stdout);
    assert.equal(planSet.strategy, "deterministic-workstreams");
    assert.ok(planSet.plans.length >= 2);
    await assert.rejects(readFile(callsPath, "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli issue apply defaults to dry-run without Multica writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-issue-apply-dry-"));
  try {
    const splitPath = join(dir, "issue-split.json");
    const auditPath = join(dir, "audit.jsonl");
    const callsPath = join(dir, "calls.jsonl");
    const mockClient = join(dir, "mock-multica.js");
    await writeFile(mockClient, `#!/usr/bin/env node
const { appendFileSync } = await import("node:fs");
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");
throw new Error("dry-run should not call multica");
`);
    await writeFile(splitPath, JSON.stringify(sampleIssueSplit(), null, 2), "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "plan",
        "apply-issues",
        "--issue-split",
        splitPath,
        "--cli-path",
        mockClient,
        "--audit-path",
        auditPath,
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, "dry-run");
    assert.deepEqual(payload.operations.map((operation) => operation.status), ["planned"]);
    await assert.rejects(readFile(callsPath, "utf8"), /ENOENT/);

    const audit = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(audit[0].event_type, "issue_split_apply");
    assert.equal(audit[0].status, "planned");
    assert.equal(audit[0].issue_count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli issue apply executes create and metadata only with confirmation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-issue-apply-exec-"));
  try {
    const splitPath = join(dir, "issue-split.json");
    const auditPath = join(dir, "audit.jsonl");
    const callsPath = join(dir, "calls.jsonl");
    const mockClient = join(dir, "mock-multica.js");
    await writeFile(mockClient, `#!/usr/bin/env node
const { appendFileSync } = await import("node:fs");
const callsPath = ${JSON.stringify(callsPath)};
const args = process.argv.slice(2);
appendFileSync(callsPath, JSON.stringify(args) + "\\n");
function out(value) { process.stdout.write(JSON.stringify(value)); }
if (args[0] === "issue" && args[1] === "create") {
  out({ id: "issue-created", identifier: "SPA-GOAL", title: args[args.indexOf("--title") + 1] });
} else if (args[0] === "issue" && args[1] === "metadata" && args[2] === "set") {
  out({ ok: true, issueId: args[3], key: args[args.indexOf("--key") + 1] });
} else {
  console.error("unexpected command", args.join(" "));
  process.exit(1);
}
`);
    await writeFile(splitPath, JSON.stringify(sampleIssueSplit(), null, 2), "utf8");

    const rejected = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "plan",
        "apply-issues",
        "--issue-split",
        splitPath,
        "--cli-path",
        mockClient,
        "--execute",
        "--confirm",
        "wrong",
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /confirmation token required/);

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "plan",
        "apply-issues",
        "--issue-split",
        splitPath,
        "--cli-path",
        mockClient,
        "--audit-path",
        auditPath,
        "--execute",
        "--confirm",
        "APPLY-MULTICA-ISSUE-SPLIT",
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, "execute");
    assert.equal(payload.createdIssues[0].id, "issue-created");
    assert.equal(payload.operations[0].status, "executed");
    assert.ok(payload.operations.some((operation) => operation.type === "issue:metadata:set"));

    const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(calls[0].slice(0, 2), ["issue", "create"]);
    assert.ok(calls[0].includes("--description-file"));
    assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "metadata" && args[2] === "set"));

    const audit = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(audit.at(-1).status, "success");
    assert.equal(audit.at(-1).created_issue_ids[0], "issue-created");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function sampleIssueSplit() {
  return {
    id: "issue_split_sample",
    mode: "single",
    confirmationRequired: true,
    confirmationToken: "APPLY-MULTICA-ISSUE-SPLIT",
    summary: "Create one Multica issue after confirmation.",
    issues: [
      {
        id: "issue_preview_sample",
        title: "实现 Goal/Plan 拆分能力",
        description: "Goal: 把模糊需求整理成 locked Goal 和 Plan。\n\nPlan steps:\n- [ ] 锁定 Goal\n- [ ] 预览 issue split",
        priority: "medium",
        projectId: "project-1",
        metadata: {
          source: "multicaplusplus",
          goal_id: "goal-1",
          plan_id: "plan-1",
          split_mode: "single",
        },
      },
    ],
    operations: [],
  };
}

async function writeMockMulticaCli(dir, { planDraft, goalDraft }) {
  const path = join(dir, "mock-multica.js");
  await writeFile(path, `#!/usr/bin/env node
const args = process.argv.slice(2);
function out(value) { process.stdout.write(JSON.stringify(value)); }
if (args.join(" ") === "daemon status") {
  process.stdout.write("Daemon:      running (pid 1)\\nVersion:     0.3.17\\nAgents:      claude, codex\\n");
} else if (args.join(" ") === "runtime list --output json") {
  out([
    { id: "rt-lead", provider: "claude", name: "Claude Local", status: "online", runtime_mode: "local" },
    { id: "rt-worker", provider: "codex", name: "Codex Local", status: "online", runtime_mode: "local" }
  ]);
} else if (args.join(" ") === "agent list --output json") {
  out([
    { id: "agent-worker", name: "Codex Full Access Worker", description: "danger-full-access worker", model: "pa/gpt-5.5", status: "idle", runtime_id: "rt-worker", runtime_mode: "local" },
    { id: "agent-lead", name: "Claude-Lead", description: "planner architect leader", model: "pa/claude-opus", status: "idle", runtime_id: "rt-lead", runtime_mode: "local" }
  ]);
} else if (args[0] === "issue" && args[1] === "create") {
  const title = args[args.indexOf("--title") + 1] || "";
  const isGoal = title.includes("Goal clarification");
  out({ id: isGoal ? "issue-goal" : "issue-plan", identifier: isGoal ? "SPA-99" : "SPA-100", title, status: "todo", assignee_id: args[args.indexOf("--assignee-id") + 1], assignee_type: "agent" });
} else if (args.join(" ") === "issue runs issue-goal --output json") {
  const output = ${JSON.stringify(JSON.stringify(goalDraft))};
  out([{ id: "run-goal", status: "completed", agent_id: "agent-lead", runtime_id: "rt-lead", result: { output } }]);
} else if (args.join(" ") === "issue runs issue-plan --output json") {
  const output = ${JSON.stringify(JSON.stringify(planDraft))};
  out([{ id: "run-assist", status: "completed", agent_id: "agent-lead", runtime_id: "rt-lead", result: { output } }]);
} else {
  console.error("unexpected command", args.join(" "));
  process.exit(1);
}
`, "utf8");
  return path;
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
          {
            title: "Detect sanitized providers",
            description: "Check config paths and commands only.",
            dependencies: [],
            acceptanceEvidence: "Discovery output contains provider metadata and no secrets.",
          },
          {
            title: "Handle missing provider",
            description: "Return blocked no_llm_provider when no CLI is usable.",
            dependencies: [1],
            acceptanceEvidence: "CLI and GUI return blocked JSON.",
          },
        ],
        acceptanceEvidence: "Provider discovery tests pass.",
      },
      {
        title: "Plan set rendering",
        objective: "Render multiple parallel sub-plans and issue candidates.",
        workstream: { id: "plan-rendering", label: "Plan Rendering", reason: "Can proceed after draft contract." },
        suggestedAgent: "gui-agent",
        dependencies: [],
        steps: [
          {
            title: "Normalize sub-plan cards",
            description: "Add local ids, statuses, timestamps, and step numbers.",
            dependencies: [],
            acceptanceEvidence: "Each sub-plan has stable local ids.",
          },
          {
            title: "Preview one issue per sub-plan",
            description: "Generate preview-only issue candidates with plan_set metadata.",
            dependencies: [1],
            acceptanceEvidence: "Preview includes one candidate per sub-plan.",
          },
        ],
        acceptanceEvidence: "Plan set preview is visible in GUI.",
      },
    ],
    risks: ["LLM output can be unsafe"],
    questions: ["Which provider should be preferred?"],
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
