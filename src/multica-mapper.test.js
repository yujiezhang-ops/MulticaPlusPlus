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

async function writeFile(path, value) {
  const { writeFile: write } = await import("node:fs/promises");
  await write(path, value, "utf8");
}
