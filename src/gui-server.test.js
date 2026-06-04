import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createGuiServer } from "./gui-server.js";

test("gui server creates the image2 agent through a POST button endpoint and writes audit log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-server-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      exec: async (args) => {
        calls.push(args);
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
        if (args[0] === "agent" && args[1] === "list") {
          return jsonResult([{ id: "agent-source", name: "Codex Full Access Worker", model: "pa/gpt-5.5", runtime_id: "rt-codex", custom_args: ["-c", "approval_policy=never"] }]);
        }
        if (args[0] === "skill" && args[1] === "list") {
          return jsonResult([]);
        }
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

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/agent-config/image2/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "CREATE-MULTICA-IMAGE2-CODEX-AGENT" }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.result.targetAgentId, "agent-created");
      assert.equal(payload.result.skillIds.paigodImagegen, "skill-created");
      assert.deepEqual(calls.slice(-3).map((args) => args.slice(0, 3)), [
        ["skill", "create", "--name"],
        ["agent", "create", "--name"],
        ["agent", "skills", "add"],
      ]);

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.length, 1);
      assert.equal(auditEvents[0].event_type, "image2_agent_create");
      assert.equal(auditEvents[0].status, "success");
      assert.equal(auditEvents[0].target_agent_id, "agent-created");
      assert.equal(JSON.stringify(auditEvents).includes("sk-"), false);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server rejects image2 creation without the confirmation token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-server-reject-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      exec: async () => {
        throw new Error("should not run multica without confirmation");
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/agent-config/image2/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "wrong" }),
      });

      assert.equal(response.status, 403);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.match(payload.error, /confirmation/i);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server uses a bounded discovery timeout for preset preview failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-timeout-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      discoveryTimeoutMs: 25,
      discoveryRetries: 0,
      exec: async () => new Promise(() => {}),
    });

    try {
      const startedAt = Date.now();
      const response = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets/team-gui-builder/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overrides: {
            agent: {
              name: "Edited GUI Builder",
            },
          },
        }),
      });
      const elapsed = Date.now() - startedAt;
      const payload = await response.json();

      assert.equal(response.status, 500);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /timed out/i);
      assert.ok(elapsed < 1000, `expected bounded failure, took ${elapsed}ms`);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server uses a bounded discovery timeout for preset create failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-create-timeout-"));
  try {
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath: join(dir, "audit.jsonl"),
      discoveryTimeoutMs: 25,
      discoveryRetries: 0,
      exec: async () => new Promise(() => {}),
    });

    try {
      const startedAt = Date.now();
      const response = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets/team-gui-builder/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "CREATE-MULTICA-AGENT-FROM-PRESET",
          overrides: {
            agent: {
              name: "Edited GUI Builder",
            },
          },
        }),
      });
      const elapsed = Date.now() - startedAt;
      const payload = await response.json();

      assert.equal(response.status, 500);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /timed out/i);
      assert.ok(elapsed < 1000, `expected bounded failure, took ${elapsed}ms`);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gui server lists presets and creates an agent from an edited team preset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multica-gui-preset-"));
  try {
    const auditPath = join(dir, "audit.jsonl");
    const calls = [];
    const server = await createGuiServer({
      port: 0,
      host: "127.0.0.1",
      auditPath,
      exec: async (args) => {
        calls.push(args);
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
        if (args[0] === "agent" && args[1] === "list") {
          return jsonResult([{ id: "agent-source", name: "Codex Full Access Worker", model: "pa/gpt-5.5", runtime_id: "rt-codex", custom_args: ["-c", "approval_policy=never"] }]);
        }
        if (args[0] === "skill" && args[1] === "list") {
          return jsonResult([{ id: "skill-launch", name: "launch-review" }]);
        }
        if (args[0] === "agent" && args[1] === "create") {
          return jsonResult({ id: "agent-preset-created", name: "Edited GUI Builder" });
        }
        if (args[0] === "agent" && args[1] === "skills") {
          return jsonResult([{ id: "skill-launch", name: "launch-review" }]);
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });

    try {
      const listResponse = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets`);
      assert.equal(listResponse.status, 200);
      const listPayload = await listResponse.json();
      assert.equal(listPayload.ok, true);
      assert.ok(listPayload.presets.some((preset) => preset.source === "team"));

      const previewResponse = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets/team-gui-builder/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overrides: {
            agent: {
              name: "Edited GUI Builder",
              instructions: "Implement the preset-backed GUI flow.",
            },
            skills: [{ name: "launch-review" }],
          },
        }),
      });
      assert.equal(previewResponse.status, 200);
      const previewPayload = await previewResponse.json();
      assert.equal(previewPayload.ok, true);
      assert.equal(previewPayload.plan.target.name, "Edited GUI Builder");
      assert.ok(previewPayload.plan.blockedOperations.some((operation) => operation.type === "agent:mcp:set"));

      const createResponse = await fetch(`http://127.0.0.1:${server.port}/api/agent-presets/team-gui-builder/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "CREATE-MULTICA-AGENT-FROM-PRESET",
          overrides: {
            agent: {
              name: "Edited GUI Builder",
              instructions: "Implement the preset-backed GUI flow.",
            },
            skills: [{ name: "launch-review" }],
          },
        }),
      });
      assert.equal(createResponse.status, 200);
      const createPayload = await createResponse.json();
      assert.equal(createPayload.ok, true);
      assert.equal(createPayload.result.targetAgentId, "agent-preset-created");
      assert.ok(calls.some((args) => args[0] === "agent" && args[1] === "create"));

      const auditEvents = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(auditEvents.at(-1).event_type, "agent_preset_create");
      assert.equal(auditEvents.at(-1).target_agent_id, "agent-preset-created");
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function jsonResult(value) {
  return { stdout: JSON.stringify(value), stderr: "", code: 0 };
}

function textResult(stdout) {
  return { stdout, stderr: "", code: 0 };
}
