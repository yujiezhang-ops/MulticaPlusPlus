import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildRuntimeAgentSpec,
  createLedgerStore,
  renderLaunchReviewMarkdown,
} from "./launch-review.js";

test("keeps launch review module boundaries explicit", async () => {
  const publicExports = await import("./launch-review.js");
  assert.deepEqual(Object.keys(publicExports).sort(), [
    "buildRuntimeAgentSpec",
    "createLedgerStore",
    "renderLaunchReviewMarkdown",
  ]);

  for (const moduleName of ["spec", "overlay", "capability", "ledger"]) {
    const entries = await readdir(new URL(`${moduleName}/`, import.meta.url));
    assert.ok(entries.includes("index.js"), `${moduleName} should expose an index.js barrel`);
  }

  const ledgerIndex = await readFile(new URL("ledger/index.js", import.meta.url), "utf8");
  assert.match(ledgerIndex, /from "\.\.\/spec\/index\.js"/);

  const specExports = await import("./spec/index.js");
  assert.deepEqual(Object.keys(specExports).sort(), [
    "buildRuntimeAgentSpec",
    "normalizeMcpServers",
    "normalizePermissions",
    "normalizeRepos",
    "normalizeSkills",
    "renderLaunchReviewMarkdown",
    "schemaVersion",
    "stableHash",
    "stableStringify",
  ]);

  const overlayExports = await import("./overlay/index.js");
  assert.deepEqual(Object.keys(overlayExports), ["buildInstructionOverlay"]);

  const capabilityExports = await import("./capability/index.js");
  assert.deepEqual(Object.keys(capabilityExports).sort(), [
    "SECRET_ENV_PATTERNS",
    "buildCapabilityReview",
    "isSecretEnvKey",
  ]);

  const ledgerExports = await import("./ledger/index.js");
  assert.deepEqual(Object.keys(ledgerExports).sort(), [
    "ALLOWED_LEDGER_TRANSITIONS",
    "assertTransition",
    "createLedgerStore",
    "readLedgerEvents",
    "readLedgerText",
  ]);
});

test("builds a reviewable runtime agent spec for an issue assignment", () => {
  const spec = buildRuntimeAgentSpec({
    goal: "Fix the checkout retry bug",
    task: {
      kind: "issue_assignment",
      issueId: "MUL-123",
      taskId: "task-1",
      prompt: "Fix retry behavior and add tests.",
    },
    workspace: {
      id: "ws-1",
      name: "Core",
      context: "Prefer small changes and post concise final comments.",
      repos: [{ url: "https://github.com/acme/shop" }],
    },
    agent: {
      id: "agent-1",
      name: "Fixer",
      runtimeId: "runtime-1",
      provider: "codex",
      model: "gpt-5-codex",
      instructions: "You fix bugs with tests first.",
      skills: [
        {
          name: "bug-fixer",
          version: "1.0.0",
          permissions: ["repo:write", "shell:write"],
          riskLevel: "high",
        },
      ],
      customEnv: {
        ANTHROPIC_API_KEY: "secret",
        SAFE_FLAG: "true",
      },
      mcpServers: ["filesystem"],
    },
    permissions: {
      tokenType: "mat_task_scoped",
      ttlMinutes: 1440,
      scopes: ["workspace:read", "issue:comment", "repo:write"],
    },
    plan: ["Read issue and comments", "Patch retry code", "Run tests"],
  });

  assert.equal(spec.status, "draft");
  assert.equal(spec.task.kind, "issue_assignment");
  assert.deepEqual(spec.runtime, {
    runtimeId: "runtime-1",
    provider: "codex",
    model: "gpt-5-codex",
  });
  assert.equal(spec.skills[0].riskLevel, "high");
  assert.deepEqual(spec.capabilityReview.secretEnvKeys, ["ANTHROPIC_API_KEY"]);
  assert.deepEqual(spec.capabilityReview.riskFlags, [
    "high_risk_skill:bug-fixer",
    "secret_env:ANTHROPIC_API_KEY",
    "mcp_enabled:filesystem",
    "repo_write_scope",
    "shell_write_skill:bug-fixer",
  ]);
  assert.match(spec.instructionOverlay.diff, /\+ Workspace Context/);
  assert.match(spec.instructionOverlay.diff, /\+ Agent Instructions/);
});

test("renders launch review markdown with comment and autopilot context", () => {
  const commentSpec = buildRuntimeAgentSpec({
    goal: "Answer latest reviewer question",
    task: {
      kind: "comment_trigger",
      issueId: "MUL-456",
      taskId: "task-2",
      triggerCommentId: "comment-9",
      triggerComment: "Can you verify the migration?",
    },
    workspace: { id: "ws-1", name: "Core" },
    agent: { id: "agent-1", name: "Reviewer", runtimeId: "rt", provider: "claude" },
  });
  const commentReview = renderLaunchReviewMarkdown(commentSpec);

  assert.match(commentReview, /comment_trigger/);
  assert.match(commentReview, /Trigger comment: `comment-9`/);
  assert.match(commentReview, /Can you verify the migration\?/);

  const autopilotSpec = buildRuntimeAgentSpec({
    goal: "Run weekly dependency audit",
    task: {
      kind: "autopilot_run",
      taskId: "task-3",
      autopilotId: "ap-1",
      autopilotRunId: "run-1",
      autopilotSource: "schedule",
      triggerPayload: { cron: "0 9 * * 1" },
    },
    workspace: { id: "ws-1", name: "Core" },
    agent: { id: "agent-2", name: "Auditor", runtimeId: "rt", provider: "codex" },
  });
  const autopilotReview = renderLaunchReviewMarkdown(autopilotSpec);

  assert.match(autopilotReview, /autopilot_run/);
  assert.match(autopilotReview, /Autopilot: `ap-1`/);
  assert.match(autopilotReview, /"cron": "0 9 \* \* 1"/);
});

test("ledger persists draft, locked, running, completed states", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-launch-review-"));
  try {
    const store = createLedgerStore(join(dir, "ledger.jsonl"));
    const spec = buildRuntimeAgentSpec({
      goal: "Create a sub-issue",
      task: { kind: "quick_create", taskId: "task-4", prompt: "Add test coverage issue" },
      workspace: { id: "ws-1", name: "Core" },
      agent: { id: "agent-3", name: "Planner", runtimeId: "rt", provider: "codex" },
      plan: ["Create one issue"],
    });

    await store.recordDraft(spec);
    const locked = await store.lock(spec.specId, "ppio");
    const running = await store.markRunning(spec.specId);
    const completed = await store.complete(spec.specId, { issueId: "MUL-789" });

    assert.equal(locked.status, "locked");
    assert.equal(locked.approvedBy, "ppio");
    assert.equal(running.status, "running");
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.result, { issueId: "MUL-789" });

    const raw = await readFile(join(dir, "ledger.jsonl"), "utf8");
    const events = raw.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.status),
      ["draft", "locked", "running", "completed"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli writes spec, review, and draft ledger from an input JSON file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-launch-review-cli-"));
  try {
    const inputPath = join(dir, "input.json");
    const specPath = join(dir, "spec.json");
    const reviewPath = join(dir, "review.md");
    const ledgerPath = join(dir, "ledger.jsonl");
    await writeJson(inputPath, {
      goal: "Prepare a reviewed Multica run",
      task: { kind: "issue_assignment", taskId: "task-cli", issueId: "MUL-321" },
      workspace: { id: "ws-cli", name: "CLI Workspace" },
      agent: { id: "agent-cli", name: "CLI Agent", runtimeId: "rt-cli", provider: "codex" },
      plan: ["Inspect context", "Run reviewed task"],
    });

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "--input",
        inputPath,
        "--spec-out",
        specPath,
        "--review-out",
        reviewPath,
        "--ledger",
        ledgerPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const spec = JSON.parse(await readFile(specPath, "utf8"));
    const review = await readFile(reviewPath, "utf8");
    const ledger = (await readFile(ledgerPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

    assert.equal(spec.task.issueId, "MUL-321");
    assert.match(review, /Launch Review: Prepare a reviewed Multica run/);
    assert.equal(ledger[0].status, "draft");
    assert.equal(ledger[0].specId, spec.specId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli creates parent directories for output artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-launch-review-cli-dirs-"));
  try {
    const inputPath = join(dir, "input.json");
    const specPath = join(dir, "nested", "artifacts", "spec.json");
    const reviewPath = join(dir, "nested", "artifacts", "review.md");
    await writeJson(inputPath, {
      goal: "Generate nested artifacts",
      task: { kind: "issue_assignment", taskId: "task-dir", issueId: "MUL-654" },
      workspace: { id: "ws-dir", name: "Directory Workspace" },
      agent: { id: "agent-dir", name: "Directory Agent", runtimeId: "rt-dir", provider: "codex" },
    });

    const result = spawnSync(
      process.execPath,
      ["src/cli.js", "--input", inputPath, "--spec-out", specPath, "--review-out", reviewPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(specPath, "utf8")).task.issueId, "MUL-654");
    assert.match(await readFile(reviewPath, "utf8"), /Generate nested artifacts/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeJson(path, value) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}
