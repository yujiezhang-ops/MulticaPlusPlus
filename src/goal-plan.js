const DEFAULT_OWNER = "unassigned";
const DEFAULT_SOURCE = "manual";
const DEFAULT_PROJECT = "MulticaPlusPlus";
const ISSUE_CONFIRMATION_TOKEN = "APPLY-MULTICA-ISSUE-SPLIT";

import {
  invokeLlmForGoalClarification,
  invokeLlmForGoalPlanSplit,
  sanitizeProvider,
  validateLlmGoalDraft,
  validateLlmPlanSet,
} from "./llm-assist.js";
import {
  invokeMulticaAgentForGoalClarification,
  invokeMulticaAgentForPlanSplit,
  providerFromAssistAgent,
} from "./multica-agent-assist.js";

const AMBIGUOUS_REQUESTS = new Set([
  "做一下",
  "处理一下",
  "优化一下",
  "改一下",
  "看一下",
]);

export function normalizeGoal({
  request = "",
  context = {},
  language = context?.language,
  createdAt = new Date().toISOString(),
} = {}) {
  const cleanRequest = normalizeWhitespace(request);
  const normalizedLanguage = normalizeLanguage(language);
  const ambiguous = isAmbiguousRequest(cleanRequest);
  const status = ambiguous ? "draft" : "clarified";
  const project = context.project || DEFAULT_PROJECT;
  const title = ambiguous
    ? textForLanguage(normalizedLanguage, "goalNeedsClarification")
    : inferGoalTitle(cleanRequest, project, normalizedLanguage);

  return {
    id: stableId("goal", cleanRequest || title),
    createdAt,
    updatedAt: createdAt,
    status,
    language: normalizedLanguage,
    title,
    objective: ambiguous
      ? cleanRequest
      : inferObjective(cleanRequest, project, normalizedLanguage),
    owner: context.owner || DEFAULT_OWNER,
    source: context.source || DEFAULT_SOURCE,
    project,
    successCriteria: ambiguous ? [] : inferSuccessCriteria(cleanRequest, normalizedLanguage),
    scope: ambiguous ? { in: [], out: [] } : inferScope(cleanRequest, normalizedLanguage),
    constraints: inferConstraints(cleanRequest),
    risks: inferRisks(cleanRequest, normalizedLanguage),
    clarificationQuestions: ambiguous ? defaultClarificationQuestions(normalizedLanguage) : inferClarificationQuestions(cleanRequest, normalizedLanguage),
    confidence: ambiguous ? "low" : inferConfidence(cleanRequest),
    rawRequest: request,
  };
}

export async function normalizeGoalWithLlm({
  request = "",
  context = {},
  provider,
  language = context?.language,
  createdAt = new Date().toISOString(),
  invokeLlm = invokeLlmForGoalClarification,
} = {}) {
  const cleanRequest = normalizeWhitespace(request);
  const normalizedLanguage = normalizeLanguage(language);
  const safeProvider = sanitizeProvider(provider);
  const llmResult = await invokeLlm({
    provider: safeProvider,
    request,
    context: { ...context, language: normalizedLanguage },
    language: normalizedLanguage,
  });
  if (!llmResult?.ok) {
    return {
      ok: false,
      blocked: true,
      reason: llmResult?.reason || "llm_goal_clarification_failed",
      candidates: llmResult?.candidates ?? [],
      warnings: llmResult?.warnings ?? [],
      error: llmResult?.error,
      diagnostic: llmResult?.diagnostic,
    };
  }

  const validation = validateLlmGoalDraft(llmResult.goalDraft);
  if (!validation.ok) {
    return validation;
  }

  const draft = llmResult.goalDraft;
  const project = context.project || DEFAULT_PROJECT;
  const title = normalizeWhitespace(draft.title) || inferGoalTitle(cleanRequest, project, normalizedLanguage);
  return {
    id: stableId("goal", cleanRequest || title),
    createdAt,
    updatedAt: createdAt,
    status: draft.status,
    language: normalizedLanguage,
    title,
    objective: normalizeWhitespace(draft.objective),
    owner: context.owner || DEFAULT_OWNER,
    source: context.source || DEFAULT_SOURCE,
    project,
    successCriteria: normalizeStringArray(draft.successCriteria),
    scope: {
      in: normalizeStringArray(draft.scope?.in),
      out: normalizeStringArray(draft.scope?.out),
    },
    constraints: normalizeStringArray(draft.constraints),
    risks: normalizeStringArray(draft.risks),
    clarificationQuestions: normalizeStringArray(draft.clarificationQuestions),
    confidence: normalizeConfidenceValue(draft.confidence),
    rawRequest: request,
    warnings: validation.warnings,
    llm: {
      provider: safeProvider.kind,
      source: safeProvider.source,
      model: safeProvider.model || "",
    },
    ...(llmResult.assist ? { assist: llmResult.assist } : {}),
  };
}

export async function normalizeGoalWithAgent({
  request = "",
  context = {},
  agent,
  language = context?.language,
  createdAt = new Date().toISOString(),
  invokeAgent = invokeMulticaAgentForGoalClarification,
  cliPath,
  exec,
  timeoutMs,
  pollIntervalMs,
  sleep,
} = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  return normalizeGoalWithLlm({
    request,
    context: { ...context, language: normalizedLanguage },
    provider: providerFromAssistAgent(agent),
    language: normalizedLanguage,
    createdAt,
    invokeLlm: () => invokeAgent({
      agent,
      request,
      context: { ...context, language: normalizedLanguage },
      language: normalizedLanguage,
      cliPath,
      exec,
      timeoutMs,
      pollIntervalMs,
      sleep,
    }),
  });
}

export function lockGoalDraft(goal, {
  approvedBy = "human",
  lockedAt = new Date().toISOString(),
} = {}) {
  if (!goal || goal.status === "draft") {
    throw new Error("cannot lock goal in draft state");
  }
  return {
    ...goal,
    status: "locked",
    approvedBy,
    lockedAt,
    updatedAt: lockedAt,
  };
}

export function generatePlanFromGoal({
  goal,
  complexity = "medium",
  availableAgents = [],
  language = goal?.language,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!goal || goal.status !== "locked") {
    throw new Error("locked goal required before generating a plan");
  }
  const normalizedComplexity = normalizeComplexity(complexity);
  const normalizedLanguage = normalizeLanguage(language);
  const plannerAgent = findAgent(availableAgents, "planner") || findAgent(availableAgents, "plan") || "";
  const reviewerAgent = findAgent(availableAgents, "review") || "";
  const executorAgent = findAgent(availableAgents, "executor") || findAgent(availableAgents, "codex") || plannerAgent;
  const steps = buildPlanSteps({ goal, complexity: normalizedComplexity, plannerAgent, reviewerAgent, executorAgent, language: normalizedLanguage });

  return {
    id: stableId("plan", `${goal.id}:${normalizedComplexity}`),
    goalId: goal.id,
    createdAt,
    updatedAt: createdAt,
    status: "draft",
    language: normalizedLanguage,
    complexity: normalizedComplexity,
    steps,
    issueSplitRecommendation: recommendIssueSplit(normalizedComplexity),
    warnings: [],
  };
}

export async function splitGoalIntoPlansWithLlm({
  goal,
  provider,
  availableAgents = [],
  language = goal?.language,
  createdAt = new Date().toISOString(),
  invokeLlm = invokeLlmForGoalPlanSplit,
  constraints,
} = {}) {
  if (!goal || goal.status !== "locked") {
    throw new Error("locked goal required before splitting into plans");
  }
  const normalizedLanguage = normalizeLanguage(language);
  const safeProvider = sanitizeProvider(provider);
  const llmResult = await invokeLlm({
    provider: safeProvider,
    goal,
    constraints: constraints || defaultLlmSplitConstraints(goal),
    availableAgents,
    language: normalizedLanguage,
  });
  if (!llmResult?.ok) {
    return {
      ok: false,
      blocked: true,
      reason: llmResult?.reason || "llm_plan_split_failed",
      candidates: llmResult?.candidates ?? [],
      warnings: llmResult?.warnings ?? [],
      error: llmResult?.error,
      diagnostic: llmResult?.diagnostic,
    };
  }

  const validation = validateLlmPlanSet(llmResult.planSetDraft, goal);
  if (!validation.ok) {
    return validation;
  }

  return buildPlanSetFromDraft({
    goal,
    planSetDraft: llmResult.planSetDraft,
    provider: safeProvider,
    availableAgents,
    createdAt,
    language: normalizedLanguage,
    strategy: "llm-assisted-workstreams",
    warnings: validation.warnings,
    assist: llmResult.assist,
  });
}

export async function splitGoalIntoPlansWithAgent({
  goal,
  agent,
  availableAgents = [],
  language = goal?.language,
  createdAt = new Date().toISOString(),
  invokeAgent = invokeMulticaAgentForPlanSplit,
  constraints,
  cliPath,
  exec,
  timeoutMs,
  pollIntervalMs,
  sleep,
} = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  return splitGoalIntoPlansWithLlm({
    goal,
    provider: providerFromAssistAgent(agent),
    availableAgents,
    language: normalizedLanguage,
    createdAt,
    constraints,
    invokeLlm: () => invokeAgent({
      agent,
      goal,
      constraints: constraints || defaultLlmSplitConstraints(goal),
      availableAgents,
      language: normalizedLanguage,
      cliPath,
      exec,
      timeoutMs,
      pollIntervalMs,
      sleep,
    }),
  });
}

export function splitGoalIntoPlansDeterministic({
  goal,
  availableAgents = [],
  language = goal?.language,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!goal || goal.status !== "locked") {
    throw new Error("locked goal required before splitting into plans");
  }
  const plannerAgent = findAgent(availableAgents, "planner") || findAgent(availableAgents, "plan") || "";
  const executorAgent = findAgent(availableAgents, "executor") || findAgent(availableAgents, "codex") || plannerAgent;
  const reviewerAgent = findAgent(availableAgents, "review") || "";
  const normalizedLanguage = normalizeLanguage(language);
  const draft = {
    plans: normalizedLanguage === "en-US" ? [
      {
        title: "Goal/Plan core logic",
        objective: "Generate reviewable Goal to Plan split drafts with deterministic local rules.",
        workstream: { id: "goal-plan-core", label: "Core logic", reason: "Core business logic can be implemented and tested independently." },
        suggestedAgent: plannerAgent || executorAgent || "planner-agent",
        dependencies: [],
        steps: [
          {
            title: "Validate locked Goal",
            description: "Check goal status, scope, constraints, and success criteria, and reject draft Goals.",
            dependencies: [],
            acceptanceEvidence: "Locked Goal passes validation and draft Goal is blocked.",
          },
          {
            title: "Generate local PlanSet draft",
            description: "Use rules to create trusted local ids, status, steps, and acceptance evidence.",
            dependencies: [1],
            acceptanceEvidence: "PlanSet contains at least two parallel sub-plans.",
          },
        ],
        acceptanceEvidence: "Goal/Plan unit tests pass.",
      },
      {
        title: "Preview and verification loop",
        objective: "Prepare preview-first issue candidates and verification records for split sub-plans.",
        workstream: { id: "preview-verification", label: "Preview verification", reason: "Preview and verification can proceed independently from core generation details." },
        suggestedAgent: reviewerAgent || executorAgent || "review-agent",
        dependencies: [],
        steps: [
          {
            title: "Generate issue candidate preview",
            description: "Generate one candidate issue per sub-plan without calling the Multica CLI.",
            dependencies: [],
            acceptanceEvidence: "Issue split preview operations are shown as planned write commands.",
          },
          {
            title: "Record test and confirmation boundaries",
            description: "Keep preview-first and confirmation token mechanics; real writes still need separate confirmation.",
            dependencies: [1],
            acceptanceEvidence: "Tests prove deterministic split does not call an external LLM command.",
          },
        ],
        acceptanceEvidence: "CLI and GUI preview tests pass.",
      },
    ] : [
      {
        title: "Goal/Plan 核心逻辑",
        objective: "用确定性规则生成可审查的 Goal 到 Plan 拆分草案。",
        workstream: { id: "goal-plan-core", label: "核心逻辑", reason: "核心业务逻辑可独立实现和测试。" },
        suggestedAgent: plannerAgent || executorAgent || "planner-agent",
        dependencies: [],
        steps: [
          {
            title: "确认 locked Goal 合法性",
            description: "检查目标状态、范围、限制和成功标准，拒绝 draft Goal。",
            dependencies: [],
            acceptanceEvidence: "locked Goal 通过校验，draft Goal 被阻断。",
          },
          {
            title: "生成本地 PlanSet 草案",
            description: "用规则拆出本地可信 id、状态、步骤和验收证据。",
            dependencies: [1],
            acceptanceEvidence: "PlanSet 包含至少两个并行子 Plan。",
          },
        ],
        acceptanceEvidence: "Goal/Plan 单元测试通过。",
      },
      {
        title: "预览和验证闭环",
        objective: "为拆分出的子 Plan 准备 preview-first 的 issue 候选和验证记录。",
        workstream: { id: "preview-verification", label: "预览验证", reason: "预览和验证不需要等待核心生成细节。" },
        suggestedAgent: reviewerAgent || executorAgent || "review-agent",
        dependencies: [],
        steps: [
          {
            title: "生成 issue 候选预览",
            description: "每个子 Plan 生成一个候选 issue，不调用 Multica CLI。",
            dependencies: [],
            acceptanceEvidence: "Issue split preview 中 operations 均为 planned write 命令展示。",
          },
          {
            title: "记录测试和人工确认边界",
            description: "保留 preview-first 和 confirmation token 机制，真实写入仍需单独确认。",
            dependencies: [1],
            acceptanceEvidence: "测试证明 deterministic split 不调用外部 LLM 命令。",
          },
        ],
        acceptanceEvidence: "CLI 和 GUI 预览测试通过。",
      },
    ],
    risks: [],
    questions: [],
  };
  return buildPlanSetFromDraft({
    goal,
    planSetDraft: draft,
    provider: {
      id: "provider_deterministic",
      kind: "deterministic",
      command: "local-rules",
      source: "deterministic",
    },
    availableAgents,
    createdAt,
    language: normalizedLanguage,
    strategy: "deterministic-workstreams",
    warnings: [],
  });
}

export function previewIssueSplit({
  goal,
  plan,
  projectId = "",
  priority,
  language = plan?.language || goal?.language,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!goal || !plan) {
    throw new Error("goal and plan are required");
  }
  const normalizedLanguage = normalizeLanguage(language);
  const mode = recommendIssueSplit(plan.complexity);
  const issues = mode === "none"
    ? []
    : mode === "single"
      ? [buildIssuePreview({ goal, plan, projectId, priority: priority || "medium", language: normalizedLanguage, createdAt })]
      : buildMultiIssuePreview({ goal, plan, projectId, priority: priority || "medium", language: normalizedLanguage, createdAt });

  return {
    id: stableId("issue_split", `${goal.id}:${plan.id}:${mode}`),
    createdAt,
    language: normalizedLanguage,
    mode,
    confirmationRequired: issues.length > 0,
    confirmationToken: issues.length > 0 ? ISSUE_CONFIRMATION_TOKEN : "",
    summary: summarizeIssueSplit(mode, issues.length, normalizedLanguage),
    issues,
    operations: issues.map((issue) => ({
      type: "issue:create",
      risk: "write",
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      projectId: issue.projectId,
      metadata: issue.metadata,
      displayCommand: formatIssueCreateCommand(issue),
    })),
  };
}

export function previewIssueSplitFromPlanSet({
  goal,
  planSet,
  projectId = "",
  priority,
  language = planSet?.language || goal?.language,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!goal || !planSet) {
    throw new Error("goal and planSet are required");
  }
  const normalizedLanguage = normalizeLanguage(language);
  const issues = (planSet.plans ?? []).map((plan) => ({
    id: stableId("issue_preview", `${goal.id}:${planSet.id}:${plan.id}`),
    createdAt,
    title: `${goal.title} · ${plan.title}`,
    description: renderIssueDescription({ goal, steps: plan.steps, language: normalizedLanguage }),
    priority: priority || "medium",
    projectId,
    metadata: {
      source: "multicaplusplus",
      goal_id: goal.id,
      plan_set_id: planSet.id,
      subplan_id: plan.id,
      workstream_id: plan.workstream?.id ?? "",
      split_mode: "plan_set",
      provider_source: planSet.provider?.source ?? "",
    },
  }));

  return {
    id: stableId("issue_split", `${goal.id}:${planSet.id}:plan_set`),
    createdAt,
    language: normalizedLanguage,
    mode: "plan_set",
    confirmationRequired: issues.length > 0,
    confirmationToken: issues.length > 0 ? ISSUE_CONFIRMATION_TOKEN : "",
    summary: summarizePlanSetIssueSplit(issues.length, normalizedLanguage),
    issues,
    operations: issues.map((issue) => ({
      type: "issue:create",
      risk: "write",
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      projectId: issue.projectId,
      metadata: issue.metadata,
      displayCommand: formatIssueCreateCommand(issue),
    })),
  };
}

export async function applyIssueSplit({
  issueSplit,
  exec,
  execute = false,
  confirm = "",
  writeDescriptionFile,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!issueSplit) {
    throw new Error("issue split preview is required");
  }
  if (!execute) {
    return {
      ok: true,
      mode: "dry-run",
      createdAt,
      issueSplitId: issueSplit.id ?? "",
      createdIssues: [],
      operations: issueSplit.issues.map((issue) => ({
        type: "issue:create",
        status: "planned",
        title: issue.title,
        displayCommand: formatIssueCreateCommand(issue),
        metadata: issue.metadata ?? {},
      })),
      warnings: [],
    };
  }
  const token = issueSplit.confirmationToken || ISSUE_CONFIRMATION_TOKEN;
  if (confirm !== token) {
    throw new Error(`confirmation token required: ${token}`);
  }
  if (typeof exec !== "function") {
    throw new Error("exec function is required for issue split execution");
  }
  if (typeof writeDescriptionFile !== "function") {
    throw new Error("writeDescriptionFile function is required for issue split execution");
  }

  const operations = [];
  const createdIssues = [];
  for (let index = 0; index < issueSplit.issues.length; index += 1) {
    const issue = issueSplit.issues[index];
    const descriptionFile = await writeDescriptionFile(issue, index);
    const createArgs = buildIssueCreateArgs(issue, descriptionFile);
    const createResult = await exec(createArgs);
    const createOperation = formatCliOperation({
      type: "issue:create",
      status: createResult.code === 0 ? "executed" : "failed",
      args: createArgs,
      result: createResult,
      title: issue.title,
    });
    operations.push(createOperation);
    if (createResult.code !== 0) {
      return {
        ok: false,
        mode: "execute",
        createdAt,
        issueSplitId: issueSplit.id ?? "",
        createdIssues,
        operations,
        warnings: [],
        error: createResult.stderr?.trim() || createResult.stdout?.trim() || `multica exited with code ${createResult.code}`,
      };
    }

    const created = parseJsonOrNull(createResult.stdout) ?? {};
    const issueId = String(created.id ?? created.identifier ?? "");
    const createdIssue = {
      id: issueId,
      identifier: String(created.identifier ?? ""),
      title: String(created.title ?? issue.title),
    };
    createdIssues.push(createdIssue);

    for (const [key, value] of Object.entries(issue.metadata ?? {})) {
      const metadataArgs = [
        "issue",
        "metadata",
        "set",
        issueId,
        "--key",
        key,
        "--value",
        JSON.stringify(value),
        "--output",
        "json",
      ];
      const metadataResult = await exec(metadataArgs);
      operations.push(formatCliOperation({
        type: "issue:metadata:set",
        status: metadataResult.code === 0 ? "executed" : "failed",
        args: metadataArgs,
        result: metadataResult,
        title: `${issue.title}:${key}`,
      }));
      if (metadataResult.code !== 0) {
        return {
          ok: false,
          mode: "execute",
          createdAt,
          issueSplitId: issueSplit.id ?? "",
          createdIssues,
          operations,
          warnings: [],
          error: metadataResult.stderr?.trim() || metadataResult.stdout?.trim() || `multica exited with code ${metadataResult.code}`,
        };
      }
    }
  }

  return {
    ok: true,
    mode: "execute",
    createdAt,
    issueSplitId: issueSplit.id ?? "",
    createdIssues,
    operations,
    warnings: [],
  };
}

export function renderGoalPlanMarkdown({ goal, plan, issueSplit, language = issueSplit?.language || plan?.language || goal?.language } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const lines = normalizedLanguage === "en-US"
    ? ["# Multica++ Goal / Plan Preview", ""]
    : ["# Multica++ 目标 / 计划预览", ""];

  if (goal) {
    const successCriteria = Array.isArray(goal.successCriteria) ? goal.successCriteria : [];
    lines.push(...(normalizedLanguage === "en-US" ? [
      "## Goal",
      "",
      `- Status: ${goal.status}`,
      `- Title: ${goal.title}`,
      `- Objective: ${goal.objective}`,
      `- Owner: ${goal.owner}`,
      "",
      "### Success Criteria",
      "",
      ...(successCriteria.length ? successCriteria.map((item) => `- ${item}`) : ["- No success criteria yet."]),
      "",
    ] : [
      "## 目标",
      "",
      `- 状态：${goal.status}`,
      `- 标题：${goal.title}`,
      `- 目标：${goal.objective}`,
      `- 负责人：${goal.owner}`,
      "",
      "### 成功标准",
      "",
      ...(successCriteria.length ? successCriteria.map((item) => `- ${item}`) : ["- 暂无成功标准。"]),
      "",
    ]));
  }

  if (plan) {
    const subPlans = Array.isArray(plan.plans) ? plan.plans : [];
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    if (subPlans.length) {
      lines.push(...(normalizedLanguage === "en-US" ? [
        "## Parallel Plans",
        "",
        `- Status: ${plan.status}`,
        `- Split mode: ${plan.splitMode}`,
        "",
        ...subPlans.map((item) => `${item.number}. ${item.title} (${item.status})`),
        "",
      ] : [
        "## 并行计划",
        "",
        `- 状态：${plan.status}`,
        `- 拆分模式：${plan.splitMode}`,
        "",
        ...subPlans.map((item) => `${item.number}. ${item.title}（${item.status}）`),
        "",
      ]));
    } else {
      lines.push(...(normalizedLanguage === "en-US" ? [
        "## Plan",
        "",
        `- Status: ${plan.status}`,
        `- Complexity: ${plan.complexity}`,
        `- Issue split: ${plan.issueSplitRecommendation}`,
        "",
        ...steps.map((step) => `${step.number}. ${step.title} (${step.status})`),
        "",
      ] : [
        "## 计划",
        "",
        `- 状态：${plan.status}`,
        `- 复杂度：${plan.complexity}`,
        `- Issue 拆分：${plan.issueSplitRecommendation}`,
        "",
        ...steps.map((step) => `${step.number}. ${step.title}（${step.status}）`),
        "",
      ]));
    }
  }

  if (issueSplit) {
    const issues = Array.isArray(issueSplit.issues) ? issueSplit.issues : [];
    lines.push(...(normalizedLanguage === "en-US" ? [
      "## Issue Split Preview",
      "",
      `- Mode: ${issueSplit.mode}`,
      `- Confirmation required: ${issueSplit.confirmationRequired ? "yes" : "no"}`,
      "",
      ...(issues.length
        ? issues.map((issue) => `- ${issue.title} [${issue.priority}]`)
        : ["- No Multica issue will be created."]),
      "",
    ] : [
      "## Issue 拆分预览",
      "",
      `- 模式：${issueSplit.mode}`,
      `- 需要确认：${issueSplit.confirmationRequired ? "是" : "否"}`,
      "",
      ...(issues.length
        ? issueSplit.issues.map((issue) => `- ${issue.title} [${issue.priority}]`)
        : ["- 不会创建 Multica issue。"]),
      "",
    ]));
  }

  return `${lines.join("\n")}\n`;
}

function buildPlanSetFromDraft({
  goal,
  planSetDraft,
  provider,
  createdAt,
  language,
  strategy,
  warnings,
  assist,
}) {
  const normalizedLanguage = normalizeLanguage(language);
  const planSetId = stableId("plan_set", `${goal.id}:${strategy}:${createdAt}`);
  return {
    id: planSetId,
    goalId: goal.id,
    createdAt,
    updatedAt: createdAt,
    status: "draft",
    language: normalizedLanguage,
    splitMode: "parallel",
    strategy,
    provider: sanitizeProvider(provider),
    plans: planSetDraft.plans.map((plan, index) => normalizeSubPlan({
      plan,
      index,
      goal,
      planSetId,
      createdAt,
      language: normalizedLanguage,
    })),
    risks: Array.isArray(planSetDraft.risks) ? planSetDraft.risks.map(String) : [],
    questions: Array.isArray(planSetDraft.questions) ? planSetDraft.questions.map(String) : [],
    warnings: warnings ?? [],
    ...(assist ? { assist } : {}),
  };
}

function normalizeSubPlan({ plan, index, goal, planSetId, createdAt, language }) {
  const normalizedLanguage = normalizeLanguage(language);
  const number = index + 1;
  const workstreamId = normalizeWorkstreamId(plan.workstream?.id || plan.title || number);
  const id = stableId("subplan", `${goal.id}:${planSetId}:${number}:${workstreamId}:${plan.title}`);
  return {
    id,
    number,
    goalId: goal.id,
    planSetId,
    createdAt,
    updatedAt: createdAt,
    status: "draft",
    title: String(plan.title).trim(),
    objective: String(plan.objective).trim(),
    workstream: {
      id: workstreamId,
      label: String(plan.workstream?.label || plan.title).trim(),
      reason: String(plan.workstream?.reason || textForLanguage(normalizedLanguage, "independentWorkstreamReason")).trim(),
    },
    suggestedAgent: String(plan.suggestedAgent || "").trim(),
    dependencies: normalizeDependencies(plan.dependencies),
    steps: plan.steps.map((step, stepIndex) => ({
      id: stableId("plan_step", `${id}:${stepIndex + 1}:${step.title}`),
      number: stepIndex + 1,
      title: String(step.title).trim(),
      description: String(step.description).trim(),
      status: "pending",
      dependencies: normalizeDependencies(step.dependencies),
      suggestedAgent: String(step.suggestedAgent || plan.suggestedAgent || "").trim(),
      acceptanceEvidence: String(step.acceptanceEvidence).trim(),
      issueCandidate: true,
    })),
    acceptanceEvidence: String(plan.acceptanceEvidence).trim(),
    issueSplitRecommendation: "single",
  };
}

function defaultLlmSplitConstraints(goal) {
  return [
    "preview-first",
    "no silent Multica writes",
    "do not change schema or permission boundaries without explicit human confirmation",
    "do not expose secrets",
    ...((Array.isArray(goal?.constraints) ? goal.constraints : []).map(String)),
  ];
}

function buildPlanSteps({ goal, complexity, plannerAgent, reviewerAgent, executorAgent, language }) {
  const normalizedLanguage = normalizeLanguage(language);
  const base = normalizedLanguage === "en-US" ? [
    {
      title: "Lock Goal and acceptance criteria",
      description: "Confirm objective, scope, success criteria, constraints, and risks, producing a recoverable locked Goal.",
      suggestedAgent: plannerAgent,
      acceptanceEvidence: "Goal contains success criteria, scope boundaries, and approver.",
    },
    {
      title: "Split execution steps and dependencies",
      description: "Break the locked Goal into ordered steps with dependencies, current execution item, and blockers.",
      suggestedAgent: plannerAgent,
      acceptanceEvidence: "Plan steps include status, dependencies, and suggested executor.",
    },
    {
      title: "Preview Multica issue split",
      description: "Use complexity to decide no issue, one issue, or parent-child issues, and generate a write-before preview.",
      suggestedAgent: plannerAgent,
      acceptanceEvidence: "Issue split preview shows title, description, priority, and metadata.",
    },
  ] : [
    {
      title: "锁定 Goal 与验收标准",
      description: "确认目标、范围、成功标准、限制和风险，形成可恢复的 locked Goal。",
      suggestedAgent: plannerAgent,
      acceptanceEvidence: "Goal 已包含成功标准、范围边界和确认人。",
    },
    {
      title: "拆分执行步骤和依赖",
      description: "把 locked Goal 拆成有序步骤，标出依赖、当前执行项和阻塞条件。",
      suggestedAgent: plannerAgent,
      acceptanceEvidence: "Plan 步骤包含状态、依赖和建议执行者。",
    },
    {
      title: "预览 Multica issue 拆分",
      description: "根据复杂度判断不拆、单 issue 或父子 issue，并生成写入前预览。",
      suggestedAgent: plannerAgent,
      acceptanceEvidence: "Issue split preview 展示标题、描述、优先级和 metadata。",
    },
  ];
  const complex = complexity === "complex"
    ? normalizedLanguage === "en-US" ? [
      {
        title: "Assign independent workstreams",
        description: "Split parallelizable work, different permission boundaries, or different executors into independent candidate issues.",
        suggestedAgent: executorAgent,
        acceptanceEvidence: "Each candidate issue has an independent deliverable and acceptance evidence.",
      },
      {
        title: "Review risk and confirm write",
        description: "Review permissions, metadata, and dependencies before creating Multica issues.",
        suggestedAgent: reviewerAgent,
        acceptanceEvidence: "A human confirmation token is required before writes; without confirmation the Multica CLI is not called.",
      },
    ] : [
      {
        title: "分配独立工作流",
        description: "把可并行、不同权限边界或不同执行者的工作拆成独立候选 issue。",
        suggestedAgent: executorAgent,
        acceptanceEvidence: "每个候选 issue 都有独立交付物和验收说明。",
      },
      {
        title: "审查风险与确认写入",
        description: "在创建 Multica issue 前审查权限、metadata 和依赖关系。",
        suggestedAgent: reviewerAgent,
        acceptanceEvidence: "写入前需要人工确认 token，未确认不会调用 Multica CLI。",
      },
    ]
    : normalizedLanguage === "en-US" ? [
      {
        title: "Execute locally or prepare single issue",
        description: "Execute local changes from the Plan, or prepare one Multica issue for the main deliverable.",
        suggestedAgent: executorAgent,
        acceptanceEvidence: "Local verification passes, or the single issue preview is ready.",
      },
      {
        title: "Verify and record results",
        description: "Run tests and record the Goal/Plan/issue mapping plus follow-up actions.",
        suggestedAgent: reviewerAgent,
        acceptanceEvidence: "Test results and local records are reviewable.",
      },
    ] : [
      {
        title: "执行本地实现或准备单 issue",
        description: "按 Plan 执行本地变更，或准备一个 Multica issue 承载主要交付物。",
        suggestedAgent: executorAgent,
        acceptanceEvidence: "本地验证通过，或单 issue 预览已准备好。",
      },
      {
        title: "验证并记录结果",
        description: "运行测试、记录 Goal/Plan/issue 映射和后续动作。",
        suggestedAgent: reviewerAgent,
        acceptanceEvidence: "测试结果和本地记录可复盘。",
      },
    ];

  return [...base, ...complex].map((step, index) => ({
    id: stableId("plan_step", `${goal.id}:${index + 1}:${step.title}`),
    number: index + 1,
    title: step.title,
    description: step.description,
    status: "pending",
    dependencies: index === 0 ? [] : [index],
    suggestedAgent: step.suggestedAgent,
    acceptanceEvidence: step.acceptanceEvidence,
    issueCandidate: complexity !== "simple" && index >= 2,
  }));
}

function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "number") return item;
    return String(item).trim();
  }).filter((item) => item !== "");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeWhitespace(item)).filter(Boolean);
}

function normalizeConfidenceValue(value) {
  const confidence = String(value || "").toLowerCase();
  return ["low", "medium", "high"].includes(confidence) ? confidence : "medium";
}

function normalizeWorkstreamId(value) {
  return String(value || "workstream")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "workstream";
}

function buildIssuePreview({ goal, plan, projectId, priority, language, createdAt }) {
  const normalizedLanguage = normalizeLanguage(language);
  return {
    id: stableId("issue_preview", `${goal.id}:${plan.id}:single`),
    createdAt,
    title: goal.title,
    description: renderIssueDescription({ goal, steps: plan.steps, language: normalizedLanguage }),
    priority,
    projectId,
    metadata: {
      source: "multicaplusplus",
      goal_id: goal.id,
      plan_id: plan.id,
      split_mode: "single",
    },
  };
}

function buildIssueCreateArgs(issue, descriptionFile) {
  const args = [
    "issue",
    "create",
    "--title",
    issue.title,
    "--priority",
    issue.priority || "medium",
    "--description-file",
    descriptionFile,
    "--output",
    "json",
  ];
  if (issue.projectId) {
    args.push("--project", issue.projectId);
  }
  return args;
}

function buildMultiIssuePreview({ goal, plan, projectId, priority, language, createdAt }) {
  const normalizedLanguage = normalizeLanguage(language);
  const candidates = plan.steps.filter((step) => step.issueCandidate);
  const selected = candidates.length ? candidates : plan.steps.slice(0, 3);
  return selected.map((step) => ({
    id: stableId("issue_preview", `${goal.id}:${plan.id}:${step.id}`),
    createdAt,
    title: `${goal.title} · ${step.title}`,
    description: renderIssueDescription({ goal, steps: [step], language: normalizedLanguage }),
    priority: step.title.includes("风险") || step.title.includes("确认") ? "high" : priority,
    projectId,
    metadata: {
      source: "multicaplusplus",
      goal_id: goal.id,
      plan_id: plan.id,
      plan_step_id: step.id,
      split_mode: "multiple",
      depends_on_steps: step.dependencies,
    },
  }));
}

function renderIssueDescription({ goal, steps, language }) {
  const normalizedLanguage = normalizeLanguage(language);
  const lines = normalizedLanguage === "en-US" ? [
    `Goal: ${goal.objective}`,
    "",
    "Success criteria:",
    ...(goal.successCriteria.length ? goal.successCriteria.map((item) => `- ${item}`) : ["- Confirm with owner before execution."]),
    "",
    "Plan steps:",
    ...steps.map((step) => `- [ ] ${step.title}: ${step.description}`),
    "",
    "Boundary:",
    "- Created from Multica++ issue split preview.",
    "- Do not change permissions, skills, schema, or metadata without human confirmation.",
  ] : [
    `目标：${goal.objective}`,
    "",
    "成功标准：",
    ...(goal.successCriteria.length ? goal.successCriteria.map((item) => `- ${item}`) : ["- 执行前先与负责人确认。"]),
    "",
    "计划步骤：",
    ...steps.map((step) => `- [ ] ${step.title}：${step.description}`),
    "",
    "边界：",
    "- 由 Multica++ Issue 拆分预览生成。",
    "- 未经人工确认，不得修改权限、技能、schema 或 metadata。",
  ];
  return lines.join("\n");
}

function inferGoalTitle(request, project, language) {
  const normalizedLanguage = normalizeLanguage(language);
  if (normalizedLanguage === "en-US") {
    if (/一键配置|agent|智能体/i.test(request)) {
      return `Improve ${project} one-click Agent configuration`;
    }
    if (/goal|plan|目标|计划|issue/i.test(request)) {
      return `Implement ${project} Goal/Plan splitting`;
    }
    return `Clarify and deliver the current ${project} request`;
  }
  if (/一键配置|agent|智能体/i.test(request)) {
    return `完善 ${project} 的一键配置 Agent 能力`;
  }
  if (/goal|plan|目标|计划|issue/i.test(request)) {
    return `实现 ${project} 的 Goal/Plan 拆分能力`;
  }
  return `明确并交付 ${project} 当前需求`;
}

function inferObjective(request, project, language) {
  const normalizedLanguage = normalizeLanguage(language);
  if (normalizedLanguage === "en-US") {
    if (/一键配置|agent|智能体/i.test(request)) {
      return `Let team members turn fuzzy requests in ${project} into Goal, Plan, and confirmable Agent/issue configuration previews.`;
    }
    if (/goal|plan|目标|计划|issue/i.test(request)) {
      return `Build a local loop in ${project} from fuzzy request to locked Goal, Plan, and Multica issue split preview.`;
    }
    return `Turn the current request into an executable, verifiable, recoverable ${project} delivery goal.`;
  }
  if (/一键配置|agent|智能体/i.test(request)) {
    return `让团队成员可以在 ${project} 中把模糊需求整理成 Goal、Plan 和可确认的 Agent/issue 配置预览。`;
  }
  if (/goal|plan|目标|计划|issue/i.test(request)) {
    return `为 ${project} 建立从模糊需求到 locked Goal、Plan 和 Multica issue 拆分预览的本地闭环。`;
  }
  return `把当前需求整理为 ${project} 可执行、可验收、可恢复的交付目标。`;
}

function inferSuccessCriteria(request, language) {
  const normalizedLanguage = normalizeLanguage(language);
  const criteria = normalizedLanguage === "en-US" ? [
    "Users can enter a request in the GUI and receive a clear Goal",
    "Goal includes success criteria, scope boundaries, constraints, risks, and clarification questions",
    "Goal can enter locked status only after user confirmation",
    "Locked Goal can generate a Plan with dependencies and acceptance evidence",
    "Users can preview the Plan to Multica issue split recommendation",
    "No Multica issue or metadata is created before human confirmation",
  ] : [
    "用户可以从 GUI 输入需求并获得明确 Goal",
    "Goal 包含成功标准、范围边界、约束、风险和待澄清问题",
    "用户确认后 Goal 才能进入 locked 状态",
    "locked Goal 可以生成带依赖和验收证据的 Plan",
    "用户可以预览 Plan 到 Multica issue 的拆分建议",
    "未人工确认前不会创建 Multica issue 或写 metadata",
  ];
  if (/一键配置|agent|智能体/i.test(request)) {
    criteria.push(normalizedLanguage === "en-US"
      ? "Agent configuration suggestions remain preview-first and inherit team preset boundaries"
      : "Agent 配置建议保持 preview-first 并继承团队预制体边界");
  }
  return criteria;
}

function inferScope(request, language) {
  const normalizedLanguage = normalizeLanguage(language);
  const scopeIn = normalizedLanguage === "en-US" ? [
    "Goal normalization",
    "Goal locking",
    "Plan generation",
    "issue split preview",
    "local auditable record interface",
  ] : [
    "Goal 归一化",
    "Goal 锁定",
    "Plan 生成",
    "issue 拆分预览",
    "本地可审计记录接口",
  ];
  if (/一键配置|agent|智能体/i.test(request)) {
    scopeIn.push(normalizedLanguage === "en-US" ? "team preset suggestions" : "团队预制体建议");
  }
  return {
    in: scopeIn,
    out: normalizedLanguage === "en-US" ? [
      "Do not automatically create Multica issues",
      "Do not bypass human confirmation",
      "Do not replace the Multica issue board",
      "Do not modify the public Runtime Agent Spec schema",
      "Do not rely on extra LLM Agent automatic splitting",
    ] : [
      "不自动创建 Multica issue",
      "不绕过人工确认",
      "不替代 Multica issue board",
      "不修改公共 Runtime Agent Spec schema",
      "不依赖额外 LLM Agent 自动拆解",
    ],
  };
}

function inferConstraints(request) {
  const constraints = [
    "preview-first",
    "human-confirmation-before-write",
    "no-public-schema-breaking-change",
  ];
  if (/secret|key|token|权限|permission/i.test(request)) {
    constraints.push("do-not-log-secrets");
  }
  return constraints;
}

function inferRisks(request, language) {
  const normalizedLanguage = normalizeLanguage(language);
  const risks = normalizedLanguage === "en-US" ? [
    "Fuzzy goals may cause plan drift",
    "Over-splitting issues may increase collaboration cost",
    "Multica writes must never execute silently",
  ] : [
    "模糊目标可能导致计划漂移",
    "过度拆分 issue 会增加协作成本",
    "Multica 写入动作必须避免静默执行",
  ];
  if (/权限|permission|agent|智能体/i.test(request)) {
    risks.push(normalizedLanguage === "en-US"
      ? "Permission configuration must preserve approval and TTL boundaries"
      : "权限配置必须保留审批和 TTL 边界");
  }
  return risks;
}

function inferClarificationQuestions(request, language) {
  const normalizedLanguage = normalizeLanguage(language);
  const questions = [];
  if (!/验收|成功|完成|测试|通过/.test(request)) {
    questions.push(normalizedLanguage === "en-US"
      ? "What is the minimum acceptance standard for this goal?"
      : "这个目标的最小验收标准是什么？");
  }
  if (!/不|边界|范围|只|先/.test(request)) {
    questions.push(normalizedLanguage === "en-US"
      ? "What is explicitly out of scope for this round?"
      : "哪些内容明确不在本轮范围内？");
  }
  return questions;
}

function defaultClarificationQuestions(language) {
  return normalizeLanguage(language) === "en-US" ? [
    "What concrete deliverable should be completed?",
    "What standard will be used to accept completion?",
    "What should not be modified or created in this round?",
  ] : [
    "具体要完成什么可交付结果？",
    "完成后用什么标准验收？",
    "本轮哪些内容不应该修改或创建？",
  ];
}

function inferConfidence(request) {
  if (request.length > 80 || /验收|成功|范围|不|先|issue|agent|Goal|Plan/i.test(request)) {
    return "medium";
  }
  return "low";
}

function recommendIssueSplit(complexity) {
  if (complexity === "simple") return "none";
  if (complexity === "complex") return "multiple";
  return "single";
}

function normalizeComplexity(value) {
  if (["simple", "medium", "complex"].includes(value)) return value;
  return "medium";
}

function findAgent(agents, role) {
  const match = agents.find((agent) => {
    const text = `${agent.id ?? ""} ${agent.name ?? ""} ${agent.role ?? ""}`.toLowerCase();
    return text.includes(role.toLowerCase());
  });
  return match?.id || match?.name || "";
}

function isAmbiguousRequest(request) {
  if (!request) return true;
  if (AMBIGUOUS_REQUESTS.has(request)) return true;
  return request.length < 8 && !/[A-Za-z]/.test(request);
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableId(prefix, value) {
  let hash = 2166136261;
  const input = String(value || prefix);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function summarizeIssueSplit(mode, count, language) {
  if (normalizeLanguage(language) === "zh-CN") {
    if (mode === "none") return "这个小型本地任务不需要创建 Multica issue。";
    if (mode === "single") return "确认后为主要交付物创建 1 个 Multica issue。";
    return `确认后为独立工作流创建 ${count} 个 Multica issue。`;
  }
  if (mode === "none") return "No Multica issue is needed for this small local task.";
  if (mode === "single") return "Create one Multica issue for the main deliverable after confirmation.";
  return `Create ${count} Multica issues for independent workstreams after confirmation.`;
}

function summarizePlanSetIssueSplit(count, language) {
  return normalizeLanguage(language) === "en-US"
    ? `Create ${count} Multica issues for Agent-assisted parallel sub-plans after confirmation.`
    : `确认后为 Agent 辅助生成的并行子 Plan 创建 ${count} 个 Multica issue。`;
}

function normalizeLanguage(language) {
  return String(language || "zh-CN").toLowerCase() === "en-us" ? "en-US" : "zh-CN";
}

function textForLanguage(language, key) {
  const normalizedLanguage = normalizeLanguage(language);
  const text = {
    goalNeedsClarification: {
      "zh-CN": "待澄清目标",
      "en-US": "Goal needs clarification",
    },
    independentWorkstreamReason: {
      "zh-CN": "Agent 辅助生成的独立工作流。",
      "en-US": "Agent-assisted independent workstream.",
    },
  };
  return text[key]?.[normalizedLanguage] ?? text[key]?.["zh-CN"] ?? "";
}

function formatIssueCreateCommand(issue) {
  const parts = ["multica", "issue", "create", "--title", issue.title, "--priority", issue.priority || "medium"];
  if (issue.projectId) {
    parts.push("--project", issue.projectId);
  }
  parts.push("--description-file", "__GENERATED_DESCRIPTION_FILE__");
  return parts.map(quoteArg).join(" ");
}

function quoteArg(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_./:=@,+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function formatCliOperation({ type, status, args, result, title }) {
  return {
    type,
    status,
    title,
    args,
    displayCommand: ["multica", ...args].map(quoteArg).join(" "),
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    code: result.code,
  };
}

function parseJsonOrNull(stdout) {
  try {
    return stdout ? JSON.parse(stdout) : null;
  } catch {
    return null;
  }
}
