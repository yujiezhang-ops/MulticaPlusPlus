import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildRuntimeAgentSpecFromMultica } from "./multica-mapper.js";
import { validateRuntimeAgentSpec } from "./spec/index.js";

test("maps read-only Multica issue, agent, runtime, and skills data into a valid spec", async () => {
  const calls = [];
  const client = {
    async getIssue(issueId) {
      calls.push(["issue", issueId]);
      return {
        ok: true,
        data: {
          id: "issue-uuid",
          identifier: "SPA-5",
          title: "Build real data mapper",
          description: "Map live Multica issue data into a Runtime Agent Spec.",
          status: "in_progress",
          priority: "medium",
          assigneeId: "agent-1",
          assigneeType: "agent",
          projectId: "project-1",
          workspaceId: "workspace-1",
          metadata: { depends_on: "SPA-3,SPA-4" },
          createdAt: "2026-06-03T08:00:00Z",
        },
        warnings: ["missing:issue.labels"],
        error: null,
      };
    },
    async getAgent(agentId) {
      calls.push(["agent", agentId]);
      return {
        ok: true,
        data: {
          id: "agent-1",
          name: "Codex Full Access Worker",
          provider: "custom",
          model: "pa/gpt-5.5",
          runtimeId: "runtime-1",
          instructions: "Use tests first.",
          env: {
            keys: ["FEATURE_FLAG", "OPENAI_API_KEY"],
            secretKeys: ["OPENAI_API_KEY"],
          },
          mcpServers: { filesystem: {} },
        },
        warnings: [],
        error: null,
      };
    },
    async getRuntime(runtimeId) {
      calls.push(["runtime", runtimeId]);
      return {
        ok: true,
        data: {
          id: "runtime-1",
          provider: "custom",
          model: "",
          name: "Local Codex",
        },
        warnings: [],
        error: null,
      };
    },
    async getSkills(agentId) {
      calls.push(["skills", agentId]);
      return {
        ok: true,
        data: [
          {
            name: "test-driven-development",
            version: "1.0.0",
            description: "Write failing tests first.",
            permissions: ["shell:write"],
            riskLevel: "high",
          },
        ],
        warnings: [],
        error: null,
      };
    },
  };

  const result = await buildRuntimeAgentSpecFromMultica({
    client,
    issueId: "issue-uuid",
    agentId: "agent-1",
    createdAt: "2026-06-03T09:00:00.000Z",
    workspace: {
      name: "MulticaPlusPlus",
      repos: [{ url: "https://github.com/yujiezhang-ops/MulticaPlusPlus" }],
    },
    permissions: {
      tokenType: "mat_task_scoped",
      ttlMinutes: 1440,
      scopes: ["workspace:read", "issue:read", "agent:read", "runtime:read"],
    },
    plan: ["Read live issue data", "Generate schema-valid spec"],
  });

  assert.deepEqual(calls, [
    ["issue", "issue-uuid"],
    ["agent", "agent-1"],
    ["runtime", "runtime-1"],
    ["skills", "agent-1"],
  ]);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.warnings, ["missing:issue.labels"]);
  assert.equal(result.spec.goal, "Build real data mapper");
  assert.equal(result.spec.task.issueId, "SPA-5");
  assert.equal(result.spec.task.taskId, "issue-uuid");
  assert.equal(result.spec.task.prompt, "Map live Multica issue data into a Runtime Agent Spec.");
  assert.equal(result.spec.workspace.id, "workspace-1");
  assert.equal(result.spec.workspace.name, "MulticaPlusPlus");
  assert.deepEqual(result.spec.workspace.repos, [{ url: "https://github.com/yujiezhang-ops/MulticaPlusPlus" }]);
  assert.deepEqual(result.spec.agent, { id: "agent-1", name: "Codex Full Access Worker" });
  assert.deepEqual(result.spec.runtime, {
    runtimeId: "runtime-1",
    provider: "custom",
    model: "pa/gpt-5.5",
  });
  assert.equal(result.spec.skills[0].name, "test-driven-development");
  assert.deepEqual(result.spec.capabilityReview.envKeys, ["FEATURE_FLAG", "OPENAI_API_KEY"]);
  assert.deepEqual(result.spec.capabilityReview.secretEnvKeys, ["OPENAI_API_KEY"]);
  assert.equal(JSON.stringify(result.spec).includes("sk-"), false);
  assert.deepEqual(validateRuntimeAgentSpec(result.spec).issues, []);
});

test("fails closed when Multica client results are missing or unavailable", async () => {
  const client = {
    async getIssue() {
      return {
        ok: true,
        data: {
          id: "issue-uuid",
          identifier: "",
          title: "",
          description: "",
          assigneeId: "",
          assigneeType: "",
          workspaceId: "",
          metadata: {},
        },
        warnings: ["missing:issue.title", "missing:issue.assigneeId"],
        error: null,
      };
    },
    async getAgent() {
      return { ok: false, data: null, warnings: [], error: "agent unavailable" };
    },
    async getRuntime() {
      throw new Error("runtime should not be fetched without an agent runtime id");
    },
    async getSkills() {
      throw new Error("skills should not be fetched without an agent id");
    },
  };

  const result = await buildRuntimeAgentSpecFromMultica({
    client,
    issueId: "issue-uuid",
    createdAt: "2026-06-03T09:00:00.000Z",
  });

  assert.equal(result.spec.task.issueId, "issue-uuid");
  assert.equal(result.spec.goal, "");
  assert.deepEqual(result.spec.agent, { id: "", name: "" });
  assert.deepEqual(result.spec.runtime, { runtimeId: "", provider: "", model: "" });
  assert.deepEqual(result.spec.skills, []);
  assert.deepEqual(result.spec.capabilityReview.envKeys, []);
  assert.deepEqual(validateRuntimeAgentSpec(result.spec).issues, []);
  assert.deepEqual(result.warnings, [
    "missing:issue.title",
    "missing:issue.assigneeId",
    "missing:agentId",
  ]);
  assert.deepEqual(result.errors, []);
});

test("cli can generate a spec from read-only Multica commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-launch-review-mapper-cli-"));
  try {
    const mockClient = join(dir, "mock-multica.js");
    const specPath = join(dir, "spec.json");
    const reviewPath = join(dir, "review.md");
    await writeFile(mockClient, `#!/usr/bin/env node
const [resource, command, ...rest] = process.argv.slice(2);
function out(value) { process.stdout.write(JSON.stringify(value)); }
if (resource === "issue" && command === "get") {
  out({
    id: "issue-uuid",
    identifier: "SPA-5",
    title: "Map real data",
    description: "Use Multica client data.",
    assignee_id: "agent-1",
    assignee_type: "agent",
    workspace_id: "workspace-1"
  });
} else if (resource === "agent" && command === "get") {
  out({
    id: "agent-1",
    name: "Codex",
    provider: "custom",
    model: "pa/gpt-5.5",
    runtime_id: "runtime-1",
    instructions: "Keep changes scoped.",
    custom_env: { OPENAI_API_KEY: "do-not-emit" },
    mcp_servers: ["filesystem"]
  });
} else if (resource === "runtime" && command === "list") {
  out([{ id: "runtime-1", provider: "custom", model: "pa/gpt-5.5" }]);
} else if (resource === "agent" && command === "skills" && rest[0] === "list") {
  out([{ name: "skill-a", permissions: ["shell:read"], risk_level: "low" }]);
} else {
  console.error("unexpected command", process.argv.slice(2).join(" "));
  process.exit(1);
}
`);

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "from-multica",
        "--issue-id",
        "issue-uuid",
        "--agent-id",
        "agent-1",
        "--cli-path",
        mockClient,
        "--workspace-name",
        "MulticaPlusPlus",
        "--repo",
        "https://github.com/yujiezhang-ops/MulticaPlusPlus",
        "--spec-out",
        specPath,
        "--review-out",
        reviewPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const spec = JSON.parse(await readFile(specPath, "utf8"));
    assert.equal(spec.task.issueId, "SPA-5");
    assert.equal(spec.agent.id, "agent-1");
    assert.equal(spec.runtime.runtimeId, "runtime-1");
    assert.equal(spec.skills[0].name, "skill-a");
    assert.deepEqual(spec.capabilityReview.secretEnvKeys, ["OPENAI_API_KEY"]);
    assert.equal(JSON.stringify(spec).includes("do-not-emit"), false);
    assert.match(await readFile(reviewPath, "utf8"), /Launch Review: Map real data/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli surfaces mapper warnings and errors in review output and stderr", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-launch-review-degradation-cli-"));
  try {
    const mockClient = join(dir, "mock-multica.js");
    const reviewPath = join(dir, "review.md");
    await writeFile(mockClient, `#!/usr/bin/env node
const [resource, command] = process.argv.slice(2);
function out(value) { process.stdout.write(JSON.stringify(value)); }
if (resource === "issue" && command === "get") {
  out({ id: "issue-uuid", identifier: "SPA-5" });
} else if (resource === "agent" && command === "get") {
  console.error("agent unavailable");
  process.exit(1);
} else {
  console.error("unexpected command", process.argv.slice(2).join(" "));
  process.exit(1);
}
`);

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "from-multica",
        "--issue-id",
        "issue-uuid",
        "--agent-id",
        "agent-1",
        "--cli-path",
        mockClient,
        "--review-out",
        reviewPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Degradation warnings:/);
    assert.match(result.stderr, /missing:issue.title/);
    assert.match(result.stderr, /Degradation errors:/);
    assert.match(result.stderr, /agent:agent unavailable/);

    const review = await readFile(reviewPath, "utf8");
    assert.match(review, /## Degradation/);
    assert.match(review, /### Warnings/);
    assert.match(review, /`missing:issue.title`/);
    assert.match(review, /### Errors/);
    assert.match(review, /`agent:agent unavailable`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli runs real-data spec generation, review, lock, and list for assignment, comment, and autopilot examples", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-launch-review-real-e2e-"));
  try {
    const mockClient = join(dir, "mock-multica.js");
    await writeFile(mockClient, `#!/usr/bin/env node
const [resource, command, ...rest] = process.argv.slice(2);
function out(value) { process.stdout.write(JSON.stringify(value)); }
if (resource === "issue" && command === "get") {
  const issueId = rest[0];
  out({
    id: issueId,
    identifier: issueId === "issue-autopilot" ? "SPA-AUTO" : issueId === "issue-comment" ? "SPA-COMMENT" : "SPA-ASSIGN",
    title: issueId === "issue-autopilot" ? "Run scheduled repository audit" : issueId === "issue-comment" ? "Answer a review comment" : "Implement an assigned issue",
    description: "Use real Multica data for launch review.",
    assignee_id: "agent-1",
    assignee_type: "agent",
    status: "in_progress",
    priority: "medium",
    project_id: "project-1",
    workspace_id: "workspace-1",
    metadata: { milestone: "M1" },
    created_at: "2026-06-03T08:00:00Z",
    updated_at: "2026-06-03T09:00:00Z"
  });
} else if (resource === "agent" && command === "get") {
  out({
    id: "agent-1",
    name: "Codex Full Access Worker",
    provider: "custom",
    model: "pa/gpt-5.5",
    runtime_id: "runtime-1",
    instructions: "Keep changes scoped and test first.",
    custom_env: { SAFE_FLAG: "true", OPENAI_API_KEY: "do-not-emit" },
    mcp_servers: ["filesystem"]
  });
} else if (resource === "runtime" && command === "list") {
  out([{ id: "runtime-1", provider: "custom", model: "pa/gpt-5.5" }]);
} else if (resource === "agent" && command === "skills" && rest[0] === "list") {
  out([{ name: "test-driven-development", version: "1.0.0", permissions: ["shell:write"], risk_level: "high" }]);
} else {
  console.error("unexpected command", process.argv.slice(2).join(" "));
  process.exit(1);
}
`);

    const scenarios = [
      {
        name: "assignment",
        args: ["--task-kind", "issue_assignment", "--issue-id", "issue-assignment"],
        assertSpec(spec) {
          assert.equal(spec.task.kind, "issue_assignment");
          assert.equal(spec.task.issueId, "SPA-ASSIGN");
        },
      },
      {
        name: "comment",
        args: [
          "--task-kind",
          "comment_mention",
          "--issue-id",
          "issue-comment",
          "--trigger-comment-id",
          "comment-1",
          "--trigger-comment",
          "Please verify the migration.",
        ],
        assertSpec(spec) {
          assert.equal(spec.task.kind, "comment_mention");
          assert.equal(spec.task.issueId, "SPA-COMMENT");
          assert.equal(spec.task.triggerCommentId, "comment-1");
          assert.equal(spec.task.triggerComment, "Please verify the migration.");
        },
      },
      {
        name: "autopilot",
        args: [
          "--task-kind",
          "autopilot",
          "--issue-id",
          "issue-autopilot",
          "--autopilot-id",
          "autopilot-1",
          "--autopilot-run-id",
          "run-1",
          "--autopilot-source",
          "schedule",
          "--trigger-payload",
          '{"cron":"0 9 * * 1"}',
        ],
        assertSpec(spec) {
          assert.equal(spec.task.kind, "autopilot");
          assert.equal(spec.task.issueId, "SPA-AUTO");
          assert.equal(spec.task.autopilotId, "autopilot-1");
          assert.equal(spec.task.autopilotRunId, "run-1");
          assert.equal(spec.task.autopilotSource, "schedule");
          assert.equal(spec.task.triggerPayload.source, "multica");
          assert.equal(spec.task.triggerPayload.issue.id, "issue-autopilot");
          assert.deepEqual(spec.task.triggerPayload.trigger, { cron: "0 9 * * 1" });
        },
      },
    ];

    for (const scenario of scenarios) {
      const specPath = join(dir, `${scenario.name}-spec.json`);
      const reviewPath = join(dir, `${scenario.name}-review.md`);
      const ledgerPath = join(dir, `${scenario.name}-ledger.jsonl`);
      const generate = spawnSync(
        process.execPath,
        [
          "src/cli.js",
          "from-multica",
          ...scenario.args,
          "--agent-id",
          "agent-1",
          "--cli-path",
          mockClient,
          "--workspace-name",
          "MulticaPlusPlus",
          "--repo",
          "https://github.com/yujiezhang-ops/MulticaPlusPlus",
          "--spec-out",
          specPath,
          "--review-out",
          reviewPath,
          "--ledger",
          ledgerPath,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      assert.equal(generate.status, 0, generate.stderr);
      const spec = JSON.parse(await readFile(specPath, "utf8"));
      scenario.assertSpec(spec);
      assert.deepEqual(validateRuntimeAgentSpec(spec).issues, []);
      assert.equal(JSON.stringify(spec).includes("do-not-emit"), false);

      const review = await readFile(reviewPath, "utf8");
      assert.match(review, new RegExp(`Task kind: \`${spec.task.kind}\``));

      const lock = spawnSync(
        process.execPath,
        [
          "src/cli.js",
          "lock",
          "--ledger",
          ledgerPath,
          "--spec-id",
          spec.specId,
          "--approved-by",
          "lead",
          "--output",
          "json",
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      assert.equal(lock.status, 0, lock.stderr);

      const list = spawnSync(
        process.execPath,
        ["src/cli.js", "list", "--ledger", ledgerPath, "--spec-id", spec.specId, "--output", "json"],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      assert.equal(list.status, 0, list.stderr);
      const records = JSON.parse(list.stdout);
      assert.deepEqual(records.map((record) => record.status), ["draft", "locked"]);
      assert.equal(records[0].spec.task.kind, spec.task.kind);
      assert.equal(records[1].approvedBy, "lead");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeFile(path, value) {
  const { writeFile: write } = await import("node:fs/promises");
  await write(path, value, "utf8");
}
