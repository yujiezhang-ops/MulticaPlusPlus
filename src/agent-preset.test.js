import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentConfigPlanFromPreset,
  buildTeamPresetFromEnvironment,
  listAgentPresets,
  mergePresetOverrides,
} from "./agent-preset.js";

test("lists plugin and team agent presets with editable configuration fields", () => {
  const presets = listAgentPresets();

  assert.ok(presets.length >= 6);
  assert.ok(presets.some((preset) => preset.source === "plugin" && preset.id === "image2-generation"));
  assert.ok(presets.some((preset) => preset.source === "team"));

  const image2 = presets.find((preset) => preset.id === "image2-generation");
  assert.equal(image2.target, "agent");
  assert.equal(image2.agent.name, "Multica++ Image2 Codex Agent");
  assert.ok(image2.skills.some((skill) => skill.name === "paigod-imagegen"));
  assert.ok(image2.environment.some((item) => item.key === "OPENAI_API_KEY"));
  assert.ok(image2.guardrails.includes("dry-run image payload first"));
});

test("builds a team preset from the shared work environment without secret values", () => {
  const preset = buildTeamPresetFromEnvironment({
    id: "team-design-review",
    name: "Team Design Review Agent",
    createdBy: "DesignOps",
    useCases: ["review GUI prototypes", "check launch-readiness"],
    agent: {
      instructions: "Review GUI and PRD consistency before launch.",
      model: "pa/gpt-5.5",
      runtimeHint: "local-codex",
    },
    skills: [
      { name: "launch-review", localPath: "C:\\Users\\PPIO\\.codex\\skills\\launch-review\\SKILL.md" },
    ],
    mcpServers: [
      { name: "filesystem", purpose: "read local project files", required: true },
    ],
    permissions: {
      scopes: ["workspace:read", "repo:read", "issue:comment"],
      ttl: "1 hour",
      approvalRequired: true,
      riskLevel: "medium",
    },
    environment: [
      { key: "OPENAI_API_KEY", pathHint: "%USERPROFILE%\\.codex\\auth.json", required: true, value: "sk-hidden" },
    ],
  });

  assert.equal(preset.source, "team");
  assert.equal(preset.createdBy, "DesignOps");
  assert.equal(preset.agent.name, "Team Design Review Agent");
  assert.equal(preset.mcpServers[0].name, "filesystem");
  assert.equal(preset.environment[0].key, "OPENAI_API_KEY");
  assert.equal("value" in preset.environment[0], false);
  assert.equal(JSON.stringify(preset).includes("sk-hidden"), false);
});

test("merges user overrides into a preset before planning", () => {
  const preset = listAgentPresets().find((item) => item.id === "planner");
  const merged = mergePresetOverrides(preset, {
    agent: {
      name: "Project Launch Planner",
      instructions: "Plan the launch and keep checkpoints explicit.",
      maxConcurrentTasks: 1,
    },
    permissions: {
      ttl: "30 minutes",
      scopes: ["workspace:read", "issue:read"],
    },
    skills: [{ name: "launch-review" }],
  });

  assert.equal(merged.agent.name, "Project Launch Planner");
  assert.equal(merged.agent.maxConcurrentTasks, 1);
  assert.deepEqual(merged.permissions.scopes, ["workspace:read", "issue:read"]);
  assert.deepEqual(merged.skills.map((skill) => skill.name), ["launch-review"]);
  assert.match(merged.agent.instructions, /Plan the launch/);
});

test("builds a Multica agent config plan from an edited preset and blocks unsupported writes", () => {
  const preset = mergePresetOverrides(
    listAgentPresets().find((item) => item.id === "team-gui-builder"),
    {
      agent: {
        name: "GUI Builder Agent - Edited",
        instructions: "Implement local GUI prototype changes and test them.",
      },
      permissions: {
        scopes: ["workspace:read", "repo:write"],
        ttl: "2 hours",
      },
    },
  );

  const plan = buildAgentConfigPlanFromPreset({
    environment: localEnvironment({
      skills: [{ id: "skill-launch", name: "launch-review" }],
    }),
    preset,
    createdAt: "2026-06-04T10:00:00.000Z",
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.target.name, "GUI Builder Agent - Edited");
  assert.match(plan.target.instructions, /Implement local GUI prototype changes/);
  assert.ok(plan.operations.some((operation) => operation.type === "agent:create"));
  assert.ok(plan.operations.some((operation) => operation.type === "agent:skills:add"));
  assert.ok(plan.blockedOperations.some((operation) => operation.type === "agent:mcp:set"));
  assert.ok(plan.blockedOperations.some((operation) => operation.type === "agent:env:set"));
  assert.equal(JSON.stringify(plan).includes("sk-"), false);
});

function localEnvironment(overrides = {}) {
  return {
    ok: true,
    daemon: { status: "running", version: "0.3.15" },
    workspace: { id: "ws-1", name: "SparkProject", slug: "sparkproject" },
    project: { id: "project-1", title: "MulticaPlusPlus", workspaceId: "ws-1" },
    runtime: { id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" },
    sourceAgent: {
      id: "agent-source",
      name: "Codex Full Access Worker",
      model: "pa/gpt-5.5",
      runtimeId: "rt-codex",
      customArgs: ["-c", "approval_policy=never"],
      maxConcurrentTasks: 3,
    },
    agents: [{ id: "agent-source", name: "Codex Full Access Worker", runtime_id: "rt-codex" }],
    runtimes: [{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }],
    skills: [],
    warnings: [],
    ...overrides,
  };
}
