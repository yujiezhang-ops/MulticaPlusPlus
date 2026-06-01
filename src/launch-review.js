import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SECRET_ENV_PATTERNS = [
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASS",
  "API_KEY",
  "ACCESS_KEY",
  "PRIVATE_KEY",
  "CREDENTIAL",
];

const ALLOWED_LEDGER_TRANSITIONS = {
  draft: new Set(["locked"]),
  locked: new Set(["running"]),
  running: new Set(["completed", "amended"]),
  amended: new Set(["locked"]),
  completed: new Set([]),
};

export function buildRuntimeAgentSpec(input) {
  const now = input.createdAt ?? new Date().toISOString();
  const workspace = input.workspace ?? {};
  const agent = input.agent ?? {};
  const task = input.task ?? {};
  const skills = normalizeSkills(agent.skills ?? input.skills ?? []);
  const repos = normalizeRepos(input.repos ?? workspace.repos ?? []);
  const env = agent.customEnv ?? input.customEnv ?? {};
  const mcpServers = normalizeMcpServers(agent.mcpServers ?? input.mcpServers ?? []);
  const permissions = normalizePermissions(input.permissions);
  const instructionOverlay = buildInstructionOverlay({
    workspace,
    agent,
    task,
  });
  const capabilityReview = buildCapabilityReview({
    skills,
    repos,
    env,
    mcpServers,
    permissions,
  });
  const draft = {
    schemaVersion: "multica.launch_review.v1",
    specId: "",
    status: "draft",
    createdAt: now,
    goal: input.goal ?? task.prompt ?? "",
    workspace: {
      id: workspace.id ?? "",
      name: workspace.name ?? "",
      repos,
    },
    task: {
      kind: task.kind ?? "issue_assignment",
      taskId: task.taskId ?? "",
      issueId: task.issueId ?? "",
      triggerCommentId: task.triggerCommentId ?? "",
      triggerComment: task.triggerComment ?? "",
      prompt: task.prompt ?? "",
      autopilotId: task.autopilotId ?? "",
      autopilotRunId: task.autopilotRunId ?? "",
      autopilotSource: task.autopilotSource ?? "",
      triggerPayload: task.triggerPayload ?? null,
    },
    agent: {
      id: agent.id ?? "",
      name: agent.name ?? "",
    },
    runtime: {
      runtimeId: agent.runtimeId ?? input.runtimeId ?? "",
      provider: agent.provider ?? input.provider ?? "",
      model: agent.model ?? input.model ?? "",
    },
    skills,
    instructionOverlay,
    capabilityReview,
    permissions,
    initialPlan: Array.isArray(input.plan) ? input.plan.slice() : [],
  };

  draft.specId = `ras_${stableHash(draft).slice(0, 16)}`;
  return draft;
}

export function renderLaunchReviewMarkdown(spec) {
  const lines = [
    `# Launch Review: ${spec.goal || spec.specId}`,
    "",
    "## Runtime Agent Spec",
    "",
    `- Spec ID: \`${spec.specId}\``,
    `- Status: \`${spec.status}\``,
    `- Task kind: \`${spec.task.kind}\``,
    `- Workspace: ${spec.workspace.name || "(unnamed)"} (\`${spec.workspace.id}\`)`,
    `- Agent: ${spec.agent.name || "(unnamed)"} (\`${spec.agent.id}\`)`,
    `- Runtime: \`${spec.runtime.runtimeId}\` / \`${spec.runtime.provider}\` / \`${spec.runtime.model || "provider-default"}\``,
    "",
  ];

  if (spec.task.issueId) {
    lines.push(`- Issue: \`${spec.task.issueId}\``);
  }
  if (spec.task.triggerCommentId) {
    lines.push(`- Trigger comment: \`${spec.task.triggerCommentId}\``);
    if (spec.task.triggerComment) {
      lines.push(`- Trigger text: ${spec.task.triggerComment}`);
    }
  }
  if (spec.task.autopilotId) {
    lines.push(`- Autopilot: \`${spec.task.autopilotId}\``);
  }
  if (spec.task.autopilotRunId) {
    lines.push(`- Autopilot run: \`${spec.task.autopilotRunId}\``);
  }
  if (spec.task.autopilotSource) {
    lines.push(`- Autopilot source: \`${spec.task.autopilotSource}\``);
  }
  if (spec.task.triggerPayload) {
    lines.push("", "```json", JSON.stringify(spec.task.triggerPayload, null, 2), "```");
  }

  lines.push(
    "",
    "## Skills",
    "",
    ...(spec.skills.length
      ? spec.skills.map((skill) => `- ${skill.name} (${skill.version || "unversioned"}, risk: ${skill.riskLevel})`)
      : ["- None declared"]),
    "",
    "## Instruction Overlay Diff",
    "",
    "```diff",
    spec.instructionOverlay.diff || "(no instruction overlay)",
    "```",
    "",
    "## Capability And Permission Review",
    "",
    `- Token type: \`${spec.permissions.tokenType}\``,
    `- TTL minutes: \`${spec.permissions.ttlMinutes}\``,
    `- Scopes: ${spec.permissions.scopes.length ? spec.permissions.scopes.map((scope) => `\`${scope}\``).join(", ") : "none"}`,
    `- Repos: ${spec.capabilityReview.repos.length ? spec.capabilityReview.repos.map((repo) => `\`${repo.url}\``).join(", ") : "none"}`,
    `- Env keys: ${spec.capabilityReview.envKeys.length ? spec.capabilityReview.envKeys.map((key) => `\`${key}\``).join(", ") : "none"}`,
    `- Secret env keys: ${spec.capabilityReview.secretEnvKeys.length ? spec.capabilityReview.secretEnvKeys.map((key) => `\`${key}\``).join(", ") : "none"}`,
    `- MCP servers: ${spec.capabilityReview.mcpServers.length ? spec.capabilityReview.mcpServers.map((server) => `\`${server}\``).join(", ") : "none"}`,
    "",
    "### Risk Flags",
    "",
    ...(spec.capabilityReview.riskFlags.length
      ? spec.capabilityReview.riskFlags.map((flag) => `- \`${flag}\``)
      : ["- None"]),
    "",
    "## Initial Plan",
    "",
    ...(spec.initialPlan.length
      ? spec.initialPlan.map((item, index) => `${index + 1}. ${item}`)
      : ["1. No initial plan supplied."]),
    "",
  );

  return lines.join("\n");
}

export function createLedgerStore(filePath) {
  async function append(event) {
    await mkdir(dirname(filePath), { recursive: true });
    const current = await readLedgerText(filePath);
    await writeFile(filePath, current + JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  async function latest(specId) {
    const events = await readLedgerEvents(filePath);
    return events.filter((event) => event.specId === specId).at(-1) ?? null;
  }

  async function transition(specId, nextStatus, extra = {}) {
    const current = await latest(specId);
    if (!current) {
      throw new Error(`spec not found in ledger: ${specId}`);
    }
    assertTransition(current.status, nextStatus);
    return append({
      eventId: `lge_${stableHash({ specId, nextStatus, extra, at: Date.now() }).slice(0, 16)}`,
      specId,
      status: nextStatus,
      createdAt: new Date().toISOString(),
      ...extra,
    });
  }

  return {
    async recordDraft(spec) {
      if (spec.status !== "draft") {
        throw new Error(`recordDraft requires draft spec, got ${spec.status}`);
      }
      return append({
        eventId: `lge_${stableHash({ specId: spec.specId, status: "draft" }).slice(0, 16)}`,
        specId: spec.specId,
        status: "draft",
        createdAt: new Date().toISOString(),
        spec,
      });
    },
    lock(specId, approvedBy) {
      return transition(specId, "locked", { approvedBy });
    },
    markRunning(specId) {
      return transition(specId, "running");
    },
    complete(specId, result) {
      return transition(specId, "completed", { result });
    },
    async list(specId) {
      const events = await readLedgerEvents(filePath);
      return specId ? events.filter((event) => event.specId === specId) : events;
    },
  };
}

function buildInstructionOverlay({ workspace, agent, task }) {
  const sections = [];
  if (workspace.context) {
    sections.push(["Workspace Context", workspace.context]);
  }
  if (agent.instructions) {
    sections.push(["Agent Instructions", agent.instructions]);
  }
  if (task.prompt) {
    sections.push(["Task Prompt", task.prompt]);
  }
  if (task.triggerComment) {
    sections.push(["Trigger Comment", task.triggerComment]);
  }
  if (task.autopilotId || task.autopilotRunId || task.autopilotSource) {
    sections.push([
      "Autopilot Context",
      [
        task.autopilotId ? `autopilot_id=${task.autopilotId}` : "",
        task.autopilotRunId ? `autopilot_run_id=${task.autopilotRunId}` : "",
        task.autopilotSource ? `source=${task.autopilotSource}` : "",
      ].filter(Boolean).join("\n"),
    ]);
  }

  const diff = sections
    .flatMap(([heading, body]) => [
      `+ ${heading}`,
      ...String(body).split(/\r?\n/).map((line) => `+ ${line}`),
    ])
    .join("\n");

  return {
    reviewStatus: "pending",
    layers: sections.map(([name, content]) => ({ name, content })),
    diff,
  };
}

function buildCapabilityReview({ skills, repos, env, mcpServers, permissions }) {
  const envKeys = Object.keys(env).sort();
  const secretEnvKeys = envKeys.filter(isSecretEnvKey);
  const riskFlags = [];

  for (const skill of skills) {
    if (skill.riskLevel === "high" || skill.riskLevel === "critical") {
      riskFlags.push(`${skill.riskLevel}_risk_skill:${skill.name}`);
    }
  }
  for (const key of secretEnvKeys) {
    riskFlags.push(`secret_env:${key}`);
  }
  for (const server of mcpServers) {
    riskFlags.push(`mcp_enabled:${server}`);
  }
  if (permissions.scopes.includes("repo:write")) {
    riskFlags.push("repo_write_scope");
  }
  for (const skill of skills) {
    if (skill.permissions.includes("shell:write")) {
      riskFlags.push(`shell_write_skill:${skill.name}`);
    }
  }

  return {
    repos,
    envKeys,
    secretEnvKeys,
    mcpServers,
    riskFlags,
  };
}

function normalizeSkills(skills) {
  return skills.map((skill) => ({
    name: skill.name ?? "",
    version: skill.version ?? "",
    description: skill.description ?? "",
    permissions: Array.isArray(skill.permissions) ? skill.permissions.slice() : [],
    riskLevel: skill.riskLevel ?? skill.risk_level ?? "unknown",
  }));
}

function normalizeRepos(repos) {
  return repos.map((repo) => (typeof repo === "string" ? { url: repo } : { url: repo.url ?? "" }));
}

function normalizeMcpServers(servers) {
  if (Array.isArray(servers)) {
    return servers.slice().sort();
  }
  if (servers && typeof servers === "object") {
    return Object.keys(servers).sort();
  }
  return [];
}

function normalizePermissions(permissions = {}) {
  return {
    tokenType: permissions.tokenType ?? "mat_task_scoped",
    ttlMinutes: permissions.ttlMinutes ?? 1440,
    scopes: Array.isArray(permissions.scopes) ? permissions.scopes.slice() : [],
  };
}

function isSecretEnvKey(key) {
  const upper = key.toUpperCase();
  return SECRET_ENV_PATTERNS.some((pattern) => upper.includes(pattern));
}

function assertTransition(current, next) {
  const allowed = ALLOWED_LEDGER_TRANSITIONS[current];
  if (!allowed?.has(next)) {
    throw new Error(`invalid ledger transition: ${current} -> ${next}`);
  }
}

async function readLedgerText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readLedgerEvents(filePath) {
  const text = await readLedgerText(filePath);
  return text.trim() === ""
    ? []
    : text.trim().split("\n").map((line) => JSON.parse(line));
}

function stableHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
