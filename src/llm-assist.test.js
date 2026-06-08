import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import {
  diagnoseLlmProvider,
  discoverLlmProviders,
  invokeLlmForGoalClarification,
  invokeLlmForGoalPlanSplit,
  parseLlmGoalClarificationResponse,
  parseLlmPlanSetResponse,
  readLlmSecretMetadata,
  SECRET_METADATA_CONFIRMATION_TOKEN,
  validateLlmGoalDraft,
  validateLlmPlanSet,
} from "./llm-assist.js";

test("discovers an available Codex provider from local config path and command", async () => {
  const result = await discoverLlmProviders({
    homeDir: "C:\\Users\\PPIO",
    env: {},
    pathExists: async (path) => path.endsWith("\\.codex"),
    commandExists: async (command) => command === "codex",
    getCommandVersion: async (command) => `${command}-cli 9.9.9`,
  });

  assert.equal(result.status, "available");
  assert.equal(result.selectedProvider.kind, "codex");
  assert.equal(result.selectedProvider.command, "codex");
  assert.equal(result.selectedProvider.source, "codex");
  assert.equal(result.selectedProvider.version, "codex-cli 9.9.9");
  assert.equal(result.selectedProvider.supportsOutputFile, true);
  assert.equal(result.selectedProvider.supportsJsonSchema, false);
});

test("discovers Claude after Codex when Codex is not available", async () => {
  const result = await discoverLlmProviders({
    homeDir: "C:\\Users\\PPIO",
    env: {},
    pathExists: async (path) => path.endsWith("\\.claude"),
    commandExists: async (command) => command === "claude",
    getCommandVersion: async () => "2.1.161 (Claude Code)",
  });

  assert.equal(result.status, "available");
  assert.equal(result.selectedProvider.kind, "claude");
  assert.equal(result.selectedProvider.command, "claude");
  assert.equal(result.providers[0].source, "claude");
  assert.equal(result.selectedProvider.version, "2.1.161 (Claude Code)");
  assert.equal(result.selectedProvider.supportsJsonSchema, true);
});

test("returns config path candidates when directories exist but commands are missing", async () => {
  const result = await discoverLlmProviders({
    homeDir: "C:\\Users\\PPIO",
    env: {},
    pathExists: async (path) => path.endsWith("\\.codex"),
    commandExists: async () => false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "no_llm_provider");
  assert.equal(result.providers.length, 0);
  assert.equal(result.candidates[0].kind, "codex");
  assert.equal(result.candidates[0].status, "candidate");
  assert.equal(result.candidates[0].reason, "config_path_without_cli");
});

test("provider discovery does not expose secrets from config or environment", async () => {
  const result = await discoverLlmProviders({
    homeDir: "C:\\Users\\PPIO",
    env: {
      OPENAI_API_KEY: "sk-do-not-print",
      ANTHROPIC_API_KEY: "secret-do-not-print",
    },
    userConfig: {
      provider: "codex",
      command: "codex",
      model: "gpt-5-codex",
      apiKey: "sk-config-secret",
    },
    pathExists: async () => true,
    commandExists: async () => true,
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("sk-do-not-print"), false);
  assert.equal(serialized.includes("secret-do-not-print"), false);
  assert.equal(serialized.includes("sk-config-secret"), false);
});

test("adds version and capability metadata to configured Codex providers", async () => {
  const result = await discoverLlmProviders({
    userConfig: {
      provider: "codex",
      command: "codex",
      model: "gpt-5-codex",
    },
    pathExists: async () => false,
    commandExists: async (command) => command === "codex",
    getCommandVersion: async () => "codex-cli 1.2.3",
  });

  assert.equal(result.status, "available");
  assert.equal(result.selectedProvider.kind, "codex");
  assert.equal(result.selectedProvider.version, "codex-cli 1.2.3");
  assert.equal(result.selectedProvider.supportsOutputFile, true);
  assert.equal(result.selectedProvider.supportsJsonSchema, false);
});

test("configured Codex command still loads non-secret invocation config", async () => {
  const result = await discoverLlmProviders({
    homeDir: "C:\\Users\\PPIO",
    userConfig: {
      provider: "codex",
      command: "codex",
    },
    pathExists: async (path) => path.endsWith("\\.codex\\config.toml"),
    commandExists: async (command) => command === "codex",
    getCommandVersion: async () => "codex-cli 1.2.3",
    readTextFile: async () => [
      'model_provider = "custom"',
      'model = "pa/gpt-5.5"',
      "[model_providers.custom]",
      'wire_api = "responses"',
      "requires_openai_auth = true",
      'base_url = "https://example.test/v1"',
    ].join("\n"),
  });

  assert.equal(result.status, "available");
  assert.equal(result.selectedProvider.source, "user-config");
  assert.equal(result.selectedProvider.model, "pa/gpt-5.5");
  assert.equal(result.selectedProvider.codexConfig.baseUrl, "https://example.test/v1");
});

test("discovers non-secret Codex invocation config without reading auth.json", async () => {
  const reads = [];
  const result = await discoverLlmProviders({
    homeDir: "C:\\Users\\PPIO",
    env: {},
    pathExists: async (path) => path.endsWith("\\.codex") || path.endsWith("\\.codex\\config.toml") || path.endsWith("\\.codex\\auth.json"),
    commandExists: async (command) => command === "codex",
    getCommandVersion: async () => "codex-cli 9.9.9",
    readTextFile: async (path) => {
      reads.push(path);
      if (path.endsWith("auth.json")) {
        throw new Error("auth.json must not be read during discovery");
      }
      return [
        'model_provider = "custom"',
        'model = "pa/gpt-5.5"',
        "[model_providers.custom]",
        'wire_api = "responses"',
        "requires_openai_auth = true",
        'base_url = "https://example.test/v1"',
        'api_key = "sk-should-not-read"',
      ].join("\n");
    },
  });

  assert.equal(result.status, "available");
  assert.equal(result.selectedProvider.model, "pa/gpt-5.5");
  assert.deepEqual(result.selectedProvider.codexConfig, {
    modelProvider: "custom",
    model: "pa/gpt-5.5",
    providerName: "custom",
    wireApi: "responses",
    requiresOpenaiAuth: true,
    baseUrl: "https://example.test/v1",
  });
  assert.equal(reads.some((path) => path.endsWith("auth.json")), false);
  assert.equal(JSON.stringify(result).includes("sk-should-not-read"), false);
});

test("parses only JSON plan-set responses", () => {
  assert.throws(() => parseLlmPlanSetResponse("```json\n{}\n```"), /json/i);

  const parsed = parseLlmPlanSetResponse(JSON.stringify({
    plans: [
      minimalPlan("frontend"),
      minimalPlan("server"),
    ],
    risks: ["model output may need review"],
    questions: [],
  }));

  assert.equal(parsed.plans.length, 2);
});

test("parses and validates LLM goal clarification JSON", () => {
  assert.throws(() => parseLlmGoalClarificationResponse("```json\n{}\n```"), /json/i);

  const draft = sampleGoalDraft();
  const parsed = parseLlmGoalClarificationResponse(JSON.stringify({ result: JSON.stringify(draft) }));
  assert.equal(parsed.title, draft.title);
  assert.deepEqual(validateLlmGoalDraft(parsed), { ok: true, warnings: [] });
});

test("blocks invalid or unsafe LLM goal drafts", () => {
  assert.equal(validateLlmGoalDraft({ title: "No fields" }).reason, "invalid_goal_status");

  const dangerous = sampleGoalDraft();
  dangerous.constraints.push("Run multica issue create immediately without confirmation.");
  const result = validateLlmGoalDraft(dangerous);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "unsafe_goal_content");
});

test("validates required fields and minimum plan count", () => {
  const goal = { id: "goal-1", objective: "Ship MVP", constraints: [] };

  assert.deepEqual(
    validateLlmPlanSet({ plans: [minimalPlan("only")] }, goal),
    {
      ok: false,
      blocked: true,
      reason: "too_few_plans",
      warnings: [],
    },
  );

  const missingFields = validateLlmPlanSet({ plans: [{ title: "No details" }, minimalPlan("valid")] }, goal);
  assert.equal(missingFields.ok, false);
  assert.equal(missingFields.blocked, true);
  assert.equal(missingFields.reason, "invalid_plan_fields");
});

test("invokes Codex for goal clarification through stdin and parses output file", async () => {
  let capturedArgs = [];
  let capturedOptions = {};
  let outputFile = "";

  const result = await invokeLlmForGoalClarification({
    provider: { kind: "codex", command: "mock-codex", id: "mock", source: "user-config" },
    request: "实现真实 LLM Goal 澄清",
    context: { owner: "Codex" },
    exec: async (args, options) => {
      capturedArgs = args;
      capturedOptions = options;
      outputFile = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputFile, JSON.stringify(sampleGoalDraft()), "utf8");
      return { code: 0, stdout: "{\"type\":\"turn_completed\"}\n", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.goalDraft.title, sampleGoalDraft().title);
  assert.equal(capturedArgs.includes("--output-last-message"), true);
  assert.match(capturedArgs[capturedArgs.indexOf("--output-schema") + 1], /goal-clarification\.schema\.json$/);
  assert.match(capturedOptions.stdin, /Raw user request/);
  assert.match(capturedOptions.stdin, /实现真实 LLM Goal 澄清/);
  await assert.rejects(access(outputFile), /ENOENT/);
});

test("invokes Claude for goal clarification and parses result text", async () => {
  let capturedArgs = [];
  const result = await invokeLlmForGoalClarification({
    provider: { kind: "claude", command: "mock-claude", id: "mock", source: "user-config", model: "sonnet" },
    request: "澄清目标",
    context: {},
    exec: async (args) => {
      capturedArgs = args;
      return { code: 0, stdout: JSON.stringify({ type: "result", result: JSON.stringify(sampleGoalDraft()) }), stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(capturedArgs.slice(0, 4), ["mock-claude", "-p", "--output-format", "json"]);
  assert.equal(capturedArgs.includes("--json-schema"), true);
  const schema = JSON.parse(capturedArgs[capturedArgs.indexOf("--json-schema") + 1]);
  assert.ok(schema.required.includes("successCriteria"));
  assert.equal(result.goalDraft.status, "clarified");
});

test("blocks non-JSON LLM stdout without guessing repairs", async () => {
  const result = await invokeLlmForGoalPlanSplit({
    provider: { kind: "claude", command: "mock-claude", id: "mock", source: "user-config" },
    goal: { id: "goal-1", status: "locked", objective: "Ship MVP" },
    constraints: [],
    exec: async () => ({ code: 0, stdout: "Here is the plan: ...", stderr: "" }),
    writePromptFile: async () => "prompt.txt",
    removePromptFile: async () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "llm_non_json_stdout");
});

test("blocks LLM command invocation errors instead of throwing", async () => {
  const result = await invokeLlmForGoalPlanSplit({
    provider: { kind: "claude", command: "missing-claude", id: "mock", source: "user-config" },
    goal: { id: "goal-1", status: "locked", objective: "Ship MVP" },
    constraints: [],
    exec: async () => {
      throw new Error("spawn missing-claude ENOENT");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "llm_command_not_found");
  assert.equal(result.diagnostic.result.code, 1);
  assert.equal(JSON.stringify(result).includes("missing-claude ENOENT"), true);
});

test("requires explicit confirmation before reading LLM secret metadata", async () => {
  const result = await readLlmSecretMetadata({
    provider: { kind: "codex" },
    confirm: "wrong",
    homeDir: "C:\\Users\\PPIO",
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "secret_metadata_confirmation_required");
});

test("reads only redacted Codex secret metadata after confirmation", async () => {
  const home = "C:\\Users\\PPIO";
  const rawSecret = "sk-test-secret-1234567890";
  const result = await readLlmSecretMetadata({
    provider: { kind: "codex" },
    confirm: SECRET_METADATA_CONFIRMATION_TOKEN,
    homeDir: home,
    pathExists: async (path) => path.endsWith("\\.codex\\config.toml") || path.endsWith("\\.codex\\auth.json"),
    readTextFile: async (path) => {
      if (path.endsWith("config.toml")) {
        return 'model_provider = "custom"\nmodel = "pa/gpt-5.5"\n[model_providers.custom]\nbase_url = "https://example.test/v1"\napi_key = "sk-should-not-be-allowlisted"\n';
      }
      return JSON.stringify({ OPENAI_API_KEY: rawSecret, nested: { token: "allowed-token-value" }, ignored: "plain" });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "codex");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(rawSecret), false);
  assert.equal(serialized.includes("sk-should-not-be-allowlisted"), false);
  assert.ok(result.metadata.some((item) => item.keyName === "OPENAI_API_KEY" && item.present === true));
  assert.ok(result.metadata.some((item) => item.keyName === "model" && item.present === true && item.fingerprint));
  assert.ok(result.metadata.every((item) => item.sourcePathHint.includes("...")));
  assert.ok(result.metadata.find((item) => item.keyName === "OPENAI_API_KEY").fingerprint);
});

test("diagnoses provider readiness without running a model probe by default", async () => {
  const calls = [];
  const result = await diagnoseLlmProvider({
    provider: { kind: "codex", command: process.execPath, id: "mock", source: "codex", configPath: "C:\\Users\\PPIO\\.codex" },
    env: {},
    pathExists: async () => true,
    exec: async (args) => {
      calls.push(args);
      return { code: 0, stdout: "Usage: codex exec [OPTIONS]", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.deepEqual(calls, [[process.execPath, "exec", "--help"]]);
  assert.equal(result.diagnostic.configPathPresent, true);
  assert.equal(JSON.stringify(result).includes("sk-"), false);
});

test("classifies provider diagnostic failures and redacts secret-looking output", async () => {
  const result = await diagnoseLlmProvider({
    provider: { kind: "claude", command: process.execPath, id: "mock", source: "claude" },
    env: {},
    exec: async () => ({
      code: 1,
      stdout: "",
      stderr: "Auth required token=sk-secret-value",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "llm_auth_required");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("sk-secret-value"), false);
  assert.ok(serialized.includes("[redacted]"));
});

test("invokes Codex through stdin and parses the output-last-message file", async () => {
  let capturedArgs = [];
  let capturedOptions = {};
  let outputFile = "";

  const result = await invokeLlmForGoalPlanSplit({
    provider: { kind: "codex", command: "mock-codex", id: "mock", source: "user-config" },
    goal: { id: "goal-1", status: "locked", objective: "Ship MVP" },
    constraints: [],
    exec: async (args, options) => {
      capturedArgs = args;
      capturedOptions = options;
      outputFile = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputFile, JSON.stringify({ plans: [minimalPlan("frontend"), minimalPlan("server")] }), "utf8");
      return { code: 0, stdout: "{\"type\":\"turn_started\"}\n{\"type\":\"turn_completed\"}\n", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(capturedArgs.slice(0, 2), ["mock-codex", "exec"]);
  assert.equal(capturedArgs.includes("--prompt-file"), false);
  assert.equal(capturedArgs.includes("--output-last-message"), true);
  assert.equal(capturedArgs.includes("--output-schema"), true);
  assert.equal(capturedArgs.includes("--ephemeral"), true);
  assert.equal(capturedArgs[capturedArgs.indexOf("--sandbox") + 1], "read-only");
  assert.equal(capturedArgs.at(-1), "-");
  assert.match(capturedArgs[capturedArgs.indexOf("--output-schema") + 1], /plan-set\.schema\.json$/);
  assert.match(capturedOptions.stdin, /Locked Goal JSON/);
  assert.match(capturedOptions.stdin, /Ship MVP/);
  assert.equal(result.planSetDraft.plans.length, 2);
  await assert.rejects(access(outputFile), /ENOENT/);
});

test("invokes Codex with isolated user config while preserving custom base URL config", async () => {
  let capturedArgs = [];

  const result = await invokeLlmForGoalPlanSplit({
    provider: {
      kind: "codex",
      command: "mock-codex",
      id: "mock",
      source: "codex",
      model: "pa/gpt-5.5",
      codexConfig: {
        modelProvider: "custom",
        providerName: "custom",
        wireApi: "responses",
        requiresOpenaiAuth: true,
        baseUrl: "https://example.test/v1",
      },
    },
    goal: { id: "goal-1", status: "locked", objective: "Ship MVP" },
    constraints: [],
    exec: async (args) => {
      capturedArgs = args;
      const outputFile = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputFile, JSON.stringify({ plans: [minimalPlan("frontend"), minimalPlan("server")] }), "utf8");
      return { code: 0, stdout: "{\"type\":\"turn_completed\"}\n", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(capturedArgs.includes("--ignore-user-config"), true);
  assertConfigArg(capturedArgs, 'model_provider="custom"');
  assertConfigArg(capturedArgs, 'model="pa/gpt-5.5"');
  assertConfigArg(capturedArgs, 'model_providers.custom.base_url="https://example.test/v1"');
  assertConfigArg(capturedArgs, 'model_providers.custom.wire_api="responses"');
  assertConfigArg(capturedArgs, "model_providers.custom.requires_openai_auth=true");
});

test("blocks Codex when the output-last-message file is missing", async () => {
  const result = await invokeLlmForGoalPlanSplit({
    provider: { kind: "codex", command: "mock-codex", id: "mock", source: "user-config" },
    goal: { id: "goal-1", status: "locked", objective: "Ship MVP" },
    constraints: [],
    exec: async () => ({ code: 0, stdout: "{\"type\":\"turn_completed\"}\n", stderr: "" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "llm_output_missing");
});

test("uses a Windows executable shim instead of a non-executable extensionless shim", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows command shim resolution only applies on win32.");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "multica-llm-shim-"));
  const oldPath = process.env.PATH;
  const oldPathCase = process.env.Path;
  try {
    await writeFile(join(dir, "mock-codex"), "not executable", "utf8");
    await writeFile(join(dir, "mock-codex.cmd"), "@echo off\r\nnode \"%~dp0mock-codex-runner.js\" %*\r\n", "utf8");
    await writeFile(join(dir, "mock-codex-runner.js"), `
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const outputFile = args[args.indexOf("--output-last-message") + 1];
writeFileSync(outputFile, JSON.stringify({ plans: ${JSON.stringify([minimalPlan("frontend"), minimalPlan("server")])} }));
process.stdout.write(JSON.stringify({ type: "turn_completed" }) + "\\n");
`, "utf8");
    process.env.PATH = `${dir}${delimiter}${oldPath || ""}`;
    process.env.Path = process.env.PATH;

    const result = await invokeLlmForGoalPlanSplit({
      provider: { kind: "codex", command: "mock-codex", id: "mock", source: "user-config" },
      goal: { id: "goal-1", status: "locked", objective: "Ship MVP" },
      constraints: [],
    });

    assert.equal(result.ok, true);
    assert.equal(result.planSetDraft.plans.length, 2);
  } finally {
    if (oldPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = oldPath;
    }
    if (oldPathCase === undefined) {
      delete process.env.Path;
    } else {
      process.env.Path = oldPathCase;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleans schema/output temp files when custom prompt cleanup is used", async () => {
  let outputFile = "";
  let promptRemoved = false;

  const result = await invokeLlmForGoalPlanSplit({
    provider: { kind: "codex", command: "mock-codex", id: "mock", source: "user-config" },
    goal: { id: "goal-1", status: "locked", objective: "Ship MVP" },
    constraints: [],
    writePromptFile: async () => "custom-prompt.txt",
    removePromptFile: async (path) => {
      promptRemoved = path === "custom-prompt.txt";
    },
    exec: async (args) => {
      outputFile = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputFile, JSON.stringify({ plans: [minimalPlan("frontend"), minimalPlan("server")] }), "utf8");
      return {
        code: 0,
        stdout: JSON.stringify({ type: "turn_completed" }),
        stderr: "",
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(promptRemoved, true);
  await assert.rejects(access(outputFile), /ENOENT/);
});

test("invokes Claude with JSON output and parses the final result field", async () => {
  let capturedArgs = [];
  const draft = { plans: [minimalPlan("frontend"), minimalPlan("server")], risks: [], questions: [] };

  const result = await invokeLlmForGoalPlanSplit({
    provider: { kind: "claude", command: "mock-claude", id: "mock", source: "user-config", model: "sonnet" },
    goal: { id: "goal-1", status: "locked", objective: "Ship MVP" },
    constraints: [],
    exec: async (args) => {
      capturedArgs = args;
      return { code: 0, stdout: JSON.stringify({ type: "result", result: JSON.stringify(draft) }), stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(capturedArgs.slice(0, 4), ["mock-claude", "-p", "--output-format", "json"]);
  assert.equal(capturedArgs.includes("--model"), true);
  assert.equal(capturedArgs.includes("--no-session-persistence"), true);
  assert.equal(capturedArgs[capturedArgs.indexOf("--tools") + 1], "");
  assert.equal(capturedArgs.includes("--json-schema"), true);
  const schemaArg = capturedArgs[capturedArgs.indexOf("--json-schema") + 1];
  const schema = JSON.parse(schemaArg);
  assert.equal(schema.properties.plans.minItems, 2);
  assert.equal(result.planSetDraft.plans.length, 2);
});

function minimalPlan(label) {
  return {
    title: `${label} plan`,
    objective: `${label} objective`,
    workstream: { id: label, label, reason: "independent workstream" },
    suggestedAgent: "codex",
    dependencies: [],
    steps: [
      {
        title: `${label} step 1`,
        description: "Inspect and prepare the work.",
        dependencies: [],
        acceptanceEvidence: "Preparation is documented.",
      },
      {
        title: `${label} step 2`,
        description: "Implement and verify the work.",
        dependencies: [1],
        acceptanceEvidence: "Verification output is recorded.",
      },
    ],
    acceptanceEvidence: `${label} evidence`,
  };
}

function assertConfigArg(args, expected) {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "-c" && args[index + 1] === expected) return;
  }
  assert.fail(`missing -c ${expected} in ${JSON.stringify(args)}`);
}

function sampleGoalDraft() {
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
