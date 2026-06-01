#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  buildRuntimeAgentSpec,
  createLedgerStore,
  renderLaunchReviewMarkdown,
} from "./launch-review.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    printHelp();
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

async function writeArtifact(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
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
      case "--spec-out":
        parsed.specOut = argv[++index];
        break;
      case "--review-out":
        parsed.reviewOut = argv[++index];
        break;
      case "--ledger":
        parsed.ledger = argv[++index];
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(`multica-launch-review

Generate a pre-run Runtime Agent Spec and launch review for Multica tasks.

Usage:
  multica-launch-review --input task.json [--spec-out spec.json] [--review-out review.md] [--ledger ledger.jsonl]

Input is a JSON object with goal, task, workspace, agent, permissions, and plan fields.
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
