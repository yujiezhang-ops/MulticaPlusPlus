import { createMulticaClient } from "./multica-client.js";
import { buildRuntimeAgentSpec } from "./spec/index.js";

export async function buildRuntimeAgentSpecFromMultica({
  client = createMulticaClient(),
  issueId,
  agentId,
  createdAt,
  workspace = {},
  repos,
  permissions,
  plan,
} = {}) {
  const warnings = [];
  const errors = [];
  const issueResult = await readEnvelope(() => client.getIssue(issueId), "issue", warnings, errors);
  const issue = issueResult.data ?? {};
  const resolvedAgentId = agentId || (issue.assigneeType === "agent" ? issue.assigneeId : "");

  let agent = {};
  if (resolvedAgentId) {
    const agentResult = await readEnvelope(() => client.getAgent(resolvedAgentId), "agent", warnings, errors);
    agent = agentResult.data ?? {};
  } else {
    warnings.push("missing:agentId");
  }

  let runtime = {};
  if (agent.runtimeId) {
    const runtimeResult = await readEnvelope(() => client.getRuntime(agent.runtimeId), "runtime", warnings, errors);
    runtime = runtimeResult.data ?? {};
  }

  let skills = Array.isArray(agent.skills) ? agent.skills : [];
  if (resolvedAgentId) {
    const skillsResult = await readEnvelope(() => client.getSkills(resolvedAgentId), "skills", warnings, errors);
    if (skillsResult.data) {
      skills = skillsResult.data;
    }
  }

  const spec = buildRuntimeAgentSpec({
    createdAt,
    goal: issue.title ?? "",
    task: {
      kind: "issue_assignment",
      taskId: issue.id ?? issueId ?? "",
      issueId: issue.identifier || issue.id || issueId || "",
      prompt: issue.description ?? "",
      triggerPayload: {
        source: "multica",
        issue: {
          id: issue.id ?? "",
          identifier: issue.identifier ?? "",
          status: issue.status ?? "",
          priority: issue.priority ?? "",
          projectId: issue.projectId ?? "",
          workspaceId: issue.workspaceId ?? "",
          parentIssueId: issue.parentIssueId ?? "",
          metadata: issue.metadata ?? {},
          createdAt: issue.createdAt ?? "",
          updatedAt: issue.updatedAt ?? "",
        },
      },
    },
    workspace: {
      id: workspace.id ?? issue.workspaceId ?? "",
      name: workspace.name ?? "",
      context: workspace.context ?? "",
      repos: repos ?? workspace.repos ?? [],
    },
    agent: {
      id: agent.id ?? resolvedAgentId ?? "",
      name: agent.name ?? "",
      runtimeId: runtime.id || agent.runtimeId || "",
      provider: runtime.provider || agent.provider || "",
      model: runtime.model || agent.model || "",
      instructions: agent.instructions ?? "",
      skills,
      customEnv: envKeyMap(agent.env),
      mcpServers: agent.mcpServers ?? [],
    },
    permissions,
    plan,
  });

  return {
    spec,
    warnings,
    errors,
  };
}

async function readEnvelope(read, name, warnings, errors) {
  let result;
  try {
    result = await read();
  } catch (error) {
    errors.push(`${name}:${error.message || String(error)}`);
    return { data: null };
  }
  warnings.push(...(result.warnings ?? []));
  if (!result.ok) {
    errors.push(`${name}:${result.error ?? "unknown error"}`);
    return { data: null };
  }
  return result;
}

function envKeyMap(env) {
  if (!env || typeof env !== "object") {
    return {};
  }
  if (Array.isArray(env.keys)) {
    return Object.fromEntries(env.keys.map((key) => [key, ""]));
  }
  return {};
}
