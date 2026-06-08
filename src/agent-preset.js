import { buildAgentConfigPlan } from "./agent-config.js";

const DEFAULT_VISIBILITY = "private";

const pluginPresets = [
  {
    id: "planner",
    source: "plugin",
    target: "agent",
    name: "Planner Agent",
    description: "Turns a user goal into checkpoints, launch review notes, and a maintainable plan.",
    role: "Goal and plan owner",
    createdBy: "Multica++",
    useCases: ["goal decomposition", "plan ledger", "launch review"],
    agent: {
      name: "Multica++ Planner Agent",
      description: "Planner for turning a goal into a scoped plan, launch review, and permission preview.",
      instructions:
        "将用户目标拆成可执行计划，先输出 Goal、Plan、权限预览和风险说明，再等待人工确认。",
      model: "",
      runtimeHint: "local-codex",
      visibility: DEFAULT_VISIBILITY,
      maxConcurrentTasks: 2,
    },
    skills: [
      { name: "launch-review", description: "Generate launch review artifacts." },
      { name: "plan-ledger", description: "Record plan state transitions." },
      { name: "permission-preview", description: "Preview permission risk." },
    ],
    mcpServers: [],
    permissions: {
      scopes: ["workspace:read", "project:read", "issue:read", "issue:comment", "agent:read", "runtime:read"],
      ttl: "2 hours",
      approvalRequired: true,
      riskLevel: "medium",
    },
    environment: [],
    guardrails: ["preview first", "human confirmation before writes", "do not print secrets"],
  },
  {
    id: "executor",
    source: "plugin",
    target: "agent",
    name: "Executor Agent",
    description: "Implements focused local changes and runs verification commands.",
    role: "Implementation worker",
    createdBy: "Multica++",
    useCases: ["local implementation", "testing", "debugging"],
    agent: {
      name: "Multica++ Executor Agent",
      description: "Executor for local implementation, tests, and CLI integration.",
      instructions: "按已确认计划进行局部实现和测试，避免修改未授权的 schema、权限和协作边界。",
      model: "",
      runtimeHint: "local-codex",
      visibility: DEFAULT_VISIBILITY,
      maxConcurrentTasks: 1,
    },
    skills: [
      { name: "test-driven-development", description: "Write tests before production changes." },
      { name: "systematic-debugging", description: "Debug failures from evidence." },
    ],
    mcpServers: [
      { name: "filesystem", purpose: "Read and edit local workspace files.", required: true },
    ],
    permissions: {
      scopes: ["workspace:read", "repo:read", "repo:write", "test:run"],
      ttl: "2 hours",
      approvalRequired: true,
      riskLevel: "medium",
    },
    environment: [],
    guardrails: ["tests before completion", "do not print secrets", "no destructive git commands"],
  },
  {
    id: "review",
    source: "plugin",
    target: "agent",
    name: "Review Agent",
    description: "Reviews diffs, risks, and missing validation before merge.",
    role: "Read-only reviewer",
    createdBy: "Multica++",
    useCases: ["code review", "risk summary", "validation review"],
    agent: {
      name: "Multica++ Review Agent",
      description: "Reviewer for checking goal, plan, and permission risk before applying agent setup.",
      instructions: "以代码审查姿态优先报告 bug、回归风险、权限风险和缺失测试。",
      model: "",
      runtimeHint: "local-codex",
      visibility: DEFAULT_VISIBILITY,
      maxConcurrentTasks: 1,
    },
    skills: [
      { name: "launch-review", description: "Review launch artifacts." },
      { name: "risk-summary", description: "Summarize risks." },
      { name: "records-check", description: "Check audit records." },
    ],
    mcpServers: [],
    permissions: {
      scopes: ["workspace:read", "project:read", "issue:read", "agent:read", "runtime:read"],
      ttl: "30 minutes",
      approvalRequired: true,
      riskLevel: "low",
    },
    environment: [],
    guardrails: ["read-only by default", "short lease", "human confirmation before writes"],
  },
  {
    id: "image2-generation",
    source: "plugin",
    target: "agent",
    name: "Image2 Generation Agent",
    description: "Creates high-quality Paigod image2 UI mockups and visual assets.",
    role: "高质量 Image2 生成 Agent",
    createdBy: "Multica++",
    useCases: ["UI concept generation", "product mockups", "image assets"],
    agent: {
      name: "Multica++ Image2 Codex Agent",
      description: "Codex image generation agent using the local Paigod image2 workflow.",
      instructions:
        "使用本地 paigod-imagegen skill，通过 gpt-image-2-text-to-image 生成高质量位图概念图、UI mockup、产品视觉稿和资产。每次真实生成前先 dry-run。",
      model: "pa/gpt-5.5",
      runtimeHint: "local-codex",
      visibility: DEFAULT_VISIBILITY,
      maxConcurrentTasks: 1,
    },
    skills: [
      {
        name: "paigod-imagegen",
        description: "Paigod gpt-image-2 text-to-image workflow.",
        localPath: "C:\\Users\\PPIO\\.codex\\skills\\paigod-imagegen\\SKILL.md",
      },
    ],
    mcpServers: [],
    permissions: {
      scopes: ["workspace:read", "project:read", "agent:read", "runtime:read", "skill:use", "shell:write"],
      ttl: "2 hours",
      approvalRequired: true,
      riskLevel: "medium",
    },
    environment: [
      {
        key: "OPENAI_API_KEY",
        pathHint: "%USERPROFILE%\\.codex\\auth.json or process env",
        required: true,
      },
    ],
    guardrails: ["Codex automatic approval", "dry-run image payload first", "no secret logging"],
  },
  {
    id: "incident",
    source: "plugin",
    target: "agent",
    name: "Incident Triage Agent",
    description: "Inspects blocked runs and prepares recovery notes.",
    role: "Blocked run triage",
    createdBy: "Multica++",
    useCases: ["blocked run triage", "recovery note", "activity scan"],
    agent: {
      name: "Multica++ Incident Triage Agent",
      description: "Triage agent for inspecting blocked plan steps and preparing recovery notes.",
      instructions: "只读取运行状态和记录，定位 blocked 原因并准备恢复建议，不直接扩大权限。",
      model: "",
      runtimeHint: "local-codex",
      visibility: DEFAULT_VISIBILITY,
      maxConcurrentTasks: 1,
    },
    skills: [
      { name: "activity-scan", description: "Scan run activity." },
      { name: "blocked-reason", description: "Explain blocked state." },
      { name: "recovery-note", description: "Prepare recovery notes." },
    ],
    mcpServers: [],
    permissions: {
      scopes: ["workspace:read", "project:read", "issue:read", "agent:read", "runtime:read"],
      ttl: "15 minutes",
      approvalRequired: true,
      riskLevel: "medium",
    },
    environment: [],
    guardrails: ["time boxed", "no secret writes", "recovery notes only"],
  },
];

const teamPresets = [
  buildTeamPresetFromEnvironment({
    id: "team-gui-builder",
    name: "Team GUI Builder Agent",
    createdBy: "PPIO Team",
    description: "Team preset for implementing the local Multica++ GUI prototype.",
    role: "GUI implementation worker",
    useCases: ["static GUI implementation", "visual QA", "local tests"],
    agent: {
      instructions:
        "实现 Multica++ 本地 GUI 原型，保持黑白灰视觉、无前端构建依赖，并用测试验证交互。",
      model: "pa/gpt-5.5",
      runtimeHint: "local-codex",
      maxConcurrentTasks: 1,
    },
    skills: [
      { name: "launch-review", description: "Review launch artifacts." },
      { name: "test-driven-development", description: "Write tests before changes." },
    ],
    mcpServers: [
      { name: "filesystem", purpose: "Read and edit the local repository.", required: true },
    ],
    permissions: {
      scopes: ["workspace:read", "repo:read", "repo:write", "test:run"],
      ttl: "2 hours",
      approvalRequired: true,
      riskLevel: "medium",
    },
    environment: [
      { key: "GITHUB_TOKEN", pathHint: "GitHub CLI keyring", required: false },
    ],
    guardrails: ["do not stage unrelated files", "run npm test", "no secret logging"],
  }),
];

export function listAgentPresets({ includeTeam = true } = {}) {
  return deepClone(includeTeam ? [...pluginPresets, ...teamPresets] : pluginPresets);
}

export function buildTeamPresetFromEnvironment(input = {}) {
  const name = input.name || "Team Agent Preset";
  return {
    id: input.id || slugify(name),
    source: "team",
    target: input.target || "agent",
    name,
    description: input.description || `${name} generated from the shared team environment.`,
    role: input.role || input.agent?.role || "Team agent",
    createdBy: input.createdBy || "Team",
    useCases: sanitizeStringArray(input.useCases),
    agent: {
      name,
      description: input.agent?.description || input.description || `${name} generated from the shared team environment.`,
      instructions: input.agent?.instructions || "",
      model: input.agent?.model || "",
      runtimeHint: input.agent?.runtimeHint || "local-codex",
      visibility: input.agent?.visibility || DEFAULT_VISIBILITY,
      maxConcurrentTasks: Number(input.agent?.maxConcurrentTasks ?? 1),
    },
    skills: sanitizeNamedItems(input.skills),
    mcpServers: sanitizeMcpServers(input.mcpServers),
    permissions: sanitizePermissions(input.permissions),
    environment: sanitizeEnvironment(input.environment),
    guardrails: sanitizeStringArray(input.guardrails),
  };
}

export function mergePresetOverrides(preset, overrides = {}) {
  const base = deepClone(preset);
  const merged = {
    ...base,
    ...pickDefined(overrides, ["name", "description", "role", "target"]),
    agent: {
      ...base.agent,
      ...pickDefined(overrides.agent ?? {}, [
        "name",
        "description",
        "instructions",
        "model",
        "runtimeHint",
        "visibility",
        "maxConcurrentTasks",
      ]),
    },
    permissions: {
      ...base.permissions,
      ...pickDefined(overrides.permissions ?? {}, ["ttl", "approvalRequired", "riskLevel"]),
      scopes: overrides.permissions?.scopes ? sanitizeStringArray(overrides.permissions.scopes) : base.permissions.scopes,
    },
    skills: overrides.skills ? sanitizeNamedItems(overrides.skills) : base.skills,
    mcpServers: overrides.mcpServers ? sanitizeMcpServers(overrides.mcpServers) : base.mcpServers,
    environment: overrides.environment ? sanitizeEnvironment(overrides.environment) : base.environment,
    guardrails: overrides.guardrails ? sanitizeStringArray(overrides.guardrails) : base.guardrails,
    useCases: overrides.useCases ? sanitizeStringArray(overrides.useCases) : base.useCases,
  };
  return merged;
}

export function buildAgentConfigPlanFromPreset({
  environment,
  preset,
  createdAt = new Date().toISOString(),
  mode,
} = {}) {
  const normalized = mergePresetOverrides(preset);
  const planPreset = toAgentConfigPreset(normalized);
  const plan = buildAgentConfigPlan({
    environment,
    presetId: normalized.id,
    preset: planPreset,
    createdAt,
    mode,
  });
  if (!plan.ok) return plan;

  return {
    ...plan,
    sourcePreset: summarizePreset(normalized),
    blockedOperations: [
      ...(plan.blockedOperations ?? []),
      ...(normalized.mcpServers.length ? [{
        type: "agent:mcp:set",
        reason: "MCP servers are visible in presets, but current multica agent create/update CLI does not expose a direct MCP write flag.",
        servers: normalized.mcpServers.map((server) => ({
          name: server.name,
          required: server.required,
          purpose: server.purpose,
        })),
      }] : []),
      ...(normalized.environment.length ? [{
        type: "agent:env:set",
        reason: "Environment entries are path hints only. Secret values must be written separately with multica agent env set after human approval.",
        keys: normalized.environment.map((item) => ({
          key: item.key,
          pathHint: item.pathHint,
          required: item.required,
        })),
      }] : []),
      ...(normalized.target !== "agent" ? [{
        type: "squad:create",
        reason: "Squad presets are preview-only in this release.",
      }] : []),
    ],
  };
}

function toAgentConfigPreset(preset) {
  return {
    id: preset.id,
    name: preset.agent.name,
    role: preset.role,
    description: preset.agent.description || preset.description,
    skills: preset.skills.map((skill) => skill.name),
    scopes: preset.permissions.scopes,
    guardrails: preset.guardrails,
    maxConcurrentTasks: preset.agent.maxConcurrentTasks,
    visibility: preset.agent.visibility,
    model: preset.agent.model,
    instructions: preset.agent.instructions,
  };
}

function summarizePreset(preset) {
  return {
    id: preset.id,
    source: preset.source,
    target: preset.target,
    name: preset.name,
    createdBy: preset.createdBy,
    mcpServers: preset.mcpServers.map((server) => server.name),
    environmentKeys: preset.environment.map((item) => item.key),
  };
}

function sanitizePermissions(permissions = {}) {
  return {
    scopes: sanitizeStringArray(permissions.scopes),
    ttl: permissions.ttl || "1 hour",
    approvalRequired: permissions.approvalRequired !== false,
    riskLevel: permissions.riskLevel || "medium",
  };
}

function sanitizeNamedItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item?.name)
    .map((item) => ({
      name: String(item.name),
      description: item.description ? String(item.description) : "",
      localPath: item.localPath ? String(item.localPath) : "",
    }));
}

function sanitizeMcpServers(servers = []) {
  if (!Array.isArray(servers)) return [];
  return servers
    .filter((server) => server?.name)
    .map((server) => ({
      name: String(server.name),
      purpose: server.purpose ? String(server.purpose) : "",
      required: Boolean(server.required),
      configHint: server.configHint ? String(server.configHint) : "",
    }));
}

function sanitizeEnvironment(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item?.key)
    .map((item) => ({
      key: String(item.key),
      pathHint: item.pathHint ? String(item.pathHint) : "",
      required: Boolean(item.required),
    }));
}

function sanitizeStringArray(items = []) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item !== undefined && item !== null && String(item).trim()).map((item) => String(item));
}

function pickDefined(source, keys) {
  return keys.reduce((acc, key) => {
    if (source[key] !== undefined) acc[key] = source[key];
    return acc;
  }, {});
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "team-agent-preset";
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
