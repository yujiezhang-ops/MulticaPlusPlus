import { spawn } from "node:child_process";

const DEFAULT_CONFIRMATION_TOKEN = "APPLY-MULTICA-AGENT-CONFIG";
const DEFAULT_WORKSPACE_NAME = "SparkProject";
const DEFAULT_PROJECT_TITLE = "MulticaPlusPlus";
const DEFAULT_SOURCE_AGENT_NAME = "Codex Full Access Worker";

export const agentConfigPresets = [
  {
    id: "planner",
    name: "Multica++ Planner Agent",
    role: "Goal and plan owner",
    description:
      "Multica++ GUI-first planner for turning a goal into a scoped plan, launch review, and permission preview.",
    skills: ["launch-review", "plan-ledger", "permission-preview"],
    scopes: ["workspace:read", "project:read", "issue:read", "issue:comment", "agent:read", "runtime:read"],
    guardrails: ["preview first", "human confirmation before writes", "do not print secrets"],
    maxConcurrentTasks: 2,
  },
  {
    id: "review",
    name: "Multica++ Review Agent",
    role: "Read-only reviewer",
    description:
      "Multica++ reviewer for checking goal, plan, and permission risk before applying agent setup.",
    skills: ["launch-review", "risk-summary", "records-check"],
    scopes: ["workspace:read", "project:read", "issue:read", "agent:read", "runtime:read"],
    guardrails: ["read-only by default", "short lease", "human confirmation before writes"],
    maxConcurrentTasks: 1,
  },
  {
    id: "incident",
    name: "Multica++ Incident Triage Agent",
    role: "Blocked run triage",
    description:
      "Multica++ triage agent for inspecting blocked plan steps and preparing recovery notes.",
    skills: ["activity-scan", "blocked-reason", "recovery-note"],
    scopes: ["workspace:read", "project:read", "issue:read", "agent:read", "runtime:read"],
    guardrails: ["time boxed", "no secret writes", "recovery notes only"],
    maxConcurrentTasks: 1,
  },
];

export async function discoverMulticaEnvironment({
  exec,
  cliPath = "multica",
  timeoutMs = 15000,
  workspaceName = DEFAULT_WORKSPACE_NAME,
  projectTitle = DEFAULT_PROJECT_TITLE,
  sourceAgentName = DEFAULT_SOURCE_AGENT_NAME,
  retries = 1,
} = {}) {
  const run = withRetry(exec ?? createDefaultExec({ cliPath, timeoutMs }), { retries });
  const warnings = [];

  const daemonResult = await readText(run, ["daemon", "status"]);
  const workspaceResult = await readJson(run, ["workspace", "list", "--output", "json"]);
  const projectResult = await readJson(run, ["project", "list", "--output", "json"]);
  const runtimeResult = await readJson(run, ["runtime", "list", "--output", "json"]);
  const agentResult = await readJson(run, ["agent", "list", "--output", "json"]);
  const skillResult = await readJson(run, ["skill", "list", "--output", "json"]);

  const failures = [
    daemonResult,
    workspaceResult,
    projectResult,
    runtimeResult,
    agentResult,
    skillResult,
  ].filter((result) => !result.ok);

  if (failures.length) {
    return {
      ok: false,
      error: failures.map((failure) => failure.error).join("; "),
      warnings,
      daemon: normalizeDaemon(daemonResult.stdout ?? ""),
      workspace: null,
      project: null,
      runtime: null,
      sourceAgent: null,
      agents: [],
      runtimes: [],
      skills: [],
    };
  }

  const workspaces = extractCollection(workspaceResult.data);
  const projects = extractCollection(projectResult.data);
  const runtimes = extractCollection(runtimeResult.data);
  const agents = extractCollection(agentResult.data);
  const skills = extractCollection(skillResult.data);

  const workspace = findByName(workspaces, workspaceName) ?? workspaces[0] ?? null;
  const project = findByTitle(projects, projectTitle) ?? projects[0] ?? null;
  const sourceAgent = findByName(agents, sourceAgentName) ?? findCodexAgent(agents) ?? agents[0] ?? null;
  const runtime = findRuntimeForAgent(runtimes, sourceAgent) ?? findOnlineCodexRuntime(runtimes) ?? runtimes[0] ?? null;

  if (!workspace) warnings.push("missing:workspace");
  if (!project) warnings.push("missing:project");
  if (!runtime) warnings.push("missing:runtime");
  if (!sourceAgent) warnings.push("missing:sourceAgent");

  return {
    ok: Boolean(workspace && runtime && sourceAgent),
    error: null,
    warnings,
    daemon: normalizeDaemon(daemonResult.stdout),
    workspace: workspace ? normalizeWorkspace(workspace) : null,
    project: project ? normalizeProject(project) : null,
    runtime: runtime ? normalizeRuntime(runtime) : null,
    sourceAgent: sourceAgent ? normalizeAgent(sourceAgent) : null,
    agents: agents.map(normalizeAgent),
    runtimes: runtimes.map(normalizeRuntime),
    skills: skills.map(normalizeSkill),
  };
}

export function buildAgentConfigPlan({
  environment,
  presetId = "planner",
  mode,
  createdAt = new Date().toISOString(),
  confirmationToken = DEFAULT_CONFIRMATION_TOKEN,
} = {}) {
  const preset = agentConfigPresets.find((item) => item.id === presetId) ?? agentConfigPresets[0];
  const warnings = [...(environment?.warnings ?? [])];

  if (!environment?.ok) {
    return {
      ok: false,
      error: environment?.error || "Multica environment is not ready",
      warnings,
      createdAt,
      preset,
      operations: [],
    };
  }

  const sourceAgent = normalizeAgent(environment.sourceAgent ?? {});
  const runtime = normalizeRuntime(environment.runtime ?? {});
  const targetAgent = findByName(environment.agents ?? [], preset.name);
  const planMode = mode ?? (targetAgent ? "update" : "create");
  const safeCustomArgs = hasSecretLikeCustomArgs(sourceAgent.customArgs) ? [] : sourceAgent.customArgs;
  if ((sourceAgent.customArgs.length && !safeCustomArgs.length) || sourceAgent.customArgsRedacted) {
    warnings.push("blocked:customArgsSecretLike");
  }
  const target = {
    id: targetAgent?.id ?? "",
    name: preset.name,
    description: preset.description,
    runtimeId: runtime.id,
    model: sourceAgent.model || runtime.model || "",
    visibility: sourceAgent.visibility || "private",
    maxConcurrentTasks: preset.maxConcurrentTasks,
    customArgs: safeCustomArgs,
    instructions: buildAgentInstructions({ preset, environment }),
  };

  const operations = [];
  if (planMode === "update") {
    operations.push(buildOperation({
      type: "agent:update",
      risk: "write",
      args: withOptionalCustomArgs([
        "agent",
        "update",
        targetAgent.id,
        "--name",
        target.name,
        "--description",
        target.description,
        "--instructions",
        target.instructions,
        "--runtime-id",
        target.runtimeId,
        "--model",
        target.model,
        "--max-concurrent-tasks",
        String(target.maxConcurrentTasks),
        "--visibility",
        target.visibility,
        "--output",
        "json",
      ], target.customArgs),
      summary: `Update existing Multica agent ${target.name}.`,
    }));
  } else {
    operations.push(buildOperation({
      type: "agent:create",
      risk: "write",
      args: withOptionalCustomArgs([
        "agent",
        "create",
        "--name",
        target.name,
        "--description",
        target.description,
        "--instructions",
        target.instructions,
        "--runtime-id",
        target.runtimeId,
        "--model",
        target.model,
        "--max-concurrent-tasks",
        String(target.maxConcurrentTasks),
        "--visibility",
        target.visibility,
        "--output",
        "json",
      ], target.customArgs),
      summary: `Create Multica agent ${target.name}.`,
    }));
  }

  const skillIds = resolveSkillIds(environment.skills ?? [], preset.skills);
  if (skillIds.length) {
    operations.push(buildOperation({
      type: "agent:skills:add",
      risk: "write",
      args: [
        "agent",
        "skills",
        "add",
        target.id || "__TARGET_AGENT_ID__",
        "--skill-ids",
        skillIds.join(","),
        "--output",
        "json",
      ],
      summary: `Assign ${skillIds.length} existing Multica skill(s) to ${target.name}.`,
      requiresTargetAgentId: true,
    }));
  } else if (preset.skills.length) {
    warnings.push(`missing:skills:${preset.skills.join(",")}`);
  }

  return {
    ok: true,
    error: null,
    createdAt,
    confirmationToken,
    mode: planMode,
    preset,
    target,
    environment: summarizeEnvironment(environment),
    operations,
    warnings,
    blockedOperations: [
      {
        type: "agent:env:set",
        reason:
          "Secret-bearing custom_env writes are intentionally excluded. Use multica agent env set --custom-env-file or --custom-env-stdin after human approval.",
      },
    ],
    summary: `${planMode === "update" ? "Update" : "Create"} ${target.name} on runtime ${target.runtimeId} with model ${target.model || "runtime default"}.`,
  };
}

export async function applyAgentConfigPlan({
  plan,
  exec,
  cliPath = "multica",
  timeoutMs = 30000,
  execute = false,
  confirm = "",
} = {}) {
  if (!plan?.ok) {
    throw new Error(plan?.error || "cannot apply an invalid agent configuration plan");
  }
  if (!execute) {
    return {
      ok: true,
      mode: "dry-run",
      targetAgentId: plan.target?.id ?? "",
      operations: plan.operations.map((operation) => ({
        type: operation.type,
        status: "planned",
        args: operation.args,
        displayCommand: operation.displayCommand,
        summary: operation.summary,
      })),
      warnings: plan.warnings ?? [],
    };
  }
  if (confirm !== plan.confirmationToken) {
    throw new Error(`confirmation token required: ${plan.confirmationToken}`);
  }

  const run = exec ?? createDefaultExec({ cliPath, timeoutMs });
  const results = [];
  let targetAgentId = plan.target?.id || "";

  for (const operation of plan.operations) {
    const args = operation.args.map((arg) => (arg === "__TARGET_AGENT_ID__" ? targetAgentId : arg));
    const result = await run(args);
    if (result.code !== 0) {
      results.push(formatExecutionResult(operation, args, result, "failed"));
      return {
        ok: false,
        mode: "execute",
        targetAgentId,
        operations: results,
        warnings: plan.warnings ?? [],
        error: result.stderr?.trim() || result.stdout?.trim() || `multica exited with code ${result.code}`,
      };
    }

    const parsed = parseJsonOrNull(result.stdout);
    if ((operation.type === "agent:create" || operation.type === "agent:update") && parsed?.id) {
      targetAgentId = parsed.id;
    }
    results.push({
      ...formatExecutionResult(operation, args, result, "executed"),
      data: redactExecutionData(parsed),
    });
  }

  return {
    ok: true,
    mode: "execute",
    targetAgentId,
    operations: results,
    warnings: plan.warnings ?? [],
  };
}

export function renderAgentConfigPlanMarkdown(plan) {
  if (!plan?.ok) {
    return `# Multica++ Agent Configuration Plan\n\nStatus: blocked\n\n${plan?.error || "No plan available."}\n`;
  }
  const lines = [
    "# Multica++ Agent Configuration Plan",
    "",
    `Created: ${plan.createdAt}`,
    `Mode: ${plan.mode}`,
    `Target: ${plan.target.name}`,
    `Runtime: ${plan.target.runtimeId}`,
    `Model: ${plan.target.model || "runtime default"}`,
    `Confirmation token: ${plan.confirmationToken}`,
    "",
    "## Environment",
    "",
    `- Workspace: ${plan.environment.workspaceName || ""} (${plan.environment.workspaceId || ""})`,
    `- Project: ${plan.environment.projectTitle || ""} (${plan.environment.projectId || ""})`,
    `- Source agent: ${plan.environment.sourceAgentName || ""} (${plan.environment.sourceAgentId || ""})`,
    `- Runtime: ${plan.environment.runtimeName || ""} (${plan.environment.runtimeId || ""})`,
    "",
    "## Operations",
    "",
  ];

  for (const operation of plan.operations) {
    lines.push(`- ${operation.summary}`);
    lines.push(`  - Risk: ${operation.risk}`);
    lines.push(`  - Command: \`${operation.displayCommand}\``);
  }

  if (plan.blockedOperations?.length) {
    lines.push("", "## Blocked By Design", "");
    for (const operation of plan.blockedOperations) {
      lines.push(`- ${operation.type}: ${operation.reason}`);
    }
  }
  if (plan.warnings?.length) {
    lines.push("", "## Warnings", "");
    for (const warning of plan.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function createDefaultExec({ cliPath, timeoutMs }) {
  return (args) => new Promise((resolve, reject) => {
    const command = cliPath.endsWith(".js") || cliPath.endsWith(".mjs") ? process.execPath : cliPath;
    const commandArgs = command === cliPath ? args : [cliPath, ...args];
    const child = spawn(command, commandArgs, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut ? `command timed out after ${timeoutMs}ms` : stderr,
        code: timedOut ? 124 : code,
      });
    });
  });
}

async function readText(exec, args) {
  try {
    const result = await exec(args);
    if (result.code !== 0) {
      return { ok: false, stdout: result.stdout, error: result.stderr?.trim() || result.stdout?.trim() };
    }
    return { ok: true, stdout: result.stdout, error: null };
  } catch (error) {
    return { ok: false, stdout: "", error: error.message || String(error) };
  }
}

async function readJson(exec, args) {
  const result = await readText(exec, args);
  if (!result.ok) return { ...result, data: null };
  try {
    return { ...result, data: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, stdout: result.stdout, data: null, error: `invalid json: ${error.message}` };
  }
}

function normalizeDaemon(stdout) {
  return {
    status: /Daemon:\s+running/i.test(stdout) ? "running" : "unknown",
    version: readLineValue(stdout, "Version"),
  };
}

function normalizeWorkspace(raw) {
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? ""),
    slug: String(raw?.slug ?? ""),
  };
}

function normalizeProject(raw) {
  return {
    id: String(raw?.id ?? ""),
    title: String(raw?.title ?? raw?.name ?? ""),
    workspaceId: String(raw?.workspace_id ?? raw?.workspaceId ?? ""),
  };
}

function normalizeRuntime(raw) {
  return {
    id: String(raw?.id ?? ""),
    provider: String(raw?.provider ?? ""),
    model: String(raw?.model ?? ""),
    name: String(raw?.name ?? ""),
    status: String(raw?.status ?? ""),
  };
}

function normalizeAgent(raw) {
  const customArgs = Array.isArray(raw?.custom_args) ? raw.custom_args.slice() : Array.isArray(raw?.customArgs) ? raw.customArgs.slice() : [];
  const customArgsRedacted = hasSecretLikeCustomArgs(customArgs);
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? ""),
    model: String(raw?.model ?? ""),
    runtimeId: String(raw?.runtime_id ?? raw?.runtimeId ?? ""),
    customArgs: customArgsRedacted ? [] : customArgs,
    customArgsRedacted,
    visibility: String(raw?.visibility ?? "private"),
    maxConcurrentTasks: Number(raw?.max_concurrent_tasks ?? raw?.maxConcurrentTasks ?? 1),
  };
}

function normalizeSkill(raw) {
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? ""),
    description: String(raw?.description ?? ""),
  };
}

function summarizeEnvironment(environment) {
  return {
    workspaceId: environment.workspace?.id ?? "",
    workspaceName: environment.workspace?.name ?? "",
    projectId: environment.project?.id ?? "",
    projectTitle: environment.project?.title ?? "",
    sourceAgentId: environment.sourceAgent?.id ?? "",
    sourceAgentName: environment.sourceAgent?.name ?? "",
    runtimeId: environment.runtime?.id ?? "",
    runtimeName: environment.runtime?.name ?? "",
  };
}

function buildAgentInstructions({ preset, environment }) {
  const projectTitle = environment.project?.title || DEFAULT_PROJECT_TITLE;
  const workspaceName = environment.workspace?.name || DEFAULT_WORKSPACE_NAME;
  return [
    `你是 ${projectTitle} 的 ${preset.name}。`,
    "",
    `职责: ${preset.role}。`,
    "",
    "工作边界:",
    `- 默认工作区: ${workspaceName}`,
    "- 优先生成 Goal、Plan 和权限预览，再等待人工确认。",
    "- 不打印、不复制、不外传 API key、token、cookie、OAuth code 或其他 secret。",
    "- 涉及权限、skills、系统级指令、schema 或协作边界的变更必须先记录并等待人工确认。",
    "",
    "Preset scopes:",
    ...preset.scopes.map((scope) => `- ${scope}`),
    "",
    "Guardrails:",
    ...preset.guardrails.map((guardrail) => `- ${guardrail}`),
  ].join("\n");
}

function buildOperation({ type, risk, args, summary, requiresTargetAgentId = false }) {
  return {
    type,
    risk,
    args,
    summary,
    requiresTargetAgentId,
    displayCommand: formatCommand(["multica", ...args]),
  };
}

function withOptionalCustomArgs(args, customArgs) {
  if (!customArgs.length) return args;
  const outputIndex = args.lastIndexOf("--output");
  if (outputIndex === -1) {
    return [...args, "--custom-args", JSON.stringify(customArgs)];
  }
  return [
    ...args.slice(0, outputIndex),
    "--custom-args",
    JSON.stringify(customArgs),
    ...args.slice(outputIndex),
  ];
}

function resolveSkillIds(skills, names) {
  const normalizedSkills = skills.map(normalizeSkill);
  return names
    .map((name) => normalizedSkills.find((skill) => skill.name === name)?.id)
    .filter(Boolean);
}

function extractCollection(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  for (const key of ["items", "data", "agents", "runtimes", "skills", "projects", "workspaces"]) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}

function findByName(items, name) {
  const lower = name.toLowerCase();
  return items.find((item) => String(item?.name ?? "").toLowerCase() === lower);
}

function findByTitle(items, title) {
  const lower = title.toLowerCase();
  return items.find((item) => String(item?.title ?? item?.name ?? "").toLowerCase() === lower);
}

function findCodexAgent(agents) {
  return agents.find((agent) => /codex/i.test(String(agent?.name ?? "")));
}

function findRuntimeForAgent(runtimes, agent) {
  const runtimeId = agent?.runtime_id ?? agent?.runtimeId;
  if (!runtimeId) return null;
  return runtimes.find((runtime) => runtime?.id === runtimeId) ?? null;
}

function findOnlineCodexRuntime(runtimes) {
  return runtimes.find((runtime) => (
    /codex/i.test(String(runtime?.provider ?? runtime?.name ?? ""))
    && String(runtime?.status ?? "").toLowerCase() !== "offline"
  ));
}

function readLineValue(stdout, label) {
  const line = stdout.split(/\r?\n/).find((item) => item.trim().startsWith(`${label}:`));
  return line ? line.split(":").slice(1).join(":").trim() : "";
}

function formatCommand(parts) {
  return parts.map(quoteArg).join(" ");
}

function quoteArg(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_./:=@,+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function parseJsonOrNull(stdout) {
  try {
    return stdout ? JSON.parse(stdout) : null;
  } catch {
    return null;
  }
}

function formatExecutionResult(operation, args, result, status) {
  return {
    type: operation.type,
    status,
    args,
    displayCommand: formatCommand(["multica", ...args]),
    summary: operation.summary,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    code: result.code,
  };
}

function redactExecutionData(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactExecutionData);
  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api_key|cookie|credential/i.test(key)) {
      redacted[key] = "[redacted]";
    } else if (item && typeof item === "object") {
      redacted[key] = redactExecutionData(item);
    } else {
      redacted[key] = item;
    }
  }
  return redacted;
}

function hasSecretLikeCustomArgs(args) {
  const joined = args.join(" ").toLowerCase();
  return /api[_-]?key|token|secret|password|credential|cookie/.test(joined);
}

function withRetry(exec, { retries }) {
  return async (args) => {
    let lastResult;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      lastResult = await exec(args);
      if (lastResult.code === 0 || !isTransientCliFailure(lastResult)) {
        return lastResult;
      }
    }
    return lastResult;
  };
}

function isTransientCliFailure(result) {
  const message = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  return /EOF|ECONNRESET|ETIMEDOUT|timeout|temporar/i.test(message);
}
