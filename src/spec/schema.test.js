import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimeAgentSpecSchema,
  schemaVersion,
  validateRuntimeAgentSpec,
} from "./schema.js";

test("accepts a complete valid runtime agent spec unchanged", () => {
  const valid = {
    schemaVersion,
    specId: "ras_123",
    status: "approved",
    createdAt: "2026-06-03T08:00:00.000Z",
    goal: "Ship a reviewed launch",
    workspace: {
      id: "ws-1",
      name: "Core",
      repos: [{ url: "https://github.com/acme/core" }],
    },
    task: {
      kind: "autopilot",
      taskId: "task-1",
      issueId: "MUL-1",
      triggerCommentId: "comment-1",
      triggerComment: "run it",
      prompt: "review this task",
      autopilotId: "ap-1",
      autopilotRunId: "run-1",
      autopilotSource: "schedule",
      triggerPayload: { cron: "0 9 * * 1" },
    },
    agent: {
      id: "agent-1",
      name: "Codex",
    },
    runtime: {
      runtimeId: "rt-1",
      provider: "custom",
      model: "pa/gpt-5.5",
    },
    skills: [
      {
        name: "test-driven-development",
        version: "1.0.0",
        description: "Write tests first",
        permissions: ["repo:write"],
        riskLevel: "medium",
      },
    ],
    instructionOverlay: {
      reviewStatus: "approved",
      layers: [{ name: "Task Prompt", content: "review this task" }],
      diff: "+ Task Prompt",
    },
    capabilityReview: {
      repos: [{ url: "https://github.com/acme/core" }],
      envKeys: ["SAFE_FLAG"],
      secretEnvKeys: ["API_KEY"],
      mcpServers: ["filesystem"],
      riskFlags: ["repo_write_scope"],
    },
    permissions: {
      tokenType: "mat_task_scoped",
      ttlMinutes: 60,
      scopes: ["repo:write"],
    },
    initialPlan: ["Read context", "Run tests"],
  };

  const result = validateRuntimeAgentSpec(valid);

  assert.deepEqual(result, { spec: valid, issues: [] });
});

test("defaults an empty object to a complete valid spec without throwing", () => {
  const result = validateRuntimeAgentSpec({});

  assert.deepEqual(Object.keys(result.spec).sort(), [
    "agent",
    "capabilityReview",
    "createdAt",
    "goal",
    "initialPlan",
    "instructionOverlay",
    "permissions",
    "runtime",
    "schemaVersion",
    "skills",
    "specId",
    "status",
    "task",
    "workspace",
  ]);
  assert.equal(result.spec.schemaVersion, schemaVersion);
  assert.equal(result.spec.status, "draft");
  assert.equal(result.spec.task.kind, "issue_assignment");
  assert.equal(result.spec.task.triggerPayload, null);
  assert.deepEqual(result.spec.workspace, { id: "", name: "", repos: [] });
  assert.deepEqual(result.spec.agent, { id: "", name: "" });
  assert.deepEqual(result.spec.runtime, { runtimeId: "", provider: "", model: "" });
  assert.equal(result.spec.instructionOverlay.reviewStatus, "pending");
  assert.deepEqual(result.spec.capabilityReview.riskFlags, []);
  assert.deepEqual(result.spec.permissions, {
    tokenType: "mat_task_scoped",
    ttlMinutes: 1440,
    scopes: [],
  });
  assert.deepEqual(result.spec.initialPlan, []);
  assert.deepEqual(result.issues, []);
});

test("catches wrong field types and falls back to defaults", () => {
  const result = validateRuntimeAgentSpec({
    permissions: {
      ttlMinutes: "abc",
      scopes: 123,
    },
    skills: "x",
  });

  assert.equal(result.spec.permissions.ttlMinutes, 1440);
  assert.deepEqual(result.spec.permissions.scopes, []);
  assert.deepEqual(result.spec.skills, []);
  assert.ok(result.issues.length >= 3);
});

test("catches illegal enums and falls back to each enum default", () => {
  const result = validateRuntimeAgentSpec({
    status: "weird",
    task: { kind: "???" },
    skills: [{ riskLevel: "nuclear" }],
  });

  assert.equal(result.spec.status, "draft");
  assert.equal(result.spec.task.kind, "issue_assignment");
  assert.equal(result.spec.skills[0].riskLevel, "unknown");
  assert.ok(result.issues.length >= 3);
});

test("defaults null and undefined top-level input without throwing", () => {
  assert.deepEqual(validateRuntimeAgentSpec(null).spec, validateRuntimeAgentSpec({}).spec);
  assert.deepEqual(validateRuntimeAgentSpec(undefined).spec, validateRuntimeAgentSpec({}).spec);
});

test("strips extra fields without reporting issues", () => {
  const result = validateRuntimeAgentSpec({
    schemaVersion,
    specId: "",
    status: "draft",
    createdAt: "",
    goal: "",
    extra: "remove me",
    workspace: {
      id: "",
      name: "",
      extra: "remove me",
      repos: [{ url: "https://github.com/acme/core", extra: "remove me" }],
    },
    task: {
      kind: "issue_assignment",
      taskId: "",
      issueId: "",
      triggerCommentId: "",
      triggerComment: "",
      prompt: "",
      autopilotId: "",
      autopilotRunId: "",
      autopilotSource: "",
      triggerPayload: null,
      extra: "remove me",
    },
  });

  assert.equal("extra" in result.spec, false);
  assert.equal("extra" in result.spec.workspace, false);
  assert.equal("extra" in result.spec.workspace.repos[0], false);
  assert.equal("extra" in result.spec.task, false);
  assert.deepEqual(result.issues, []);
});

test("exports the runtime agent spec schema as the single zod source", () => {
  assert.equal(typeof RuntimeAgentSpecSchema.parse, "function");
});
