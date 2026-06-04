#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

function requireArg(value, name) {
  if (!value) {
    throw new Error(`missing required argument: ${name}`);
  }
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
      case "plan":
      case "apply":
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

Input is a JSON object with goal, task, workspace, agent, permissions, and plan fields.
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
