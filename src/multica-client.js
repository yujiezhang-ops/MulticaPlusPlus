import { spawn } from "node:child_process";

import { SECRET_ENV_PATTERNS } from "./launch-review.js";

export function createMulticaClient({ exec, cliPath = "multica", timeoutMs = 15000 } = {}) {
  const run = exec ?? createDefaultExec({ cliPath, timeoutMs });

  return {
    getIssue(issueId) {
      return readJson(run, ["issue", "get", issueId, "--output", "json"], (raw, warnings) => (
        normalizeIssue(raw, warnings)
      ));
    },
    getAgent(agentId) {
      return readJson(run, ["agent", "get", agentId, "--output", "json"], (raw, warnings) => (
        normalizeAgent(raw, warnings)
      ));
    },
    getRuntime(runtimeId) {
      return readJson(run, ["runtime", "list", "--output", "json"], (raw, warnings) => {
        const runtimes = extractCollection(raw, ["runtimes", "items", "data"]);
        const runtime = runtimes.find((item) => item?.id === runtimeId || item?.runtime_id === runtimeId);
        if (!runtime) {
          warnings.push("missing:runtime");
        }
        return normalizeRuntime(runtime ?? {}, warnings);
      });
    },
    getSkills(agentId) {
      return readJson(run, ["agent", "skills", "list", agentId, "--output", "json"], (raw, warnings) => (
        extractCollection(raw, ["skills", "items", "data"]).map((skill, index) => (
          normalizeSkill(unwrapSkill(skill), warnings, `skills.${index}`)
        ))
      ));
    },
  };
}

function createDefaultExec({ cliPath, timeoutMs }) {
  return (args) => new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, { windowsHide: true });
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

async function readJson(exec, args, normalize) {
  let result;
  try {
    result = await exec(args);
  } catch (error) {
    return hardFailure(error.message || String(error));
  }

  if (result.code !== 0) {
    return hardFailure(result.stderr?.trim() || result.stdout?.trim() || `multica exited with code ${result.code}`);
  }

  let raw;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    return hardFailure(`invalid json: ${error.message}`);
  }

  const warnings = [];
  return {
    ok: true,
    data: normalize(raw, warnings),
    warnings,
    error: null,
  };
}

function hardFailure(error) {
  return {
    ok: false,
    data: null,
    warnings: [],
    error,
  };
}

function normalizeIssue(raw, warnings) {
  return {
    id: readString(raw, ["id"], "issue.id", warnings),
    identifier: readString(raw, ["identifier", "key"], "issue.identifier", warnings),
    number: readValue(raw, ["number"], "issue.number", warnings, ""),
    title: readString(raw, ["title"], "issue.title", warnings),
    description: readString(raw, ["description"], "issue.description", warnings),
    status: readString(raw, ["status"], "issue.status", warnings),
    priority: readString(raw, ["priority"], "issue.priority", warnings),
    assigneeId: readString(raw, ["assigneeId", "assignee_id"], "issue.assigneeId", warnings),
    assigneeType: readString(raw, ["assigneeType", "assignee_type"], "issue.assigneeType", warnings),
    parentIssueId: readString(raw, ["parentIssueId", "parent_issue_id"], "issue.parentIssueId", warnings),
    projectId: readString(raw, ["projectId", "project_id"], "issue.projectId", warnings),
    workspaceId: readString(raw, ["workspaceId", "workspace_id"], "issue.workspaceId", warnings),
    labels: readArray(raw, ["labels"], "issue.labels", warnings),
    metadata: readObject(raw, ["metadata"], "issue.metadata", warnings),
    createdAt: readString(raw, ["createdAt", "created_at"], "issue.createdAt", warnings),
    updatedAt: readString(raw, ["updatedAt", "updated_at"], "issue.updatedAt", warnings),
  };
}

function normalizeAgent(raw, warnings) {
  return {
    id: readString(raw, ["id"], "agent.id", warnings),
    name: readString(raw, ["name"], "agent.name", warnings),
    provider: readString(raw, ["provider"], "agent.provider", warnings),
    model: readString(raw, ["model"], "agent.model", warnings),
    runtimeId: readString(raw, ["runtimeId", "runtime_id"], "agent.runtimeId", warnings),
    instructions: readString(raw, ["instructions"], "agent.instructions", warnings),
    skills: readArray(raw, ["skills"], "agent.skills", warnings).map((skill, index) => (
      normalizeSkill(unwrapSkill(skill), warnings, `agent.skills.${index}`)
    )),
    env: normalizeEnv(readObject(raw, ["customEnv", "custom_env", "env"], "agent.env", warnings)),
    mcpServers: normalizeMcpServers(readValue(raw, ["mcpServers", "mcp_servers"], "agent.mcpServers", warnings, [])),
  };
}

function normalizeRuntime(raw, warnings) {
  return {
    id: readString(raw, ["id", "runtime_id", "runtimeId"], "runtime.id", warnings),
    provider: readString(raw, ["provider"], "runtime.provider", warnings),
    model: readString(raw, ["model"], "runtime.model", warnings),
    name: readString(raw, ["name"], "runtime.name", warnings),
  };
}

function normalizeSkill(raw, warnings, path) {
  return {
    name: readString(raw, ["name"], `${path}.name`, warnings),
    version: readString(raw, ["version"], `${path}.version`, warnings),
    description: readString(raw, ["description"], `${path}.description`, warnings),
    permissions: readArray(raw, ["permissions"], `${path}.permissions`, warnings),
    riskLevel: readString(raw, ["riskLevel", "risk_level"], `${path}.riskLevel`, warnings),
  };
}

function normalizeEnv(env) {
  const keys = Object.keys(env).sort();
  return {
    keys,
    secretKeys: keys.filter(isSecretEnvKey),
  };
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

function unwrapSkill(value) {
  if (value?.skill && typeof value.skill === "object") {
    return value.skill;
  }
  return value ?? {};
}

function extractCollection(raw, keys) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (!raw || typeof raw !== "object") {
    return [];
  }
  for (const key of keys) {
    if (Array.isArray(raw[key])) {
      return raw[key];
    }
  }
  return [];
}

function readString(raw, candidates, path, warnings) {
  const value = readValue(raw, candidates, path, warnings, "");
  return value == null ? "" : String(value);
}

function readArray(raw, candidates, path, warnings) {
  const value = readValue(raw, candidates, path, warnings, []);
  if (Array.isArray(value)) {
    return value.slice();
  }
  warnings.push(`missing:${path}`);
  return [];
}

function readObject(raw, candidates, path, warnings) {
  const value = readValue(raw, candidates, path, warnings, {});
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  warnings.push(`missing:${path}`);
  return {};
}

function readValue(raw, candidates, path, warnings, fallback) {
  if (!raw || typeof raw !== "object") {
    warnings.push(`missing:${path}`);
    return fallback;
  }
  for (const key of candidates) {
    if (Object.hasOwn(raw, key) && raw[key] !== undefined) {
      return raw[key] ?? fallback;
    }
  }
  warnings.push(`missing:${path}`);
  return fallback;
}

function isSecretEnvKey(key) {
  const upper = key.toUpperCase();
  return SECRET_ENV_PATTERNS.some((pattern) => upper.includes(pattern));
}
