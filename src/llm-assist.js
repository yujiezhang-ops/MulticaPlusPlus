import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120000;
export const SECRET_METADATA_CONFIRMATION_TOKEN = "READ-LOCAL-LLM-SECRET-METADATA";
const SECRET_KEY_PATTERN = /token|secret|password|api[_-]?key|cookie|credential/i;
const PLAN_SET_JSON_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["plans"],
  properties: {
    plans: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["title", "objective", "workstream", "suggestedAgent", "dependencies", "steps", "acceptanceEvidence"],
        properties: {
          title: { type: "string" },
          objective: { type: "string" },
          workstream: {
            type: "object",
            additionalProperties: true,
            required: ["id", "label", "reason"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              reason: { type: "string" },
            },
          },
          suggestedAgent: { type: "string" },
          dependencies: { type: "array" },
          steps: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              additionalProperties: true,
              required: ["title", "description", "dependencies", "acceptanceEvidence"],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                dependencies: { type: "array" },
                acceptanceEvidence: { type: "string" },
              },
            },
          },
          acceptanceEvidence: { type: "string" },
        },
      },
    },
    risks: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
  },
};
const GOAL_CLARIFICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: [
    "status",
    "title",
    "objective",
    "successCriteria",
    "scope",
    "constraints",
    "risks",
    "clarificationQuestions",
    "confidence",
  ],
  properties: {
    status: { type: "string", enum: ["draft", "clarified"] },
    title: { type: "string" },
    objective: { type: "string" },
    successCriteria: { type: "array", items: { type: "string" } },
    scope: {
      type: "object",
      additionalProperties: true,
      required: ["in", "out"],
      properties: {
        in: { type: "array", items: { type: "string" } },
        out: { type: "array", items: { type: "string" } },
      },
    },
    constraints: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    clarificationQuestions: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
};

export async function discoverLlmProviders({
  userConfig = {},
  env = process.env,
  homeDir = env.USERPROFILE || env.HOME || homedir(),
  commandExists = defaultCommandExists(env),
  pathExists = defaultPathExists,
  getCommandVersion = defaultGetCommandVersion,
  readTextFile = readFile,
} = {}) {
  const providers = [];
  const candidates = [];
  const config = normalizeUserConfig(userConfig);

  if (config.provider || config.command) {
    const kind = config.provider || inferProviderKind(config.command);
    const providerConfig = kind === "codex"
      ? await readCodexInvocationConfig({ configPath: join(homeDir, ".codex", "config.toml"), readTextFile, pathExists })
      : {};
    const provider = sanitizeProvider({
      id: `provider_${kind || "custom"}_user`,
      kind: kind || "custom",
      command: config.command || kind,
      model: config.model || providerConfig.model,
      timeoutMs: config.timeoutMs,
      source: "user-config",
      status: "available",
      codexConfig: {
        ...providerConfig,
        model: config.model || providerConfig.model,
      },
    });
    if (provider.command && await commandExists(provider.command)) {
      providers.push(sanitizeProvider({
        ...provider,
        version: await getCommandVersion(provider.command),
        ...capabilitiesForProviderKind(provider.kind),
      }));
    } else {
      candidates.push({
        ...provider,
        status: "candidate",
        reason: provider.command ? "configured_command_not_found" : "configured_provider_missing_command",
      });
    }
  }

  await appendCliProvider({
    providers,
    candidates,
    kind: "codex",
    command: "codex",
    configPath: join(homeDir, ".codex"),
    source: "codex",
    commandExists,
    pathExists,
    getCommandVersion,
    readTextFile,
  });

  await appendCliProvider({
    providers,
    candidates,
    kind: "claude",
    command: "claude",
    configPath: join(homeDir, ".claude"),
    source: "claude",
    commandExists,
    pathExists,
    getCommandVersion,
    readTextFile,
  });

  await appendConfigToolCandidates({ candidates, homeDir, env, commandExists, pathExists });

  const selectedProvider = providers[0] ?? null;
  if (selectedProvider) {
    return {
      ok: true,
      status: "available",
      selectedProvider,
      providers,
      candidates,
    };
  }

  return {
    ok: false,
    status: "blocked",
    blocked: true,
    reason: "no_llm_provider",
    providers,
    candidates,
  };
}

export async function diagnoseLlmProvider({
  provider,
  probe = false,
  timeoutMs,
  exec = runCommandArray,
  env = process.env,
  cwd = process.cwd(),
  pathExists = defaultPathExists,
} = {}) {
  const safeProvider = sanitizeProvider(provider);
  const resolvedPath = await resolveExecutablePath(safeProvider.command, env);
  const timeout = Number(timeoutMs || safeProvider.timeoutMs || DEFAULT_TIMEOUT_MS);
  const diagnostic = {
    provider: safeProvider,
    command: safeProvider.command || "",
    resolvedPath: redactText(resolvedPath),
    version: safeProvider.version || "",
    configPathPresent: safeProvider.configPath ? await pathExists(safeProvider.configPath) : undefined,
    supportsOutputFile: Boolean(safeProvider.supportsOutputFile),
    supportsJsonSchema: Boolean(safeProvider.supportsJsonSchema),
    timeoutMs: timeout,
    cwd: redactText(cwd),
    probe: Boolean(probe),
  };

  if (!safeProvider.command || !resolvedPath) {
    return {
      ok: false,
      blocked: true,
      reason: "llm_command_not_found",
      diagnostic: stripEmpty(diagnostic),
    };
  }

  const helpInvocation = buildProviderHelpInvocation(safeProvider);
  const helpResult = await runDiagnosticCommand({ exec, args: helpInvocation.args, timeoutMs: 10000 });
  diagnostic.help = sanitizeCommandResult(helpResult);
  diagnostic.argvSummary = summarizeArgs(helpInvocation.args);
  if (!helpResult.ok) {
    return {
      ok: false,
      blocked: true,
      reason: classifyLlmCommandFailure(helpResult),
      diagnostic: stripEmpty(diagnostic),
    };
  }

  if (!probe) {
    return {
      ok: true,
      status: "ready",
      diagnostic: stripEmpty(diagnostic),
    };
  }

  const probeGoal = {
    id: "goal_probe",
    status: "locked",
    objective: "Probe local LLM provider readiness for Multica++ Goal to Plan splitting.",
    constraints: ["Return a tiny valid plan set only."],
  };
  const probeResult = await invokeLlmForGoalPlanSplit({
    provider: safeProvider,
    goal: probeGoal,
    constraints: ["This is a readiness probe. Return two short independent draft plans."],
    timeoutMs: timeout,
    exec,
  });
  if (!probeResult.ok) {
    return {
      ok: false,
      blocked: true,
      reason: probeResult.reason || "llm_probe_failed",
      diagnostic: {
        ...stripEmpty(diagnostic),
        invocation: probeResult.diagnostic,
      },
    };
  }
  return {
    ok: true,
    status: "probe_passed",
    diagnostic: stripEmpty(diagnostic),
  };
}

export async function invokeLlmForGoalPlanSplit({
  provider,
  goal,
  constraints = [],
  timeoutMs,
  exec = runCommandArray,
  writePromptFile,
  removePromptFile,
  readOutputFile = readFile,
} = {}) {
  return invokeLlmForJsonDraft({
    provider,
    prompt: buildGoalPlanSplitPrompt({ goal, constraints }),
    schema: PLAN_SET_JSON_SCHEMA,
    schemaBasename: "plan-set.schema.json",
    tempPrefix: "multica-llm-split-",
    resultKey: "planSetDraft",
    parseResponse: parseLlmPlanSetResponse,
    timeoutMs,
    exec,
    writePromptFile,
    removePromptFile,
    readOutputFile,
  });
}

export async function invokeLlmForGoalClarification({
  provider,
  request = "",
  context = {},
  timeoutMs,
  exec = runCommandArray,
  writePromptFile,
  removePromptFile,
  readOutputFile = readFile,
} = {}) {
  return invokeLlmForJsonDraft({
    provider,
    prompt: buildGoalClarificationPrompt({ request, context }),
    schema: GOAL_CLARIFICATION_JSON_SCHEMA,
    schemaBasename: "goal-clarification.schema.json",
    tempPrefix: "multica-llm-goal-",
    resultKey: "goalDraft",
    parseResponse: parseLlmGoalClarificationResponse,
    timeoutMs,
    exec,
    writePromptFile,
    removePromptFile,
    readOutputFile,
  });
}

async function invokeLlmForJsonDraft({
  provider,
  prompt,
  schema,
  schemaBasename,
  tempPrefix,
  resultKey,
  parseResponse,
  timeoutMs,
  exec,
  writePromptFile,
  removePromptFile,
  readOutputFile,
}) {
  const safeProvider = sanitizeProvider(provider);
  if (!safeProvider.command) {
    return blocked("llm_provider_missing_command");
  }

  let promptFile = "";
  let outputFile = "";
  let schemaFile = "";
  let cleanupDir = "";
  try {
    if (writePromptFile) {
      promptFile = await writePromptFile(prompt);
    } else {
      cleanupDir = await mkdtemp(join(tmpdir(), tempPrefix));
      promptFile = join(cleanupDir, "prompt.txt");
      await writeFile(promptFile, prompt, "utf8");
    }
    if (!cleanupDir) {
      cleanupDir = await mkdtemp(join(tmpdir(), tempPrefix));
    }
    outputFile = join(cleanupDir, "last-message.json");
    schemaFile = join(cleanupDir, schemaBasename);
    await writeFile(schemaFile, JSON.stringify(schema, null, 2), "utf8");

    const invocation = buildProviderInvocation({ provider: safeProvider, prompt, promptFile, outputFile, schemaFile, schema });
    const diagnosticBase = buildInvocationDiagnostic({
      provider: safeProvider,
      invocation,
      timeoutMs: Number(timeoutMs || safeProvider.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
    let result;
    try {
      result = await exec(invocation.args, {
        timeoutMs: Number(timeoutMs || safeProvider.timeoutMs || DEFAULT_TIMEOUT_MS),
        stdin: invocation.stdin,
      });
    } catch (error) {
      const failure = {
        code: 1,
        stderr: error?.message || String(error),
        stdout: "",
      };
      return {
        ...blocked(classifyLlmCommandFailure(failure)),
        diagnostic: {
          ...diagnosticBase,
          result: sanitizeCommandResult(failure),
        },
      };
    }
    if (!result || result.code !== 0) {
      return {
        ...blocked(classifyLlmCommandFailure(result)),
        diagnostic: {
          ...diagnosticBase,
          result: sanitizeCommandResult(result),
        },
      };
    }

    try {
      const rawText = await readProviderOutput({
        provider: safeProvider,
        stdout: result.stdout || "",
        outputFile,
        readOutputFile,
      });
      return {
        ok: true,
        provider: safeProvider,
        [resultKey]: parseResponse(rawText),
      };
    } catch (error) {
      return {
        ...blocked(error.code === "missing_output" ? "llm_output_missing" : error.code === "non_json" ? "llm_non_json_stdout" : "llm_invalid_json_shape"),
        error: redactText(error.message),
        diagnostic: {
          ...diagnosticBase,
          result: sanitizeCommandResult(result),
        },
      };
    }
  } finally {
    if (removePromptFile && promptFile) {
      await removePromptFile(promptFile);
    }
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true });
    }
  }
}

export function parseLlmPlanSetResponse(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text || text.startsWith("```")) {
    const error = new Error("LLM stdout must be raw JSON without Markdown fences.");
    error.code = "non_json";
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const wrapped = new Error(`LLM stdout must be JSON: ${error.message}`);
    wrapped.code = "non_json";
    throw wrapped;
  }

  if (Array.isArray(parsed?.plans)) {
    return parsed;
  }

  const nested = ["result", "output_text", "text", "content", "response", "output", "message"]
    .map((key) => parsed?.[key])
    .find((value) => typeof value === "string");
  if (nested) {
    return parseLlmPlanSetResponse(nested);
  }

  throw new Error("LLM JSON must include a plans array.");
}

export function parseLlmGoalClarificationResponse(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text || text.startsWith("```")) {
    const error = new Error("LLM stdout must be raw JSON without Markdown fences.");
    error.code = "non_json";
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const wrapped = new Error(`LLM stdout must be JSON: ${error.message}`);
    wrapped.code = "non_json";
    throw wrapped;
  }

  if (isPlainObject(parsed) && (hasText(parsed.title) || hasText(parsed.objective)) && Array.isArray(parsed.successCriteria)) {
    return parsed;
  }

  const nested = ["result", "output_text", "text", "content", "response", "output", "message"]
    .map((key) => parsed?.[key])
    .find((value) => typeof value === "string");
  if (nested) {
    return parseLlmGoalClarificationResponse(nested);
  }

  throw new Error("LLM JSON must include goal clarification fields.");
}

export function validateLlmPlanSet(planSetDraft, goal = {}) {
  const warnings = [];
  if (!planSetDraft || !Array.isArray(planSetDraft.plans)) {
    return { ok: false, blocked: true, reason: "invalid_plan_set", warnings };
  }
  if (planSetDraft.plans.length < 2) {
    return { ok: false, blocked: true, reason: "too_few_plans", warnings };
  }

  for (const plan of planSetDraft.plans) {
    if (!hasText(plan.title)
      || !hasText(plan.objective)
      || !isPlainObject(plan.workstream)
      || !hasText(plan.workstream.id)
      || !hasText(plan.workstream.label)
      || !hasText(plan.workstream.reason)
      || !hasText(plan.suggestedAgent)
      || !Array.isArray(plan.dependencies)
      || !Array.isArray(plan.steps)
      || !hasText(plan.acceptanceEvidence)) {
      return { ok: false, blocked: true, reason: "invalid_plan_fields", warnings };
    }
    if (plan.steps.length < 2) {
      return { ok: false, blocked: true, reason: "too_few_plan_steps", warnings };
    }
    for (const step of plan.steps) {
      if (!hasText(step.title)
        || !hasText(step.description)
        || !Array.isArray(step.dependencies)
        || !hasText(step.acceptanceEvidence)) {
        return { ok: false, blocked: true, reason: "invalid_step_fields", warnings };
      }
    }
  }

  const unsafe = findUnsafePlanContent(planSetDraft, goal);
  if (unsafe) {
    return {
      ok: false,
      blocked: true,
      reason: "unsafe_plan_content",
      warnings: [unsafe],
    };
  }

  return { ok: true, warnings };
}

export function validateLlmGoalDraft(goalDraft) {
  const warnings = [];
  if (!isPlainObject(goalDraft)) {
    return { ok: false, blocked: true, reason: "invalid_goal_draft", warnings };
  }
  if (!["draft", "clarified"].includes(String(goalDraft.status || ""))) {
    return { ok: false, blocked: true, reason: "invalid_goal_status", warnings };
  }
  if (!hasText(goalDraft.title)
    || !hasText(goalDraft.objective)
    || !Array.isArray(goalDraft.successCriteria)
    || !isPlainObject(goalDraft.scope)
    || !Array.isArray(goalDraft.scope.in)
    || !Array.isArray(goalDraft.scope.out)
    || !Array.isArray(goalDraft.constraints)
    || !Array.isArray(goalDraft.risks)
    || !Array.isArray(goalDraft.clarificationQuestions)) {
    return { ok: false, blocked: true, reason: "invalid_goal_fields", warnings };
  }
  if (goalDraft.status === "clarified" && goalDraft.successCriteria.length === 0) {
    return { ok: false, blocked: true, reason: "missing_success_criteria", warnings };
  }
  if (goalDraft.status === "draft" && goalDraft.clarificationQuestions.length === 0) {
    return { ok: false, blocked: true, reason: "missing_clarification_questions", warnings };
  }

  const unsafe = findUnsafeGoalContent(goalDraft);
  if (unsafe) {
    return {
      ok: false,
      blocked: true,
      reason: "unsafe_goal_content",
      warnings: [unsafe],
    };
  }

  return { ok: true, warnings };
}

export function sanitizeProvider(provider = {}) {
  const config = normalizeUserConfig(provider);
  return stripEmpty({
    id: String(provider.id ?? config.id ?? `provider_${config.provider || provider.kind || "custom"}`),
    kind: String(provider.kind ?? config.provider ?? "custom").toLowerCase(),
    command: provider.command ?? config.command ? String(provider.command ?? config.command) : "",
    model: provider.model ?? config.model ? String(provider.model ?? config.model) : "",
    source: String(provider.source ?? config.source ?? "detected"),
    status: provider.status ? String(provider.status) : undefined,
    configPath: provider.configPath ? String(provider.configPath) : undefined,
    timeoutMs: provider.timeoutMs ?? config.timeoutMs ? Number(provider.timeoutMs ?? config.timeoutMs) : undefined,
    reason: provider.reason ? String(provider.reason) : undefined,
    version: provider.version ? String(provider.version) : undefined,
    supportsOutputFile: provider.supportsOutputFile === undefined ? undefined : Boolean(provider.supportsOutputFile),
    supportsJsonSchema: provider.supportsJsonSchema === undefined ? undefined : Boolean(provider.supportsJsonSchema),
    codexConfig: sanitizeCodexInvocationConfig(provider.codexConfig ?? config.codexConfig),
  });
}

export async function readLlmSecretMetadata({
  provider,
  confirm = "",
  env = process.env,
  homeDir = env.USERPROFILE || env.HOME || homedir(),
  readTextFile = readFile,
  pathExists = defaultPathExists,
} = {}) {
  const safeProvider = sanitizeProvider(provider);
  const kind = safeProvider.kind || inferProviderKind(safeProvider.command) || "codex";
  if (confirm !== SECRET_METADATA_CONFIRMATION_TOKEN) {
    return {
      ok: false,
      blocked: true,
      reason: "secret_metadata_confirmation_required",
      requiredConfirm: SECRET_METADATA_CONFIRMATION_TOKEN,
    };
  }
  if (!["codex", "claude"].includes(kind)) {
    return {
      ok: false,
      blocked: true,
      reason: "unsupported_secret_metadata_provider",
      provider: sanitizeProvider({ ...safeProvider, kind }),
    };
  }

  if (kind === "codex") {
    return {
      ok: true,
      provider: "codex",
      metadata: await readCodexSecretMetadata({ homeDir, readTextFile, pathExists }),
    };
  }

  return {
    ok: true,
    provider: "claude",
    metadata: await readClaudeSecretMetadata({ homeDir, readTextFile, pathExists }),
  };
}

function normalizeUserConfig(config = {}) {
  const fromPlugin = config["multica-plusplus"]?.llm ?? config.multicaPlusPlus?.llm ?? {};
  const fromLlm = config.llm ?? {};
  const merged = { ...fromPlugin, ...fromLlm, ...config };
  const safe = {};
  for (const [key, value] of Object.entries(merged)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    safe[key] = value;
  }
  return {
    id: safe.id,
    provider: safe.provider ? String(safe.provider).toLowerCase() : "",
    command: safe.command ? String(safe.command) : "",
    model: safe.model ? String(safe.model) : "",
    timeoutMs: safe.timeoutMs ? Number(safe.timeoutMs) : undefined,
    source: safe.source,
    codexConfig: safe.codexConfig,
  };
}

async function appendCliProvider({
  providers,
  candidates,
  kind,
  command,
  configPath,
  source,
  commandExists,
  pathExists,
  getCommandVersion,
  readTextFile,
}) {
  const hasConfig = await pathExists(configPath);
  const hasCommand = await commandExists(command);
  if (hasConfig && hasCommand) {
    const version = await getCommandVersion(command);
    const providerConfig = kind === "codex"
      ? await readCodexInvocationConfig({ configPath: join(configPath, "config.toml"), readTextFile, pathExists })
      : {};
    providers.push(sanitizeProvider({
      id: `provider_${kind}`,
      kind,
      command,
      source,
      status: "available",
      configPath,
      version,
      model: providerConfig.model,
      codexConfig: providerConfig,
      ...capabilitiesForProviderKind(kind),
    }));
    return;
  }
  if (hasConfig) {
    candidates.push(sanitizeProvider({
      id: `provider_${kind}`,
      kind,
      command,
      source,
      status: "candidate",
      configPath,
      reason: "config_path_without_cli",
    }));
  }
}

async function appendConfigToolCandidates({ candidates, homeDir, env, commandExists, pathExists }) {
  const appData = env.APPDATA || join(homeDir, "AppData", "Roaming");
  const localAppData = env.LOCALAPPDATA || join(homeDir, "AppData", "Local");
  const tools = [
    {
      id: "provider_cc_switch",
      kind: "cc-switch",
      command: "cc-switch",
      source: "config-tool",
      paths: [
        join(appData, "cc-switch"),
        join(appData, "CC Switch"),
        join(homeDir, ".cc-switch"),
      ],
    },
    {
      id: "provider_cherry_studio",
      kind: "cherry-studio",
      command: "cherry-studio",
      source: "config-tool",
      paths: [
        join(appData, "CherryStudio"),
        join(appData, "cherry-studio"),
        join(localAppData, "CherryStudio"),
        join(localAppData, "Programs", "Cherry Studio"),
      ],
    },
  ];

  for (const tool of tools) {
    const hasPath = (await Promise.all(tool.paths.map((path) => pathExists(path)))).some(Boolean);
    const hasCommand = await commandExists(tool.command);
    if (!hasPath && !hasCommand) continue;
    candidates.push(sanitizeProvider({
      ...tool,
      status: "candidate",
      reason: "config_tool_only",
      configPath: hasPath ? tool.paths.find(Boolean) : undefined,
    }));
  }
}

function inferProviderKind(command = "") {
  const text = String(command).toLowerCase();
  if (text.includes("claude")) return "claude";
  if (text.includes("codex")) return "codex";
  return "";
}

function capabilitiesForProviderKind(kind = "") {
  return {
    supportsOutputFile: kind === "codex",
    supportsJsonSchema: kind === "claude",
  };
}

async function readCodexInvocationConfig({ configPath, readTextFile, pathExists }) {
  if (!await pathExists(configPath)) return {};
  const text = await safeReadText(readTextFile, configPath);
  return parseCodexInvocationConfig(text);
}

function parseCodexInvocationConfig(text) {
  const root = {};
  const modelProviders = {};
  let section = "";
  for (const line of String(text || "").split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!match) continue;
    const key = match[1];
    if (SECRET_KEY_PATTERN.test(key)) continue;
    const value = parseTomlScalar(match[2]);
    if (!section) {
      root[key] = value;
      continue;
    }
    const providerMatch = section.match(/^model_providers\.([A-Za-z0-9_-]+)$/);
    if (providerMatch) {
      const providerId = providerMatch[1];
      modelProviders[providerId] ??= {};
      modelProviders[providerId][key] = value;
    }
  }
  const modelProvider = root.model_provider ? String(root.model_provider) : "";
  const selectedProvider = modelProvider ? modelProviders[modelProvider] ?? {} : {};
  return sanitizeCodexInvocationConfig({
    modelProvider,
    model: root.model,
    providerName: selectedProvider.name || modelProvider,
    wireApi: selectedProvider.wire_api,
    requiresOpenaiAuth: selectedProvider.requires_openai_auth,
    baseUrl: selectedProvider.base_url,
  });
}

function sanitizeCodexInvocationConfig(config = {}) {
  if (!isPlainObject(config)) return undefined;
  const safe = stripEmpty({
    modelProvider: config.modelProvider ? String(config.modelProvider) : "",
    model: config.model ? String(config.model) : "",
    providerName: config.providerName ? String(config.providerName) : "",
    wireApi: config.wireApi ? String(config.wireApi) : "",
    requiresOpenaiAuth: config.requiresOpenaiAuth === undefined ? undefined : parseBooleanConfig(config.requiresOpenaiAuth),
    baseUrl: config.baseUrl ? String(config.baseUrl) : "",
  });
  return Object.keys(safe).length ? safe : undefined;
}

function parseBooleanConfig(value) {
  if (typeof value === "boolean") return value;
  return String(value).trim().toLowerCase() === "true";
}

function buildProviderInvocation({ provider, prompt, promptFile, outputFile, schemaFile, schema }) {
  if (provider.kind === "claude") {
    const args = [provider.command, "-p", "--output-format", "json", "--no-session-persistence", "--tools", ""];
    if (provider.model) {
      args.push("--model", provider.model);
    }
    args.push("--json-schema", JSON.stringify(schema), prompt);
    return { args };
  }
  const args = [
    provider.command,
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--output-schema",
    schemaFile,
    "--output-last-message",
    outputFile,
  ];
  const codexConfigArgs = buildCodexConfigArgs(provider);
  if (codexConfigArgs.length) {
    args.push("--ignore-user-config", ...codexConfigArgs);
  } else if (provider.model) {
    args.push("--model", provider.model);
  }
  args.push("-");
  return { args, stdin: prompt };
}

function buildCodexConfigArgs(provider) {
  const config = sanitizeCodexInvocationConfig(provider.codexConfig);
  if (!config?.modelProvider || !config?.baseUrl) return [];
  const providerName = config.providerName || config.modelProvider;
  const pairs = [
    ["model_provider", quoteTomlString(config.modelProvider)],
    ["model", quoteTomlString(config.model || provider.model || "")],
    [`model_providers.${config.modelProvider}.name`, quoteTomlString(providerName)],
    [`model_providers.${config.modelProvider}.base_url`, quoteTomlString(config.baseUrl)],
  ];
  if (config.wireApi) {
    pairs.push([`model_providers.${config.modelProvider}.wire_api`, quoteTomlString(config.wireApi)]);
  }
  if (config.requiresOpenaiAuth !== undefined) {
    pairs.push([`model_providers.${config.modelProvider}.requires_openai_auth`, String(Boolean(config.requiresOpenaiAuth))]);
  }
  return pairs
    .filter(([, value]) => value !== "\"\"")
    .flatMap(([key, value]) => ["-c", `${key}=${value}`]);
}

function quoteTomlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function buildProviderHelpInvocation(provider) {
  if (provider.kind === "codex") {
    return { args: [provider.command, "exec", "--help"] };
  }
  if (provider.kind === "claude") {
    return { args: [provider.command, "-p", "--help"] };
  }
  return { args: [provider.command, "--help"] };
}

async function runDiagnosticCommand({ exec, args, timeoutMs }) {
  try {
    const result = await exec(args, { timeoutMs });
    return {
      ok: result?.code === 0,
      stdout: result?.stdout || "",
      stderr: result?.stderr || "",
      code: result?.code ?? 1,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error?.message || String(error),
      code: 1,
    };
  }
}

function buildInvocationDiagnostic({ provider, invocation, timeoutMs }) {
  return stripEmpty({
    provider: sanitizeProvider(provider),
    phase: "invoke",
    timeoutMs,
    argvSummary: summarizeArgs(invocation.args),
  });
}

function summarizeArgs(args = []) {
  return args.map((arg, index) => {
    if (index === 0) return commandBasename(arg);
    const text = String(arg);
    if (!text) return "";
    if (text === "-") return "-";
    if (text.startsWith("--")) return text;
    if (looksLikePath(text)) return pathHint(text);
    if (text.length > 80 || /[\r\n{}]/.test(text)) return "[inline-content]";
    return redactText(text);
  }).filter(Boolean);
}

function sanitizeCommandResult(result = {}) {
  return stripEmpty({
    code: Number(result.code ?? 1),
    stdoutExcerpt: excerpt(redactText(result.stdout || "")),
    stderrExcerpt: excerpt(redactText(result.stderr || "")),
  });
}

function classifyLlmCommandFailure(result = {}) {
  const code = Number(result.code ?? 1);
  const text = `${result.stderr || ""}\n${result.stdout || ""}`.toLowerCase();
  if (code === 124 || text.includes("timed out") || text.includes("timeout")) return "llm_timeout";
  if (text.includes("not recognized") || text.includes("not found") || text.includes("enoent")) return "llm_command_not_found";
  if (text.includes("unknown option") || text.includes("unexpected argument") || text.includes("unsupported") || text.includes("invalid option")) return "llm_unsupported_flags";
  if (text.includes("remote plugin catalog") || text.includes("remote installed plugin") || text.includes("startup remote sync")) return "llm_codex_plugin_auth_required";
  if (text.includes("login") || text.includes("sign in") || text.includes("signin") || text.includes("auth required") || text.includes("not authenticated")) return "llm_auth_required";
  if (text.includes("auth") || text.includes("unauthorized") || text.includes("forbidden") || text.includes("permission denied") || text.includes("401") || text.includes("403")) return "llm_auth_failed";
  if (text.includes("model") && (text.includes("not found") || text.includes("unavailable") || text.includes("unknown") || text.includes("unsupported"))) return "llm_model_unavailable";
  if (text.includes("network") || text.includes("econn") || text.includes("dns") || text.includes("proxy") || text.includes("tls") || text.includes("socket")) return "llm_network_failed";
  if (text.includes("schema") && (text.includes("invalid") || text.includes("unsupported"))) return "llm_schema_not_supported";
  if (text.includes("config") || text.includes("profile")) return "llm_provider_config_failed";
  return "llm_unknown_exit";
}

async function readProviderOutput({ provider, stdout, outputFile, readOutputFile }) {
  if (provider.kind === "codex") {
    try {
      const text = await readOutputFile(outputFile, "utf8");
      if (!String(text).trim()) {
        const error = new Error("Codex output-last-message file was empty.");
        error.code = "missing_output";
        throw error;
      }
      return text;
    } catch (error) {
      if (error.code === "missing_output") throw error;
      const missing = new Error("Codex output-last-message file was not created.");
      missing.code = "missing_output";
      throw missing;
    }
  }
  return stdout;
}

function buildGoalPlanSplitPrompt({ goal, constraints }) {
  return [
    "You are assisting Multica++ with splitting one locked Goal into multiple parallel Plan drafts.",
    "Return JSON only. Do not return Markdown, comments, or prose outside JSON.",
    "",
    "Locked Goal JSON:",
    JSON.stringify(goal, null, 2),
    "",
    "Guardrails:",
    "- preview-first: produce draft plans and issue candidates only.",
    "- never silently write Multica state or call Multica CLI.",
    "- do not change public schema, permission boundaries, skills, metadata, or collaboration roles without explicit human confirmation.",
    "- do not expose, request, infer, copy, or log secrets.",
    "- split into independent workstreams suitable for parallel review.",
    ...constraints.map((item) => `- ${item}`),
    "",
    "Output JSON shape:",
    JSON.stringify({
      plans: [
        {
          title: "string",
          objective: "string",
          workstream: { id: "string", label: "string", reason: "string" },
          suggestedAgent: "string",
          dependencies: [],
          steps: [
            {
              title: "string",
              description: "string",
              dependencies: [],
              acceptanceEvidence: "string",
            },
          ],
          acceptanceEvidence: "string",
        },
      ],
      risks: ["string"],
      questions: ["string"],
    }, null, 2),
  ].join("\n");
}

function buildGoalClarificationPrompt({ request, context }) {
  const clarificationContext = context?.clarification;
  return [
    "You are assisting Multica++ with clarifying a fuzzy user request into a Goal draft.",
    "Return JSON only. Do not return Markdown, comments, or prose outside JSON.",
    "",
    "Raw user request:",
    String(request ?? ""),
    "",
    "Context JSON:",
    JSON.stringify(context ?? {}, null, 2),
    "",
    "Clarification context JSON:",
    JSON.stringify(clarificationContext ?? {}, null, 2),
    "",
    "Guardrails:",
    "- Produce a Goal draft only; do not generate Plan steps here.",
    "- If the request is ambiguous, set status to draft and ask concrete clarification questions.",
    "- If Clarification context JSON includes a user answer, use it together with the raw request and previous draft; prefer status clarified when the answer makes the Goal actionable.",
    "- If the user answer is still insufficient, keep status as draft and ask only the remaining concrete clarification questions.",
    "- If the request is actionable, set status to clarified and provide success criteria, scope, constraints, risks, and any remaining questions.",
    "- preview-first: never call Multica CLI or write Multica state.",
    "- do not change public schema, permission boundaries, skills, metadata, or collaboration roles without explicit human confirmation.",
    "- do not expose, request, infer, copy, or log secrets.",
    "- do not include API keys, tokens, passwords, cookies, credentials, or secret file contents.",
    "",
    "Output JSON shape:",
    JSON.stringify({
      status: "clarified",
      title: "string",
      objective: "string",
      successCriteria: ["string"],
      scope: { in: ["string"], out: ["string"] },
      constraints: ["string"],
      risks: ["string"],
      clarificationQuestions: ["string"],
      confidence: "medium",
    }, null, 2),
  ].join("\n");
}

function findUnsafePlanContent(planSetDraft, goal) {
  const text = JSON.stringify(planSetDraft).toLowerCase();
  const unsafeWrite = [
    /\bmultica\s+issue\s+create\b/,
    /\bissue\s+create\b/,
    /\bmetadata\s+set\b/,
    /\bagent\s+create\b/,
    /\bskill\s+create\b/,
    /\bruntime\s+set\b/,
    /\bwrite\s+metadata\b/,
    /\bexecute\b[^.]{0,80}\bwrite\b/,
    /\brun\b[^.]{0,80}--execute\b/,
    /\bwithout\s+confirmation\b/,
    /\bbypass\b[^.]{0,80}\bconfirmation\b/,
    /\bsilently\s+write\b/,
    /立即.*(写入|创建|应用)/,
    /不经.*确认/,
  ].some((pattern) => pattern.test(text));
  if (unsafeWrite) return "LLM plan requested real writes or bypassed confirmation.";

  const goalText = JSON.stringify(goal ?? {}).toLowerCase();
  const goalAllowsBoundary = /schema|权限边界|permission boundary|permissions boundary|schema/.test(goalText);
  const boundaryChange = /(modify|change|alter|update|rewrite|修改|变更|改动).{0,40}(schema|permission boundary|permissions boundary|权限边界)/.test(text);
  const explicitHumanConfirmation = /(human confirmation|manual confirmation|人工确认|需人工确认|requires confirmation)/.test(text);
  if (boundaryChange && (!goalAllowsBoundary || !explicitHumanConfirmation)) {
    return "LLM plan requested schema or permission-boundary changes without explicit confirmation.";
  }

  return "";
}

function findUnsafeGoalContent(goalDraft) {
  const text = JSON.stringify(goalDraft).toLowerCase();
  const unsafeWrite = [
    /\bmultica\s+issue\s+create\b/,
    /\bissue\s+create\b/,
    /\bmetadata\s+set\b/,
    /\bagent\s+create\b/,
    /\bskill\s+create\b/,
    /\bruntime\s+set\b/,
    /\bwrite\s+metadata\b/,
    /\brun\b[^.]{0,80}--execute\b/,
    /\bwithout\s+confirmation\b/,
    /\bbypass\b[^.]{0,80}\bconfirmation\b/,
    /\bsilently\s+write\b/,
    /立即.*(写入|创建|应用)/,
    /不经.*确认/,
  ].some((pattern) => pattern.test(text));
  if (unsafeWrite) return "LLM goal draft requested real writes or bypassed confirmation.";

  const boundaryChange = /(modify|change|alter|update|rewrite|修改|变更|改动).{0,40}(schema|permission boundary|permissions boundary|权限边界)/.test(text);
  const explicitHumanConfirmation = /(human confirmation|manual confirmation|人工确认|需人工确认|requires confirmation)/.test(text);
  if (boundaryChange && !explicitHumanConfirmation) {
    return "LLM goal draft requested schema or permission-boundary changes without explicit confirmation.";
  }

  if (/sk-[a-z0-9_-]+|bearer\s+[a-z0-9._-]+/i.test(JSON.stringify(goalDraft))) {
    return "LLM goal draft contained secret-looking content.";
  }

  return "";
}

async function readCodexSecretMetadata({ homeDir, readTextFile, pathExists }) {
  const configPath = join(homeDir, ".codex", "config.toml");
  const authPath = join(homeDir, ".codex", "auth.json");
  const metadata = [];
  const configPresent = await pathExists(configPath);
  if (configPresent) {
    const text = await safeReadText(readTextFile, configPath);
    metadata.push(...extractTomlMetadata({
      text,
      provider: "codex",
      sourcePath: configPath,
      allowlist: new Set(["model_provider", "model", "base_url", "wire_api", "requires_openai_auth"]),
    }));
  } else {
    metadata.push(emptyMetadata({
      provider: "codex",
      sourcePath: configPath,
      keyName: "config.toml",
      formatHint: "toml",
    }));
  }

  const authPresent = await pathExists(authPath);
  if (authPresent) {
    const text = await safeReadText(readTextFile, authPath);
    metadata.push(...extractJsonSecretMetadata({
      text,
      provider: "codex",
      sourcePath: authPath,
      allowedKeyNames: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "api_key", "apiKey", "token", "access_token"],
    }));
  } else {
    metadata.push(emptyMetadata({
      provider: "codex",
      sourcePath: authPath,
      keyName: "auth.json",
      formatHint: "json",
    }));
  }

  return metadata;
}

async function readClaudeSecretMetadata({ homeDir, readTextFile, pathExists }) {
  const configDir = join(homeDir, ".claude");
  const settingsPath = join(configDir, "settings.json");
  const metadata = [{
    provider: "claude",
    sourcePathHint: pathHint(configDir),
    keyName: "config_directory",
    present: await pathExists(configDir),
    fingerprint: "",
    lengthRange: "",
    formatHint: "directory",
  }];

  if (await pathExists(settingsPath)) {
    const text = await safeReadText(readTextFile, settingsPath);
    metadata.push(...extractJsonNonSecretMetadata({
      text,
      provider: "claude",
      sourcePath: settingsPath,
      allowedKeyNames: ["model", "defaultModel", "provider", "baseUrl", "base_url"],
    }));
  } else {
    metadata.push(emptyMetadata({
      provider: "claude",
      sourcePath: settingsPath,
      keyName: "settings.json",
      formatHint: "json",
    }));
  }
  return metadata;
}

async function safeReadText(readTextFile, path) {
  try {
    return String(await readTextFile(path, "utf8"));
  } catch {
    return "";
  }
}

function extractTomlMetadata({ text, provider, sourcePath, allowlist }) {
  const entries = [];
  const currentSection = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      currentSection.length = 0;
      currentSection.push(sectionMatch[1]);
      continue;
    }
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!match) continue;
    const bareKey = match[1];
    if (!allowlist.has(bareKey)) continue;
    const keyName = currentSection.length ? `${currentSection[0]}.${bareKey}` : bareKey;
    const value = parseTomlScalar(match[2]);
    entries.push(metadataForValue({
      provider,
      sourcePath,
      keyName,
      value,
      secret: false,
      formatHint: "toml",
    }));
  }
  if (entries.length) return entries;
  return [emptyMetadata({
    provider,
    sourcePath,
    keyName: "config.toml",
    formatHint: "toml",
  })];
}

function parseTomlScalar(rawValue) {
  const value = String(rawValue || "").trim();
  const quoted = value.match(/^"([\s\S]*)"$/) || value.match(/^'([\s\S]*)'$/);
  return quoted ? quoted[1] : value;
}

function extractJsonSecretMetadata({ text, provider, sourcePath, allowedKeyNames }) {
  const parsed = parseJsonOrNull(text);
  if (!parsed) {
    return [emptyMetadata({ provider, sourcePath, keyName: "json", formatHint: "json" })];
  }
  const entries = [];
  collectJsonMetadata(parsed, {
    provider,
    sourcePath,
    allowedKeyNames: new Set(allowedKeyNames),
    secret: true,
    entries,
  });
  if (entries.length) return entries;
  return [emptyMetadata({ provider, sourcePath, keyName: "allowlisted_key", formatHint: "json" })];
}

function extractJsonNonSecretMetadata({ text, provider, sourcePath, allowedKeyNames }) {
  const parsed = parseJsonOrNull(text);
  if (!parsed) {
    return [emptyMetadata({ provider, sourcePath, keyName: "json", formatHint: "json" })];
  }
  const entries = [];
  collectJsonMetadata(parsed, {
    provider,
    sourcePath,
    allowedKeyNames: new Set(allowedKeyNames),
    secret: false,
    entries,
  });
  if (entries.length) return entries;
  return [emptyMetadata({ provider, sourcePath, keyName: "allowlisted_key", formatHint: "json" })];
}

function collectJsonMetadata(value, { provider, sourcePath, allowedKeyNames, secret, entries, path = [] }) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectJsonMetadata(item, { provider, sourcePath, allowedKeyNames, secret, entries, path: [...path, String(index)] });
    });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (allowedKeyNames.has(key) && ["string", "number", "boolean"].includes(typeof item)) {
      entries.push(metadataForValue({
        provider,
        sourcePath,
        keyName: nextPath.join("."),
        value: String(item),
        secret,
        formatHint: "json",
      }));
    }
    if (item && typeof item === "object") {
      collectJsonMetadata(item, { provider, sourcePath, allowedKeyNames, secret, entries, path: nextPath });
    }
  }
}

function metadataForValue({ provider, sourcePath, keyName, value, secret, formatHint }) {
  const stringValue = String(value ?? "");
  return stripEmpty({
    provider,
    sourcePathHint: pathHint(sourcePath),
    keyName,
    present: stringValue.length > 0,
    fingerprint: stringValue ? fingerprintValue(stringValue) : "",
    lengthRange: stringValue ? lengthRange(stringValue.length) : "",
    formatHint: secret ? inferSecretFormatHint(stringValue) : formatHint,
  });
}

function emptyMetadata({ provider, sourcePath, keyName, formatHint }) {
  return stripEmpty({
    provider,
    sourcePathHint: pathHint(sourcePath),
    keyName,
    present: false,
    fingerprint: "",
    lengthRange: "",
    formatHint,
  });
}

function fingerprintValue(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function lengthRange(length) {
  if (length <= 0) return "";
  if (length <= 16) return "1-16";
  if (length <= 32) return "17-32";
  if (length <= 64) return "33-64";
  if (length <= 128) return "65-128";
  return "129+";
}

function inferSecretFormatHint(value) {
  const text = String(value);
  if (/^sk-/.test(text)) return "openai-like";
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) return "jwt-like";
  if (/^Bearer\s+/i.test(text)) return "bearer";
  return "secret";
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function defaultPathExists(path) {
  return access(path, constants.F_OK).then(() => true, () => false);
}

function defaultCommandExists(env) {
  return async (command) => {
    return Boolean(await resolveExecutablePath(command, env));
  };
}

async function defaultGetCommandVersion(command) {
  if (!command) return "";
  try {
    const result = await runCommandArray([command, "--version"], { timeoutMs: 5000 });
    if (result.code !== 0) return "";
    return sanitizeText((result.stdout || result.stderr || "").trim()).split(/\r?\n/)[0] || "";
  } catch {
    return "";
  }
}

function runCommandArray(args, { timeoutMs = DEFAULT_TIMEOUT_MS, stdin = "" } = {}) {
  return new Promise((resolve, reject) => {
    const [rawCommand, ...rawArgs] = args;
    let command = rawCommand;
    let commandArgs = rawArgs;
    const resolved = resolveCommandForSpawn(rawCommand);
    if (resolved) {
      command = resolved.command;
      commandArgs = [...resolved.args, ...rawArgs];
    } else if (rawCommand.endsWith(".js") || rawCommand.endsWith(".mjs")) {
      command = process.execPath;
      commandArgs = [rawCommand, ...rawArgs];
    }
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
    if (stdin) {
      child.stdin.setDefaultEncoding("utf8");
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
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

function resolveCommandForSpawn(command) {
  const resolvedPath = resolveExecutablePathSync(command);
  if (!resolvedPath) return null;
  if (resolvedPath.endsWith(".js") || resolvedPath.endsWith(".mjs")) {
    return { command: process.execPath, args: [resolvedPath] };
  }
  if (process.platform === "win32" && resolvedPath.toLowerCase().endsWith(".ps1")) {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedPath],
    };
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedPath)) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", resolvedPath],
    };
  }
  return { command: resolvedPath, args: [] };
}

async function resolveExecutablePath(command, env = process.env) {
  if (!command) return "";
  if (isAbsolute(command) || command.includes("\\") || command.includes("/")) {
    if (await defaultPathExists(command)) return command;
    for (const candidate of candidateExecutablePaths(command, "")) {
      if (await defaultPathExists(candidate)) return candidate;
    }
    return "";
  }
  const pathValue = env.PATH || env.Path || env.path || "";
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const candidate of candidateExecutablePaths(command, dir)) {
      if (await defaultPathExists(candidate)) return candidate;
    }
  }
  return "";
}

function resolveExecutablePathSync(command) {
  if (!command) return "";
  if (isAbsolute(command) || command.includes("\\") || command.includes("/")) {
    if (existsSync(command)) return command;
    return candidateExecutablePaths(command, "").find(existsSync) || "";
  }
  const pathValue = process.env.PATH || process.env.Path || process.env.path || "";
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    const found = candidateExecutablePaths(command, dir).find(existsSync);
    if (found) return found;
  }
  return "";
}

function candidateExecutablePaths(command, dir) {
  const hasExtension = /\.[^\\/]+$/.test(command);
  const base = dir ? join(dir, command) : command;
  if (hasExtension) return [base];
  const extensions = process.platform === "win32"
    ? [".cmd", ".exe", ".bat", ".ps1", ""]
    : [""];
  return extensions.map((extension) => `${base}${extension}`);
}

function blocked(reason) {
  return { ok: false, blocked: true, reason };
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripEmpty(value) {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== "") out[key] = item;
  }
  return out;
}

function sanitizeText(text) {
  return redactText(text);
}

function redactText(text) {
  return String(text ?? "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(?:api[_-]?key|token|secret|password|credential|cookie)(\s*[:=]\s*)[^\s"'`,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]");
}

function excerpt(text, limit = 400) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
}

function commandBasename(command = "") {
  return String(command).split(/[\\/]/).filter(Boolean).pop() || String(command);
}

function looksLikePath(text = "") {
  return /[\\/]/.test(text) || /^[A-Za-z]:/.test(text);
}

function pathHint(text = "") {
  const clean = redactText(text);
  const parts = clean.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return clean;
  return `...${parts.slice(-2).join("/")}`;
}
