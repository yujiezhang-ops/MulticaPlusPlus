import assert from "node:assert/strict";
import test from "node:test";

import { createMulticaClient } from "./multica-client.js";

test("normalizes issue, agent, runtime, and skills from read-only CLI responses", async () => {
  const calls = [];
  const exec = async (args) => {
    calls.push(args);
    if (args[0] === "issue") {
      return jsonResult({
        id: "issue-1",
        identifier: "SPA-4",
        number: 4,
        title: "Build client",
        description: "Read Multica data.",
        status: "in_progress",
        priority: "high",
        assignee_id: "agent-1",
        assignee_type: "agent",
        parent_issue_id: "parent-1",
        project_id: "project-1",
        workspace_id: "workspace-1",
        labels: [{ name: "m1" }],
        metadata: { depends_on: "none" },
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-02T00:00:00Z",
      });
    }
    if (args[0] === "agent" && args[1] === "get") {
      return jsonResult({
        id: "agent-1",
        name: "Codex Worker",
        provider: "openai",
        model: "gpt-5",
        runtime_id: "runtime-1",
        instructions: "Work carefully.",
        skills: [
          {
            name: "test-driven-development",
            version: "1.0.0",
            description: "Write tests first.",
            permissions: ["shell:read"],
            risk_level: "low",
          },
        ],
        custom_env: {
          OPENAI_API_KEY: "sk-should-not-leak",
          FEATURE_FLAG: "enabled",
        },
        mcp_servers: { filesystem: {} },
      });
    }
    if (args[0] === "runtime") {
      return jsonResult([
        { id: "runtime-1", provider: "openai", model: "gpt-5", name: "Local Runtime" },
        { id: "runtime-2", provider: "anthropic", model: "claude", name: "Other Runtime" },
      ]);
    }
    if (args[0] === "agent" && args[1] === "skills") {
      return jsonResult([
        {
          name: "systematic-debugging",
          version: "2.0.0",
          description: "Debug in order.",
          permissions: ["shell:read"],
          riskLevel: "medium",
        },
      ]);
    }
    throw new Error(`unexpected call: ${args.join(" ")}`);
  };

  const client = createMulticaClient({ exec });

  assert.deepEqual(await client.getIssue("issue-1"), {
    ok: true,
    data: {
      id: "issue-1",
      identifier: "SPA-4",
      number: 4,
      title: "Build client",
      description: "Read Multica data.",
      status: "in_progress",
      priority: "high",
      assigneeId: "agent-1",
      assigneeType: "agent",
      parentIssueId: "parent-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      labels: [{ name: "m1" }],
      metadata: { depends_on: "none" },
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    },
    warnings: [],
    error: null,
  });

  const agent = await client.getAgent("agent-1");
  assert.deepEqual(agent, {
    ok: true,
    data: {
      id: "agent-1",
      name: "Codex Worker",
      provider: "openai",
      model: "gpt-5",
      runtimeId: "runtime-1",
      instructions: "Work carefully.",
      skills: [
        {
          name: "test-driven-development",
          version: "1.0.0",
          description: "Write tests first.",
          permissions: ["shell:read"],
          riskLevel: "low",
        },
      ],
      env: {
        keys: ["FEATURE_FLAG", "OPENAI_API_KEY"],
        secretKeys: ["OPENAI_API_KEY"],
      },
      mcpServers: ["filesystem"],
    },
    warnings: [],
    error: null,
  });
  assert.equal(JSON.stringify(agent).includes("sk-should-not-leak"), false);
  assert.equal(JSON.stringify(agent).includes("enabled"), false);

  assert.deepEqual(await client.getRuntime("runtime-1"), {
    ok: true,
    data: {
      id: "runtime-1",
      provider: "openai",
      model: "gpt-5",
      name: "Local Runtime",
    },
    warnings: [],
    error: null,
  });

  assert.deepEqual(await client.getSkills("agent-1"), {
    ok: true,
    data: [
      {
        name: "systematic-debugging",
        version: "2.0.0",
        description: "Debug in order.",
        permissions: ["shell:read"],
        riskLevel: "medium",
      },
    ],
    warnings: [],
    error: null,
  });

  assert.deepEqual(calls, [
    ["issue", "get", "issue-1", "--output", "json"],
    ["agent", "get", "agent-1", "--output", "json"],
    ["runtime", "list", "--output", "json"],
    ["agent", "skills", "list", "agent-1", "--output", "json"],
  ]);
});

test("uses safe defaults and warnings when response fields are missing", async () => {
  const client = createMulticaClient({
    exec: async () => jsonResult({ id: "issue-1" }),
  });

  const result = await client.getIssue("issue-1");

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    id: "issue-1",
    identifier: "",
    number: "",
    title: "",
    description: "",
    status: "",
    priority: "",
    assigneeId: "",
    assigneeType: "",
    parentIssueId: "",
    projectId: "",
    workspaceId: "",
    labels: [],
    metadata: {},
    createdAt: "",
    updatedAt: "",
  });
  assert.deepEqual(result.warnings, [
    "missing:issue.identifier",
    "missing:issue.number",
    "missing:issue.title",
    "missing:issue.description",
    "missing:issue.status",
    "missing:issue.priority",
    "missing:issue.assigneeId",
    "missing:issue.assigneeType",
    "missing:issue.parentIssueId",
    "missing:issue.projectId",
    "missing:issue.workspaceId",
    "missing:issue.labels",
    "missing:issue.metadata",
    "missing:issue.createdAt",
    "missing:issue.updatedAt",
  ]);
  assert.equal(result.error, null);
});

test("returns a hard-failure envelope for non-json stdout", async () => {
  const client = createMulticaClient({
    exec: async () => ({ stdout: "not json", stderr: "", code: 0 }),
  });

  const result = await client.getAgent("agent-1");

  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.deepEqual(result.warnings, []);
  assert.match(result.error, /invalid json/i);
});

test("returns a hard-failure envelope for non-zero exit", async () => {
  const client = createMulticaClient({
    exec: async () => ({ stdout: "", stderr: "agent not found", code: 1 }),
  });

  const result = await client.getSkills("agent-1");

  assert.deepEqual(result, {
    ok: false,
    data: null,
    warnings: [],
    error: "agent not found",
  });
});

function jsonResult(value) {
  return { stdout: JSON.stringify(value), stderr: "", code: 0 };
}
