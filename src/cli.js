#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  buildRuntimeAgentSpecFromMultica,
  buildRuntimeAgentSpec,
  createLedgerStore,
  renderLaunchReviewMarkdown,
} from "./launch-review.js";
import { createMulticaClient } from "./multica-client.js";

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
    permissions: {
      tokenType: args.tokenType,
      ttlMinutes: args.ttlMinutes,
      scopes: args.scope,
    },
    plan: args.plan,
  });
  const review = renderLaunchReviewMarkdown(result.spec);

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

function formatLedgerEvent(event) {
  return [event.createdAt, event.specId, event.status].filter(Boolean).join("\t");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
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

function printHelp(command = "generate") {
  if (command === "from-multica") {
    process.stdout.write(`multica-launch-review from-multica

Generate a Runtime Agent Spec by reading Multica issue, agent, runtime, and skills data.

Usage:
  multica-launch-review from-multica --issue-id MUL-123 [--agent-id agent-id] [--workspace-name name] [--repo url] [--spec-out spec.json] [--review-out review.md]
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
