#!/usr/bin/env node
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import {
  buildRuntimeAgentSpecFromMultica,
  buildRuntimeAgentSpec,
  createLedgerStore,
  renderDegradationMarkdown,
  renderLaunchReviewMarkdown,
} from "./launch-review.js";
import { createMulticaClient } from "./multica-client.js";
import {
  applyAgentConfigPlan,
  buildImage2AgentConfigPlan,
  buildAgentConfigPlan,
  discoverMulticaEnvironment,
  renderAgentConfigPlanMarkdown,
} from "./agent-config.js";
import {
  applyIssueSplit,
  generatePlanFromGoal,
  lockGoalDraft,
  normalizeGoal,
  normalizeGoalWithAgent,
  normalizeGoalWithLlm,
  previewIssueSplitFromPlanSet,
  previewIssueSplit,
  renderGoalPlanMarkdown,
  splitGoalIntoPlansDeterministic,
  splitGoalIntoPlansWithAgent,
  splitGoalIntoPlansWithLlm,
} from "./goal-plan.js";
import { diagnoseLlmProvider, discoverLlmProviders, readLlmSecretMetadata } from "./llm-assist.js";
import {
  diagnoseAssistAgents,
  discoverAssistAgents,
  selectAssistAgent,
} from "./multica-agent-assist.js";

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0]?.startsWith("-") ? "generate" : (argv.shift() ?? "generate");
  const args = parseArgs(argv);
  if (command === "lock") {
    if (args.help) {
      printHelp(command);
      process.exit(0);
    }
    await lockLedger(args);
    return;
  }
  if (command === "list") {
    if (args.help) {
      printHelp(command);
      process.exit(0);
    }
    await listLedger(args);
    return;
  }
  if (command === "from-multica") {
    if (args.help || !args.issueId) {
      printHelp(command);
      process.exit(args.help ? 0 : 1);
    }
    await generateFromMultica(args);
    return;
  }
  if (command === "agent-config") {
    await handleAgentConfig(args);
    return;
  }
  if (command === "goal") {
    await handleGoal(args);
    return;
  }
  if (command === "llm") {
    await handleLlm(args);
    return;
  }
  if (command === "assist") {
    await handleAssist(args);
    return;
  }
  if (command === "plan") {
    await handlePlan(args);
    return;
  }
  if (command !== "generate") {
    throw new Error(`unknown command: ${command}`);
  }
  if (args.help || !args.input) {
    printHelp(command);
    process.exit(args.help ? 0 : 1);
  }

  const payload = JSON.parse(await readFile(args.input, "utf8"));
  const spec = buildRuntimeAgentSpec(payload);
  const review = renderLaunchReviewMarkdown(spec);

  if (args.specOut) {
    await writeArtifact(args.specOut, JSON.stringify(spec, null, 2) + "\n");
  }
  if (args.reviewOut) {
    await writeArtifact(args.reviewOut, review);
  }
  if (args.ledger) {
    await createLedgerStore(args.ledger).recordDraft(spec);
  }

  if (!args.specOut && !args.reviewOut) {
    process.stdout.write(review);
  }
}

async function generateFromMultica(args) {
  const repos = Array.isArray(args.repo) ? args.repo.map((url) => ({ url })) : [];
  const result = await buildRuntimeAgentSpecFromMultica({
    client: createMulticaClient({ cliPath: args.cliPath }),
    issueId: args.issueId,
    agentId: args.agentId,
    workspace: {
      id: args.workspaceId,
      name: args.workspaceName,
      repos,
    },
    task: buildTaskArgs(args),
    permissions: {
      tokenType: args.tokenType,
      ttlMinutes: args.ttlMinutes,
      scopes: args.scope,
    },
    plan: args.plan,
  });
  const degradation = renderDegradationMarkdown(result);
  const review = [renderLaunchReviewMarkdown(result.spec), degradation].filter(Boolean).join("\n");
  writeDegradationToStderr(result);

  if (args.specOut) {
    await writeArtifact(args.specOut, JSON.stringify(result.spec, null, 2) + "\n");
  }
  if (args.reviewOut) {
    await writeArtifact(args.reviewOut, review);
  }
  if (args.ledger) {
    await createLedgerStore(args.ledger).recordDraft(result.spec);
  }

  if (!args.specOut && !args.reviewOut) {
    process.stdout.write(review);
  }
}

async function handleAgentConfig(args) {
  const action = args._?.[0] ?? "plan";
  if (args.help) {
    printHelp(`agent-config:${action}`);
    process.exit(0);
  }

  const environment = await discoverMulticaEnvironment({
    cliPath: args.cliPath,
    workspaceName: args.workspaceName,
    projectTitle: args.projectTitle,
    sourceAgentName: args.sourceAgentName,
  });

  if (action === "discover") {
    writeJsonOrText(environment, args.output);
    return;
  }

  const plan = args.preset === "image2"
    ? buildImage2AgentConfigPlan({
      environment,
      skillPath: args.skillPath,
    })
    : buildAgentConfigPlan({
      environment,
      presetId: args.preset,
      mode: args.mode,
    });

  if (args.planOut) {
    await writeArtifact(args.planOut, JSON.stringify(plan, null, 2) + "\n");
  }
  if (args.reviewOut) {
    await writeArtifact(args.reviewOut, renderAgentConfigPlanMarkdown(plan));
  }

  if (action === "plan") {
    if (!args.planOut && !args.reviewOut) {
      writeJsonOrText(args.output === "json" ? plan : renderAgentConfigPlanMarkdown(plan), args.output);
    }
    return;
  }

  if (action !== "apply") {
    throw new Error(`unknown agent-config action: ${action}`);
  }

  const result = await applyAgentConfigPlan({
    plan,
    cliPath: args.cliPath,
    execute: Boolean(args.execute),
    confirm: args.confirm,
  });
  writeJsonOrText(result, args.output);
}

async function handleGoal(args) {
  const action = args._?.[0] ?? "normalize";
  if (args.help) {
    printHelp(`goal:${action}`);
    process.exit(0);
  }
  if (action === "normalize") {
    requireArg(args.input, "--input");
    const payload = JSON.parse(await readFile(args.input, "utf8"));
    if (args.agent || args.llm) {
      const goal = await normalizeGoalViaAssistAgent({ payload, args });
      if (goal?.blocked) {
        writeJsonOrText(goal, args.output);
        process.exitCode = 1;
        return;
      }
      if (args.goalOut) {
        await writeArtifact(args.goalOut, JSON.stringify(goal, null, 2) + "\n");
      }
      if (!args.goalOut || args.output === "json") {
        writeJsonOrText(withCompatibilityWarning(goal, args), args.output);
      }
      return;
    }
    if (args.llmDirect) {
      const discovery = await discoverLlmProviders({
        userConfig: buildLlmUserConfig(args),
      });
      if (!discovery.selectedProvider) {
        const blocked = {
          ok: false,
          blocked: true,
          reason: "no_llm_provider",
          candidates: discovery.candidates ?? [],
        };
        writeJsonOrText(blocked, args.output);
        process.exitCode = 1;
        return;
      }
      const goal = await normalizeGoalWithLlm({
        request: payload.request,
        context: { ...(payload.context ?? {}), language: normalizeCliLanguage(args, payload) },
        provider: discovery.selectedProvider,
        language: normalizeCliLanguage(args, payload),
      });
      if (goal?.blocked) {
        writeJsonOrText(goal, args.output);
        process.exitCode = 1;
        return;
      }
      if (args.goalOut) {
        await writeArtifact(args.goalOut, JSON.stringify(goal, null, 2) + "\n");
      }
      if (!args.goalOut || args.output === "json") {
        writeJsonOrText(goal, args.output);
      }
      return;
    }
    const goal = normalizeGoal({
      ...payload,
      context: { ...(payload.context ?? {}), language: normalizeCliLanguage(args, payload) },
      language: normalizeCliLanguage(args, payload),
    });
    if (args.goalOut) {
      await writeArtifact(args.goalOut, JSON.stringify(goal, null, 2) + "\n");
    }
    if (!args.goalOut || args.output === "json") {
      writeJsonOrText(goal, args.output);
    }
    return;
  }
  if (action === "lock") {
    requireArg(args.input, "--input");
    const goal = JSON.parse(await readFile(args.input, "utf8"));
    const locked = lockGoalDraft(goal, { approvedBy: args.approvedBy });
    if (args.goalOut) {
      await writeArtifact(args.goalOut, JSON.stringify(locked, null, 2) + "\n");
    }
    if (!args.goalOut || args.output === "json") {
      writeJsonOrText(locked, args.output);
    }
    return;
  }
  throw new Error(`unknown goal action: ${action}`);
}

async function normalizeGoalViaAssistAgent({ payload, args }) {
  const discovery = await discoverAssistAgents({
    cliPath: args.cliPath,
    exec: args.__exec,
    commandTimeoutMs: args.commandTimeoutMs,
  });
  const selection = selectAssistAgent({
    agents: discovery.agents ?? [],
    preferredAgentId: args.agentId,
    mode: args.agentSelectionMode || (args.agentId ? "manual" : "auto"),
  });
  if (!discovery.ok || !selection.ok) {
    return {
      ok: false,
      blocked: true,
      reason: discovery.ok ? (selection.reason || "no_assist_agent") : (discovery.reason || "multica_cli_failed"),
      agents: discovery.agents ?? [],
      daemon: discovery.daemon,
      diagnostic: discovery.diagnostic,
      warnings: compatibilityWarnings(args),
    };
  }
  const goal = await normalizeGoalWithAgent({
    request: payload.request,
    context: { ...(payload.context ?? {}), language: normalizeCliLanguage(args, payload) },
    agent: selection.selectedAgent,
    language: normalizeCliLanguage(args, payload),
    cliPath: args.cliPath,
    exec: args.__exec,
    timeoutMs: args.assistTimeoutMs,
  });
  if (goal?.blocked) {
    goal.warnings = [...(goal.warnings ?? []), ...compatibilityWarnings(args)];
  }
  return goal;
}

async function handleLlm(args) {
  const action = args._?.[0] ?? "discover";
  if (args.help) {
    printHelp(`llm:${action}`);
    process.exit(0);
  }
  if (!["discover", "diagnose", "secret-metadata"].includes(action)) {
    throw new Error(`unknown llm action: ${action}`);
  }
  if (action === "secret-metadata") {
    const config = buildLlmUserConfig(args);
    const result = await readLlmSecretMetadata({
      provider: {
        kind: config.provider || "codex",
        provider: config.provider || "codex",
        command: config.command,
        model: config.model,
        source: config.provider || config.command ? "user-config" : "default",
      },
      confirm: args.confirm,
    });
    writeJsonOrText(result, args.output);
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }
  const discovery = await discoverLlmProviders({
    userConfig: buildLlmUserConfig(args),
  });
  if (action === "discover") {
    writeJsonOrText(discovery, args.output);
    return;
  }
  if (!discovery.selectedProvider) {
    writeJsonOrText({
      ok: false,
      blocked: true,
      reason: "no_llm_provider",
      candidates: discovery.candidates ?? [],
    }, args.output);
    process.exitCode = 1;
    return;
  }
  const diagnosis = await diagnoseLlmProvider({
    provider: discovery.selectedProvider,
    probe: Boolean(args.probe),
    timeoutMs: args.llmTimeoutMs,
  });
  writeJsonOrText({
    ok: diagnosis.ok,
    status: diagnosis.status,
    blocked: diagnosis.blocked,
    reason: diagnosis.reason,
    provider: discovery.selectedProvider,
    diagnostic: diagnosis.diagnostic,
  }, args.output);
  if (!diagnosis.ok) {
    process.exitCode = 1;
  }
}

async function handleAssist(args) {
  const action = args._?.[0] ?? "agents";
  if (args.help) {
    printHelp(`assist:${action}`);
    process.exit(0);
  }
  if (!["agents", "diagnose"].includes(action)) {
    throw new Error(`unknown assist action: ${action}`);
  }
  const result = action === "diagnose"
    ? await diagnoseAssistAgents({ cliPath: args.cliPath })
    : await discoverAssistAgents({ cliPath: args.cliPath });
  writeJsonOrText(result, args.output);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function handlePlan(args) {
  const action = args._?.[0] ?? "generate";
  if (args.help) {
    printHelp(`plan:${action}`);
    process.exit(0);
  }
  if (action === "generate") {
    requireArg(args.input, "--input");
    const goal = JSON.parse(await readFile(args.input, "utf8"));
    const plan = generatePlanFromGoal({
      goal,
      complexity: args.complexity,
      language: normalizeCliLanguage(args, goal),
    });
    if (args.planOut) {
      await writeArtifact(args.planOut, JSON.stringify(plan, null, 2) + "\n");
    }
    if (!args.planOut || args.output === "json") {
      writeJsonOrText(plan, args.output);
    }
    return;
  }
  if (action === "split") {
    requireArg(args.input, "--input");
    const goal = JSON.parse(await readFile(args.input, "utf8"));
    if (args.agent || args.llm) {
      const planSet = await splitPlanViaAssistAgent({ goal, args });
      if (planSet?.blocked) {
        writeJsonOrText(planSet, args.output);
        process.exitCode = 1;
        return;
      }
      if (args.planSetOut) {
        await writeArtifact(args.planSetOut, JSON.stringify(planSet, null, 2) + "\n");
      }
      if (!args.planSetOut || args.output === "json") {
        writeJsonOrText(withCompatibilityWarning(planSet, args), args.output);
      }
      return;
    }
    if (args.llmDirect) {
      const discovery = await discoverLlmProviders({
        userConfig: buildLlmUserConfig(args),
      });
      if (!discovery.selectedProvider) {
        const payload = {
          ok: false,
          blocked: true,
          reason: "no_llm_provider",
          candidates: discovery.candidates ?? [],
        };
        writeJsonOrText(payload, args.output);
        process.exitCode = 1;
        return;
      }
      const planSet = await splitGoalIntoPlansWithLlm({
        goal,
        provider: discovery.selectedProvider,
        language: normalizeCliLanguage(args, goal),
      });
      if (planSet?.blocked) {
        writeJsonOrText(planSet, args.output);
        process.exitCode = 1;
        return;
      }
      if (args.planSetOut) {
        await writeArtifact(args.planSetOut, JSON.stringify(planSet, null, 2) + "\n");
      }
      if (!args.planSetOut || args.output === "json") {
        writeJsonOrText(planSet, args.output);
      }
      return;
    }

    const planSet = splitGoalIntoPlansDeterministic({ goal, language: normalizeCliLanguage(args, goal) });
    if (args.planSetOut) {
      await writeArtifact(args.planSetOut, JSON.stringify(planSet, null, 2) + "\n");
    }
    if (!args.planSetOut || args.output === "json") {
      writeJsonOrText(planSet, args.output);
    }
    return;
  }
  if (action === "preview-issues") {
    requireArg(args.goal, "--goal");
    const goal = JSON.parse(await readFile(args.goal, "utf8"));
    if (args.plan && args.planSet) {
      throw new Error("use either --plan or --plan-set, not both");
    }
    if (!args.plan && !args.planSet) {
      throw new Error("missing required argument: --plan or --plan-set");
    }
    let plan;
    let planSet;
    let issueSplit;
    if (args.planSet) {
      planSet = JSON.parse(await readFile(args.planSet, "utf8"));
      issueSplit = previewIssueSplitFromPlanSet({
        goal,
        planSet,
        projectId: args.projectId,
        priority: args.priority,
        language: normalizeCliLanguage(args, planSet || goal),
      });
    } else {
      const planPath = Array.isArray(args.plan) ? args.plan.at(-1) : args.plan;
      plan = JSON.parse(await readFile(planPath, "utf8"));
      issueSplit = previewIssueSplit({
        goal,
        plan,
        projectId: args.projectId,
        priority: args.priority,
        language: normalizeCliLanguage(args, plan || goal),
      });
    }
    if (args.issueSplitOut) {
      await writeArtifact(args.issueSplitOut, JSON.stringify(issueSplit, null, 2) + "\n");
    }
    if (args.reviewOut) {
      await writeArtifact(args.reviewOut, renderGoalPlanMarkdown({ goal, plan: plan ?? planSet, issueSplit, language: normalizeCliLanguage(args, issueSplit || planSet || plan || goal) }));
    }
    if ((!args.issueSplitOut && !args.reviewOut) || args.output === "json") {
      writeJsonOrText(issueSplit, args.output);
    }
    return;
  }
  if (action === "apply-issues") {
    requireArg(args.issueSplit, "--issue-split");
    const issueSplit = JSON.parse(await readFile(args.issueSplit, "utf8"));
    const result = await applyIssueSplitFromCli({
      issueSplit,
      cliPath: args.cliPath,
      execute: Boolean(args.execute),
      confirm: args.confirm,
    });
    if (args.auditPath) {
      await appendIssueApplyAudit(args.auditPath, {
        timestamp: new Date().toISOString(),
        source: "cli",
        event_type: "issue_split_apply",
        status: result.ok ? (result.mode === "execute" ? "success" : "planned") : "failed",
        issue_split_id: issueSplit.id ?? "",
        issue_count: issueSplit.issues?.length ?? 0,
        created_issue_ids: result.createdIssues?.map((issue) => issue.id).filter(Boolean) ?? [],
        summary: result.ok ? issueSplit.summary : result.error,
      });
    }
    writeJsonOrText(result, args.output);
    return;
  }
  throw new Error(`unknown plan action: ${action}`);
}

async function splitPlanViaAssistAgent({ goal, args }) {
  const discovery = await discoverAssistAgents({
    cliPath: args.cliPath,
    exec: args.__exec,
    commandTimeoutMs: args.commandTimeoutMs,
  });
  const selection = selectAssistAgent({
    agents: discovery.agents ?? [],
    preferredAgentId: args.agentId,
    mode: args.agentSelectionMode || (args.agentId ? "manual" : "auto"),
  });
  if (!discovery.ok || !selection.ok) {
    return {
      ok: false,
      blocked: true,
      reason: discovery.ok ? (selection.reason || "no_assist_agent") : (discovery.reason || "multica_cli_failed"),
      agents: discovery.agents ?? [],
      daemon: discovery.daemon,
      diagnostic: discovery.diagnostic,
      warnings: compatibilityWarnings(args),
    };
  }
  const planSet = await splitGoalIntoPlansWithAgent({
    goal,
    agent: selection.selectedAgent,
    language: normalizeCliLanguage(args, goal),
    cliPath: args.cliPath,
    exec: args.__exec,
    timeoutMs: args.assistTimeoutMs,
  });
  if (planSet?.blocked) {
    planSet.warnings = [...(planSet.warnings ?? []), ...compatibilityWarnings(args)];
  }
  return planSet;
}

async function applyIssueSplitFromCli({ issueSplit, cliPath = "multica", execute, confirm }) {
  const tempDir = await mkdtemp(join(tmpdir(), "multica-issue-split-"));
  try {
    return await applyIssueSplit({
      issueSplit,
      execute,
      confirm,
      exec: createCliExec({ cliPath }),
      writeDescriptionFile: async (issue, index) => {
        const path = join(tempDir, `issue-${index + 1}.md`);
        await writeFile(path, issue.description ?? "", "utf8");
        return path;
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function writeDegradationToStderr({ warnings = [], errors = [] }) {
  if (warnings.length) {
    process.stderr.write(`Degradation warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n`);
  }
  if (errors.length) {
    process.stderr.write(`Degradation errors:\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
  }
}

async function lockLedger(args) {
  requireArg(args.ledger, "--ledger");
  requireArg(args.specId, "--spec-id");
  const event = await createLedgerStore(args.ledger).lock(args.specId, args.approvedBy);
  writeOutput(event, args.output);
}

async function listLedger(args) {
  requireArg(args.ledger, "--ledger");
  const events = await createLedgerStore(args.ledger).list(args.specId);
  writeOutput(events, args.output);
}

async function writeArtifact(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function appendIssueApplyAudit(path, event) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(redactForAudit(event)) + "\n", "utf8");
}

function redactForAudit(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactForAudit);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api_key|cookie|credential/i.test(key)) {
      out[key] = "[redacted]";
    } else if (item && typeof item === "object") {
      out[key] = redactForAudit(item);
    } else {
      out[key] = item;
    }
  }
  return out;
}

function createCliExec({ cliPath = "multica", timeoutMs = 30000 } = {}) {
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

function requireArg(value, name) {
  if (!value) {
    throw new Error(`missing required argument: ${name}`);
  }
}

function normalizeCliLanguage(args = {}, payload = {}) {
  return normalizeLanguageValue(args.language || payload.language || payload.context?.language);
}

function normalizeLanguageValue(language) {
  return String(language || "zh-CN").toLowerCase() === "en-us" ? "en-US" : "zh-CN";
}

function writeOutput(value, output = "text") {
  if (output === "json") {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    return;
  }
  if (Array.isArray(value)) {
    process.stdout.write(value.map(formatLedgerEvent).join("\n") + (value.length ? "\n" : ""));
    return;
  }
  process.stdout.write(formatLedgerEvent(value) + "\n");
}

function writeJsonOrText(value, output = "text") {
  if (output === "json") {
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(value);
    if (!value.endsWith("\n")) process.stdout.write("\n");
    return;
  }
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function formatLedgerEvent(event) {
  return [event.createdAt, event.specId, event.status].filter(Boolean).join("\t");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "discover":
      case "diagnose":
      case "secret-metadata":
      case "agents":
      case "plan":
      case "apply":
      case "normalize":
      case "lock":
      case "generate":
      case "split":
      case "preview-issues":
      case "apply-issues":
        parsed._ = appendArg(parsed._, arg);
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--input":
      case "-i":
        parsed.input = argv[++index];
        break;
      case "--issue-id":
        parsed.issueId = argv[++index];
        break;
      case "--task-kind":
        parsed.taskKind = argv[++index];
        break;
      case "--trigger-comment-id":
        parsed.triggerCommentId = argv[++index];
        break;
      case "--trigger-comment":
        parsed.triggerComment = argv[++index];
        break;
      case "--autopilot-id":
        parsed.autopilotId = argv[++index];
        break;
      case "--autopilot-run-id":
        parsed.autopilotRunId = argv[++index];
        break;
      case "--autopilot-source":
        parsed.autopilotSource = argv[++index];
        break;
      case "--trigger-payload":
        parsed.triggerPayload = JSON.parse(argv[++index]);
        break;
      case "--agent-id":
        parsed.agentId = argv[++index];
        break;
      case "--cli-path":
        parsed.cliPath = argv[++index];
        break;
      case "--workspace-id":
        parsed.workspaceId = argv[++index];
        break;
      case "--workspace-name":
        parsed.workspaceName = argv[++index];
        break;
      case "--project-title":
        parsed.projectTitle = argv[++index];
        break;
      case "--source-agent-name":
        parsed.sourceAgentName = argv[++index];
        break;
      case "--preset":
        parsed.preset = argv[++index];
        break;
      case "--skill-path":
        parsed.skillPath = argv[++index];
        break;
      case "--mode":
        parsed.mode = argv[++index];
        if (!["create", "update"].includes(parsed.mode)) {
          throw new Error(`unsupported mode: ${parsed.mode}`);
        }
        break;
      case "--plan-out":
        parsed.planOut = argv[++index];
        break;
      case "--plan-set-out":
        parsed.planSetOut = argv[++index];
        break;
      case "--goal":
        parsed.goal = argv[++index];
        break;
      case "--goal-out":
        parsed.goalOut = argv[++index];
        break;
      case "--issue-split-out":
        parsed.issueSplitOut = argv[++index];
        break;
      case "--issue-split":
        parsed.issueSplit = argv[++index];
        break;
      case "--audit-path":
        parsed.auditPath = argv[++index];
        break;
      case "--complexity":
        parsed.complexity = argv[++index];
        if (!["simple", "medium", "complex"].includes(parsed.complexity)) {
          throw new Error(`unsupported complexity: ${parsed.complexity}`);
        }
        break;
      case "--project-id":
        parsed.projectId = argv[++index];
        break;
      case "--priority":
        parsed.priority = argv[++index];
        break;
      case "--execute":
        parsed.execute = true;
        break;
      case "--confirm":
        parsed.confirm = argv[++index];
        break;
      case "--repo":
        parsed.repo = appendArg(parsed.repo, argv[++index]);
        break;
      case "--scope":
        parsed.scope = appendArg(parsed.scope, argv[++index]);
        break;
      case "--plan":
        parsed.plan = appendArg(parsed.plan, argv[++index]);
        break;
      case "--plan-set":
        parsed.planSet = argv[++index];
        break;
      case "--llm":
        parsed.llm = true;
        break;
      case "--llm-direct":
        parsed.llmDirect = true;
        break;
      case "--agent":
        parsed.agent = true;
        break;
      case "--agent-selection-mode":
        parsed.agentSelectionMode = argv[++index];
        if (!["auto", "manual"].includes(parsed.agentSelectionMode)) {
          throw new Error(`unsupported agent selection mode: ${parsed.agentSelectionMode}`);
        }
        break;
      case "--assist-timeout-ms":
        parsed.assistTimeoutMs = Number(argv[++index]);
        break;
      case "--language":
        parsed.language = normalizeLanguageValue(argv[++index]);
        break;
      case "--probe":
        parsed.probe = true;
        break;
      case "--llm-provider":
        parsed.llmProvider = argv[++index];
        break;
      case "--llm-command":
        parsed.llmCommand = argv[++index];
        break;
      case "--llm-model":
        parsed.llmModel = argv[++index];
        break;
      case "--llm-timeout-ms":
        parsed.llmTimeoutMs = Number(argv[++index]);
        break;
      case "--token-type":
        parsed.tokenType = argv[++index];
        break;
      case "--ttl-minutes":
        parsed.ttlMinutes = Number(argv[++index]);
        break;
      case "--spec-out":
        parsed.specOut = argv[++index];
        break;
      case "--review-out":
        parsed.reviewOut = argv[++index];
        break;
      case "--ledger":
        parsed.ledger = argv[++index];
        break;
      case "--spec-id":
        parsed.specId = argv[++index];
        break;
      case "--approved-by":
        parsed.approvedBy = argv[++index];
        break;
      case "--output":
        parsed.output = argv[++index];
        if (!["json", "text"].includes(parsed.output)) {
          throw new Error(`unsupported output format: ${parsed.output}`);
        }
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function appendArg(value, next) {
  return [...(Array.isArray(value) ? value : []), next];
}

function compatibilityWarnings(args) {
  return args.llm ? ["--llm is a compatibility alias; default assist backend is Multica Agent via multica CLI."] : [];
}

function withCompatibilityWarning(value, args) {
  const warnings = compatibilityWarnings(args);
  if (!warnings.length || !value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    warnings: [...(Array.isArray(value.warnings) ? value.warnings : []), ...warnings],
  };
}

function buildLlmUserConfig(args) {
  if (!args.llmProvider && !args.llmCommand && !args.llmModel && !args.llmTimeoutMs) {
    return {};
  }
  return {
    provider: args.llmProvider,
    command: args.llmCommand,
    model: args.llmModel,
    timeoutMs: args.llmTimeoutMs,
  };
}

function buildTaskArgs(args) {
  return {
    kind: args.taskKind,
    triggerCommentId: args.triggerCommentId,
    triggerComment: args.triggerComment,
    autopilotId: args.autopilotId,
    autopilotRunId: args.autopilotRunId,
    autopilotSource: args.autopilotSource,
    triggerPayload: args.triggerPayload,
  };
}

function printHelp(command = "generate") {
  if (command.startsWith("agent-config")) {
    process.stdout.write(`multica-launch-review agent-config

Discover, plan, or apply a one-click Multica agent configuration.

Usage:
  multica-launch-review agent-config discover [--output json]
  multica-launch-review agent-config plan [--preset planner|review|incident|image2] [--plan-out plan.json] [--review-out plan.md]
  multica-launch-review agent-config apply [--preset planner|review|incident|image2] [--output json]
  multica-launch-review agent-config apply --execute --confirm APPLY-MULTICA-AGENT-CONFIG
  multica-launch-review agent-config apply --preset image2 --execute --confirm CREATE-MULTICA-IMAGE2-CODEX-AGENT

Safety:
  apply defaults to dry-run. Real Multica writes require --execute and the confirmation token.
  custom_env writes are excluded by design; use multica agent env set --custom-env-file or --custom-env-stdin separately after human approval.
`);
    return;
  }
  if (command.startsWith("goal")) {
    process.stdout.write(`multica-launch-review goal

Normalize or lock a Multica++ Goal.

Usage:
  multica-launch-review goal normalize --input request.json [--agent] [--agent-id agent-id] [--goal-out goal.json] [--output json]
  multica-launch-review goal normalize --input request.json [--llm] [--goal-out goal.json] [--output json]
  multica-launch-review goal lock --input goal.json [--goal-out locked-goal.json] [--approved-by human] [--output json]

Safety:
  --agent and compatibility --llm create a real Multica assist issue/task through multica CLI. Without either flag it uses deterministic local rules.
`);
    return;
  }
  if (command.startsWith("plan")) {
    process.stdout.write(`multica-launch-review plan

Generate a Plan from a locked Goal or preview Multica issue splitting.

Usage:
  multica-launch-review plan generate --input locked-goal.json [--complexity simple|medium|complex] [--plan-out plan.json] [--output json]
  multica-launch-review plan split --input locked-goal.json [--agent] [--agent-id agent-id] [--plan-set-out plan-set.json] [--output json]
  multica-launch-review plan split --input locked-goal.json [--llm] [--plan-set-out plan-set.json] [--output json]
  multica-launch-review plan preview-issues --goal locked-goal.json --plan plan.json [--issue-split-out split.json] [--review-out review.md] [--output json]
  multica-launch-review plan preview-issues --goal locked-goal.json --plan-set plan-set.json [--issue-split-out split.json] [--review-out review.md] [--output json]
  multica-launch-review plan apply-issues --confirm APPLY-MULTICA-ISSUE-SPLIT

Safety:
  split --agent and compatibility --llm create a real Multica assist issue/task. preview-issues never calls Multica.
`);
    return;
  }
  if (command.startsWith("assist")) {
    process.stdout.write(`multica-launch-review assist

Discover and diagnose Multica Agent assist backends.

Usage:
  multica-launch-review assist agents [--output json]
  multica-launch-review assist diagnose [--output json]

Safety:
  assist agents/diagnose only read Multica daemon, runtime, and agent metadata. Goal normalize --agent and plan split --agent create real Multica assist issues/tasks.
`);
    return;
  }
  if (command.startsWith("llm")) {
    process.stdout.write(`multica-launch-review llm

Discover local LLM Agent CLI providers for Goal to Plan splitting.

  Usage:
    multica-launch-review llm discover [--output json]
    multica-launch-review llm diagnose [--probe] [--output json]
    multica-launch-review llm secret-metadata --confirm READ-LOCAL-LLM-SECRET-METADATA [--output json]
    multica-launch-review llm discover --llm-provider codex --llm-command codex [--llm-model model] [--output json]

  Safety:
  Discovery checks config paths and CLI availability only. Diagnose adds sanitized readiness details. A real model probe runs only with --probe.
  secret-metadata requires an explicit confirmation token and returns only redacted metadata summaries.
`);
    return;
  }
  if (command === "from-multica") {
    process.stdout.write(`multica-launch-review from-multica

Generate a Runtime Agent Spec by reading Multica issue, agent, runtime, and skills data.

Usage:
  multica-launch-review from-multica --issue-id MUL-123 [--task-kind issue_assignment|comment_mention|autopilot] [--agent-id agent-id] [--workspace-name name] [--repo url] [--spec-out spec.json] [--review-out review.md]
`);
    return;
  }
  if (command === "lock") {
    process.stdout.write(`multica-launch-review lock

Lock a draft or amended Runtime Agent Spec in the ledger.

Usage:
  multica-launch-review lock --ledger ledger.jsonl --spec-id ras_... [--approved-by user] [--output json]
`);
    return;
  }
  if (command === "list") {
    process.stdout.write(`multica-launch-review list

List ledger records.

Usage:
  multica-launch-review list --ledger ledger.jsonl [--spec-id ras_...] [--output json]
`);
    return;
  }
  process.stdout.write(`multica-launch-review

Generate a pre-run Runtime Agent Spec and launch review for Multica tasks.

Usage:
  multica-launch-review --input task.json [--spec-out spec.json] [--review-out review.md] [--ledger ledger.jsonl]
  multica-launch-review from-multica --issue-id MUL-123 [--agent-id agent-id] [--spec-out spec.json] [--review-out review.md]
  multica-launch-review lock --ledger ledger.jsonl --spec-id ras_... [--approved-by user] [--output json]
  multica-launch-review list --ledger ledger.jsonl [--spec-id ras_...] [--output json]
  multica-launch-review goal normalize --input request.json [--goal-out goal.json]
  multica-launch-review plan generate --input locked-goal.json [--plan-out plan.json]

Input is a JSON object with goal, task, workspace, agent, permissions, and plan fields.
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
