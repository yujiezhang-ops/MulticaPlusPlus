import { createHash } from "node:crypto";

import { buildCapabilityReview } from "../capability/index.js";
import { buildInstructionOverlay } from "../overlay/index.js";

export const schemaVersion = "multica.launch_review.v1";

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
    schemaVersion,
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

export function normalizeSkills(skills) {
  return skills.map((skill) => ({
    name: skill.name ?? "",
    version: skill.version ?? "",
    description: skill.description ?? "",
    permissions: Array.isArray(skill.permissions) ? skill.permissions.slice() : [],
    riskLevel: skill.riskLevel ?? skill.risk_level ?? "unknown",
  }));
}

export function normalizeRepos(repos) {
  return repos.map((repo) => (typeof repo === "string" ? { url: repo } : { url: repo.url ?? "" }));
}

export function normalizeMcpServers(servers) {
  if (Array.isArray(servers)) {
    return servers.slice().sort();
  }
  if (servers && typeof servers === "object") {
    return Object.keys(servers).sort();
  }
  return [];
}

export function normalizePermissions(permissions = {}) {
  return {
    tokenType: permissions.tokenType ?? "mat_task_scoped",
    ttlMinutes: permissions.ttlMinutes ?? 1440,
    scopes: Array.isArray(permissions.scopes) ? permissions.scopes.slice() : [],
  };
}

export function stableHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
