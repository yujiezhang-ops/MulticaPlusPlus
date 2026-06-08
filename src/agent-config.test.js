import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  applyAgentConfigPlan,
  buildImage2AgentConfigPlan,
  buildAgentConfigPlan,
  discoverMulticaEnvironment,
} from "./agent-config.js";

test("discovers the local Multica workspace, project, runtime, source agent, and skills", async () => {
  const calls = [];
  const environment = await discoverMulticaEnvironment({
    exec: async (args) => {
      calls.push(args);
      if (args[0] === "daemon") {
        return textResult("Daemon:      running (pid 100)\nVersion:     0.3.15\n");
      }
      if (args[0] === "workspace") {
        return jsonResult([{ id: "ws-1", name: "SparkProject", slug: "sparkproject" }]);
      }
      if (args[0] === "project") {
        return jsonResult([{ id: "project-1", title: "MulticaPlusPlus", workspace_id: "ws-1" }]);
      }
      if (args[0] === "runtime") {
        return jsonResult([
          { id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" },
          { id: "rt-claude", provider: "claude", name: "Claude Local", status: "online" },
        ]);
      }
      if (args[0] === "agent") {
        return jsonResult([
          {
            id: "agent-source",
            name: "Codex Full Access Worker",
            model: "pa/gpt-5.5",
            runtime_id: "rt-codex",
            custom_args: ["-c", "approval_policy=never"],
            max_concurrent_tasks: 3,
          },
        ]);
      }
      if (args[0] === "skill") {
        return jsonResult([{ id: "skill-review", name: "launch-review" }]);
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    },
  });

  assert.deepEqual(calls, [
    ["daemon", "status"],
    ["workspace", "list", "--output", "json"],
    ["project", "list", "--output", "json"],
    ["runtime", "list", "--output", "json"],
    ["agent", "list", "--output", "json"],
    ["skill", "list", "--output", "json"],
  ]);
  assert.equal(environment.ok, true);
  assert.equal(environment.daemon.status, "running");
  assert.equal(environment.workspace.id, "ws-1");
  assert.equal(environment.project.id, "project-1");
  assert.equal(environment.runtime.id, "rt-codex");
  assert.equal(environment.sourceAgent.id, "agent-source");
  assert.deepEqual(environment.skills.map((skill) => skill.name), ["launch-review"]);
});

test("starts independent Multica environment reads in parallel", async () => {
  const calls = [];
  const pending = new Map();
  const environmentPromise = discoverMulticaEnvironment({
    exec: async (args) => {
      calls.push(args);
      const key = args.join(" ");
      return new Promise((resolve) => {
        pending.set(key, resolve);
      });
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [
    ["daemon", "status"],
    ["workspace", "list", "--output", "json"],
    ["project", "list", "--output", "json"],
    ["runtime", "list", "--output", "json"],
    ["agent", "list", "--output", "json"],
    ["skill", "list", "--output", "json"],
  ]);

  pending.get("daemon status")(textResult("Daemon:      running\nVersion:     0.3.15\n"));
  pending.get("workspace list --output json")(jsonResult([{ id: "ws-1", name: "SparkProject", slug: "sparkproject" }]));
  pending.get("project list --output json")(jsonResult([{ id: "project-1", title: "MulticaPlusPlus", workspace_id: "ws-1" }]));
  pending.get("runtime list --output json")(jsonResult([{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }]));
  pending.get("agent list --output json")(jsonResult([{ id: "agent-source", name: "Codex Full Access Worker", runtime_id: "rt-codex" }]));
  pending.get("skill list --output json")(jsonResult([]));

  const environment = await environmentPromise;
  assert.equal(environment.ok, true);
});

test("retries transient Multica read failures during environment discovery", async () => {
  const attempts = new Map();
  const environment = await discoverMulticaEnvironment({
    exec: async (args) => {
      const key = args.join(" ");
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      if (args[0] === "runtime" && attempts.get(key) === 1) {
        return { stdout: "", stderr: 'Get "https://api.multica.ai/api/runtimes": EOF', code: 1 };
      }
      if (args[0] === "daemon") {
        return textResult("Daemon:      running\nVersion:     0.3.15\n");
      }
      if (args[0] === "workspace") {
        return jsonResult([{ id: "ws-1", name: "SparkProject", slug: "sparkproject" }]);
      }
      if (args[0] === "project") {
        return jsonResult([{ id: "project-1", title: "MulticaPlusPlus", workspace_id: "ws-1" }]);
      }
      if (args[0] === "runtime") {
        return jsonResult([{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }]);
      }
      if (args[0] === "agent") {
        return jsonResult([{ id: "agent-source", name: "Codex Full Access Worker", model: "pa/gpt-5.5", runtime_id: "rt-codex" }]);
      }
      if (args[0] === "skill") {
        return jsonResult([]);
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    },
  });

  assert.equal(environment.ok, true);
  assert.equal(attempts.get("runtime list --output json"), 2);
});

test("redacts secret-like custom args in discovered environment output", async () => {
  const environment = await discoverMulticaEnvironment({
    exec: async (args) => {
      if (args[0] === "daemon") {
        return textResult("Daemon:      running\nVersion:     0.3.15\n");
      }
      if (args[0] === "workspace") {
        return jsonResult([{ id: "ws-1", name: "SparkProject", slug: "sparkproject" }]);
      }
      if (args[0] === "project") {
        return jsonResult([{ id: "project-1", title: "MulticaPlusPlus", workspace_id: "ws-1" }]);
      }
      if (args[0] === "runtime") {
        return jsonResult([{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }]);
      }
      if (args[0] === "agent") {
        return jsonResult([{ id: "agent-source", name: "Codex Full Access Worker", model: "pa/gpt-5.5", runtime_id: "rt-codex", custom_args: ["--api-key", "sk-hidden"] }]);
      }
      if (args[0] === "skill") {
        return jsonResult([]);
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    },
  });

  assert.equal(JSON.stringify(environment).includes("sk-hidden"), false);
  assert.equal(environment.sourceAgent.customArgsRedacted, true);
  assert.deepEqual(environment.sourceAgent.customArgs, []);
});

test("builds a fail-closed create plan without env writes", () => {
  const plan = buildAgentConfigPlan({
    environment: localEnvironment(),
    presetId: "planner",
    createdAt: "2026-06-04T08:00:00.000Z",
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.mode, "create");
  assert.equal(plan.confirmationToken, "APPLY-MULTICA-AGENT-CONFIG");
  assert.equal(plan.target.name, "Multica++ Planner Agent");
  assert.equal(plan.target.runtimeId, "rt-codex");
  assert.equal(plan.target.model, "pa/gpt-5.5");
  assert.deepEqual(
    plan.operations.filter((operation) => operation.type === "env:set"),
    [],
  );

  const create = plan.operations.find((operation) => operation.type === "agent:create");
  assert.ok(create, "create operation should exist");
  assert.deepEqual(create.args.slice(0, 2), ["agent", "create"]);
  assert.ok(create.args.includes("--runtime-id"));
  assert.ok(create.args.includes("rt-codex"));
  assert.ok(create.args.includes("--custom-args"));
  assert.match(create.displayCommand, /multica agent create/);
  assert.match(plan.summary, /Multica\+\+ Planner Agent/);
});

test("does not echo secret-like custom args into CLI plan commands", () => {
  const plan = buildAgentConfigPlan({
    environment: localEnvironment({
      sourceAgent: {
        ...localEnvironment().sourceAgent,
        customArgs: ["--api-key", "sk-should-not-appear"],
      },
    }),
    presetId: "planner",
  });

  const create = plan.operations.find((operation) => operation.type === "agent:create");
  assert.ok(create, "create operation should exist");
  assert.equal(create.args.includes("--custom-args"), false);
  assert.equal(JSON.stringify(plan).includes("sk-should-not-appear"), false);
  assert.ok(plan.warnings.includes("blocked:customArgsSecretLike"));
});

test("dry-run apply does not execute write operations", async () => {
  const plan = buildAgentConfigPlan({ environment: localEnvironment(), presetId: "review" });
  const calls = [];

  const result = await applyAgentConfigPlan({
    plan,
    exec: async (args) => {
      calls.push(args);
      return jsonResult({ id: "should-not-run" });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry-run");
  assert.equal(calls.length, 0);
  assert.equal(result.operations.every((operation) => operation.status === "planned"), true);
});

test("execute requires confirmation and resolves created agent id for skill assignment", async () => {
  const plan = buildAgentConfigPlan({
    environment: localEnvironment({
      skills: [
        { id: "skill-launch", name: "launch-review" },
        { id: "skill-ledger", name: "plan-ledger" },
      ],
    }),
    presetId: "planner",
  });

  await assert.rejects(
    applyAgentConfigPlan({ plan, execute: true, confirm: "wrong", exec: async () => jsonResult({}) }),
    /confirmation/i,
  );

  const calls = [];
  const result = await applyAgentConfigPlan({
    plan,
    execute: true,
    confirm: "APPLY-MULTICA-AGENT-CONFIG",
    exec: async (args) => {
      calls.push(args);
      if (args[0] === "agent" && args[1] === "create") {
        return jsonResult({ id: "agent-created", name: "Multica++ Planner Agent" });
      }
      if (args[0] === "agent" && args[1] === "skills") {
        return jsonResult([{ id: "skill-launch" }, { id: "skill-ledger" }]);
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "execute");
  assert.deepEqual(calls.map((args) => args.slice(0, 3)), [
    ["agent", "create", "--name"],
    ["agent", "skills", "add"],
  ]);
  assert.equal(calls[1][3], "agent-created");
  assert.ok(calls[1].includes("--skill-ids"));
  assert.ok(calls[1].includes("skill-launch,skill-ledger"));
});

test("plans an update when the target agent already exists", () => {
  const plan = buildAgentConfigPlan({
    environment: localEnvironment({
      agents: [
        ...localEnvironment().agents,
        { id: "agent-existing", name: "Multica++ Review Agent", runtime_id: "rt-codex" },
      ],
    }),
    presetId: "review",
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.mode, "update");
  const update = plan.operations.find((operation) => operation.type === "agent:update");
  assert.ok(update, "update operation should exist");
  assert.deepEqual(update.args.slice(0, 3), ["agent", "update", "agent-existing"]);
});

test("builds an image2 Codex agent plan that creates the local Paigod skill and binds it", () => {
  const plan = buildImage2AgentConfigPlan({
    environment: localEnvironment(),
    skillPath: "C:\\Users\\PPIO\\.codex\\skills\\paigod-imagegen\\SKILL.md",
    createdAt: "2026-06-04T09:00:00.000Z",
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.target.name, "Multica++ Image2 Codex Agent");
  assert.equal(plan.target.runtimeId, "rt-codex");
  assert.equal(plan.target.model, "pa/gpt-5.5");
  assert.equal(plan.confirmationToken, "CREATE-MULTICA-IMAGE2-CODEX-AGENT");
  assert.match(plan.target.instructions, /高质量 Image2 生成 Agent/);
  assert.match(plan.target.instructions, /paigod-imagegen/);

  assert.deepEqual(plan.operations.map((operation) => operation.type), [
    "skill:create",
    "agent:create",
    "agent:skills:add",
  ]);
  const skillCreate = plan.operations[0];
  assert.deepEqual(skillCreate.args.slice(0, 2), ["skill", "create"]);
  assert.ok(skillCreate.args.includes("--content-file"));
  assert.ok(skillCreate.args.includes("C:\\Users\\PPIO\\.codex\\skills\\paigod-imagegen\\SKILL.md"));

  const agentCreate = plan.operations[1];
  assert.deepEqual(agentCreate.args.slice(0, 2), ["agent", "create"]);
  assert.ok(agentCreate.args.includes("--custom-args"));
  assert.ok(agentCreate.args.includes("pa/gpt-5.5"));

  const bind = plan.operations[2];
  assert.equal(bind.args[3], "__TARGET_AGENT_ID__");
  assert.equal(bind.args[5], "__PAIGOD_IMAGEGEN_SKILL_ID__");
});

test("image2 plan updates existing Paigod skill and existing image2 agent", () => {
  const plan = buildImage2AgentConfigPlan({
    environment: localEnvironment({
      skills: [{ id: "skill-existing", name: "paigod-imagegen" }],
      agents: [
        ...localEnvironment().agents,
        { id: "agent-existing", name: "Multica++ Image2 Codex Agent", runtime_id: "rt-codex" },
      ],
    }),
    skillPath: "C:\\Users\\PPIO\\.codex\\skills\\paigod-imagegen\\SKILL.md",
  });

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.operations.map((operation) => operation.type), [
    "skill:update",
    "agent:update",
    "agent:skills:add",
  ]);
  assert.deepEqual(plan.operations[0].args.slice(0, 3), ["skill", "update", "skill-existing"]);
  assert.deepEqual(plan.operations[1].args.slice(0, 3), ["agent", "update", "agent-existing"]);
  assert.equal(plan.operations[2].args[3], "agent-existing");
  assert.equal(plan.operations[2].args[5], "skill-existing");
});

test("execute image2 plan resolves created skill id before binding it to the created agent", async () => {
  const plan = buildImage2AgentConfigPlan({
    environment: localEnvironment(),
    skillPath: "C:\\Users\\PPIO\\.codex\\skills\\paigod-imagegen\\SKILL.md",
  });
  const calls = [];

  const result = await applyAgentConfigPlan({
    plan,
    execute: true,
    confirm: "CREATE-MULTICA-IMAGE2-CODEX-AGENT",
    exec: async (args) => {
      calls.push(args);
      if (args[0] === "skill" && args[1] === "create") {
        return jsonResult({ id: "skill-created", name: "paigod-imagegen" });
      }
      if (args[0] === "agent" && args[1] === "create") {
        return jsonResult({ id: "agent-created", name: "Multica++ Image2 Codex Agent" });
      }
      if (args[0] === "agent" && args[1] === "skills") {
        return jsonResult([{ id: "skill-created", name: "paigod-imagegen" }]);
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.targetAgentId, "agent-created");
  assert.equal(result.skillIds.paigodImagegen, "skill-created");
  assert.deepEqual(calls.map((args) => args.slice(0, 3)), [
    ["skill", "create", "--name"],
    ["agent", "create", "--name"],
    ["agent", "skills", "add"],
  ]);
  assert.equal(calls[2][3], "agent-created");
  assert.equal(calls[2][5], "skill-created");
});

test("cli agent-config apply defaults to dry-run with a mock multica executable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-agent-config-cli-"));
  try {
    const mockClient = join(dir, "mock-multica.js");
    const callsPath = join(dir, "calls.jsonl");
    await writeFile(mockClient, `#!/usr/bin/env node
const { appendFileSync } = await import("node:fs");
const callsPath = ${JSON.stringify(callsPath)};
const args = process.argv.slice(2);
appendFileSync(callsPath, JSON.stringify(args) + "\\n");
function out(value) { process.stdout.write(JSON.stringify(value)); }
if (args[0] === "daemon" && args[1] === "status") {
  process.stdout.write("Daemon:      running\\nVersion:     0.3.15\\n");
} else if (args[0] === "workspace" && args[1] === "list") {
  out([{ id: "ws-1", name: "SparkProject", slug: "sparkproject" }]);
} else if (args[0] === "project" && args[1] === "list") {
  out([{ id: "project-1", title: "MulticaPlusPlus", workspace_id: "ws-1" }]);
} else if (args[0] === "runtime" && args[1] === "list") {
  out([{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }]);
} else if (args[0] === "agent" && args[1] === "list") {
  out([{ id: "agent-source", name: "Codex Full Access Worker", model: "pa/gpt-5.5", runtime_id: "rt-codex" }]);
} else if (args[0] === "skill" && args[1] === "list") {
  out([]);
} else if (args[0] === "agent" && args[1] === "create") {
  throw new Error("dry-run should not create an agent");
} else {
  console.error("unexpected command", args.join(" "));
  process.exit(1);
}
`);

    const result = spawnSync(
      process.execPath,
      ["src/cli.js", "agent-config", "apply", "--cli-path", mockClient, "--preset", "planner", "--output", "json"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, "dry-run");
    assert.equal(payload.operations[0].status, "planned");

    const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args[0] === "agent" && args[1] === "create"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli agent-config apply can execute the image2 preset with a mock multica executable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-image2-cli-"));
  try {
    const mockClient = join(dir, "mock-multica.js");
    const callsPath = join(dir, "calls.jsonl");
    const skillPath = join(dir, "SKILL.md");
    await writeFile(skillPath, "---\nname: paigod-imagegen\n---\n# Paigod Imagegen\n", "utf8");
    await writeFile(mockClient, `#!/usr/bin/env node
const { appendFileSync } = await import("node:fs");
const callsPath = ${JSON.stringify(callsPath)};
const args = process.argv.slice(2);
appendFileSync(callsPath, JSON.stringify(args) + "\\n");
function out(value) { process.stdout.write(JSON.stringify(value)); }
if (args[0] === "daemon" && args[1] === "status") {
  process.stdout.write("Daemon:      running\\nVersion:     0.3.15\\n");
} else if (args[0] === "workspace" && args[1] === "list") {
  out([{ id: "ws-1", name: "SparkProject", slug: "sparkproject" }]);
} else if (args[0] === "project" && args[1] === "list") {
  out([{ id: "project-1", title: "MulticaPlusPlus", workspace_id: "ws-1" }]);
} else if (args[0] === "runtime" && args[1] === "list") {
  out([{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }]);
} else if (args[0] === "agent" && args[1] === "list") {
  out([{ id: "agent-source", name: "Codex Full Access Worker", model: "pa/gpt-5.5", runtime_id: "rt-codex", custom_args: ["-c", "approval_policy=never"] }]);
} else if (args[0] === "skill" && args[1] === "list") {
  out([]);
} else if (args[0] === "skill" && args[1] === "create") {
  out({ id: "skill-created", name: "paigod-imagegen" });
} else if (args[0] === "agent" && args[1] === "create") {
  out({ id: "agent-created", name: "Multica++ Image2 Codex Agent" });
} else if (args[0] === "agent" && args[1] === "skills" && args[2] === "add") {
  out([{ id: "skill-created", name: "paigod-imagegen" }]);
} else {
  console.error("unexpected command", args.join(" "));
  process.exit(1);
}
`);

    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "agent-config",
        "apply",
        "--cli-path",
        mockClient,
        "--preset",
        "image2",
        "--skill-path",
        skillPath,
        "--execute",
        "--confirm",
        "CREATE-MULTICA-IMAGE2-CODEX-AGENT",
        "--output",
        "json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.targetAgentId, "agent-created");
    assert.equal(payload.skillIds.paigodImagegen, "skill-created");

    const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(calls.slice(-3).map((args) => args.slice(0, 3)), [
      ["skill", "create", "--name"],
      ["agent", "create", "--name"],
      ["agent", "skills", "add"],
    ]);
    assert.equal(calls.at(-1)[3], "agent-created");
    assert.equal(calls.at(-1)[5], "skill-created");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
      customArgs: [
        "-c",
        "approval_policy=never",
        "-c",
        'sandbox_mode="danger-full-access"',
      ],
      maxConcurrentTasks: 3,
    },
    agents: [
      {
        id: "agent-source",
        name: "Codex Full Access Worker",
        runtime_id: "rt-codex",
      },
    ],
    runtimes: [{ id: "rt-codex", provider: "codex", name: "Codex Local", status: "online" }],
    skills: [],
    warnings: [],
    ...overrides,
  };
}

function jsonResult(value) {
  return { stdout: JSON.stringify(value), stderr: "", code: 0 };
}

function textResult(stdout) {
  return { stdout, stderr: "", code: 0 };
}
