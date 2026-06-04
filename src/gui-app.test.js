import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";

test("GUI button posts to the local Image2 agent creation endpoint", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document, clickLog } = createTinyDocument();
  const fetchCalls = [];
  const context = createContext({
    document,
    window: {},
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            result: {
              targetAgentId: "agent-created",
              skillIds: { paigodImagegen: "skill-created" },
            },
          };
        },
      };
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);

  const openButton = document.querySelector("[data-action='open-agent-config']");
  openButton.dispatchEvent({ type: "click", target: openButton });

  const createButton = document.querySelector("[data-action='create-image2-agent']");
  assert.ok(createButton, "Image2 create button should render");
  createButton.dispatchEvent({ type: "click", target: createButton });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const image2Call = fetchCalls.find((call) => call.url === "/api/agent-config/image2/create");
  assert.ok(image2Call, "Image2 create endpoint should be called");
  assert.equal(image2Call.options.method, "POST");
  assert.equal(JSON.parse(image2Call.options.body).confirm, "CREATE-MULTICA-IMAGE2-CODEX-AGENT");
  assert.ok(document.textContent().includes("Created in Multica"));
  assert.ok(document.textContent().includes("agent-created"));
  assert.ok(clickLog.includes("data-action:create-image2-agent"));
});

test("GUI renders plugin and team presets, previews an edited preset, and creates it", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document, clickLog } = createTinyDocument();
  const fetchCalls = [];
  const context = createContext({
    document,
    window: {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") {
        return responseJson({
          ok: true,
          presets: [
            {
              id: "planner",
              source: "plugin",
              target: "agent",
              name: "Planner Agent",
              description: "Plan work.",
              role: "Plan owner",
              createdBy: "Multica++",
              useCases: ["planning"],
              agent: {
                name: "Multica++ Planner Agent",
                description: "Planner",
                instructions: "Plan carefully.",
                model: "pa/gpt-5.5",
                runtimeHint: "local-codex",
                visibility: "private",
                maxConcurrentTasks: 1,
              },
              skills: [{ name: "launch-review" }],
              mcpServers: [],
              permissions: {
                scopes: ["workspace:read"],
                ttl: "1 hour",
                approvalRequired: true,
                riskLevel: "low",
              },
              environment: [],
              guardrails: ["dry-run first"],
            },
            {
              id: "team-gui-builder",
              source: "team",
              target: "agent",
              name: "Team GUI Builder Agent",
              description: "Build GUI.",
              role: "GUI builder",
              createdBy: "PPIO Team",
              useCases: ["gui"],
              agent: {
                name: "Team GUI Builder Agent",
                description: "GUI builder",
                instructions: "Build the GUI.",
                model: "pa/gpt-5.5",
                runtimeHint: "local-codex",
                visibility: "private",
                maxConcurrentTasks: 1,
              },
              skills: [{ name: "launch-review" }],
              mcpServers: [{ name: "filesystem", purpose: "read files", required: true }],
              permissions: {
                scopes: ["workspace:read", "repo:write"],
                ttl: "2 hours",
                approvalRequired: true,
                riskLevel: "medium",
              },
              environment: [{ key: "GITHUB_TOKEN", pathHint: "GitHub CLI keyring", required: false }],
              guardrails: ["run npm test"],
            },
          ],
        });
      }
      if (url === "/api/agent-presets/team-gui-builder/plan") {
        return responseJson({
          ok: true,
          plan: {
            ok: true,
            target: { name: "Edited Team GUI Agent" },
            blockedOperations: [{ type: "agent:mcp:set" }],
          },
        });
      }
      if (url === "/api/agent-presets/team-gui-builder/create") {
        return responseJson({
          ok: true,
          result: { targetAgentId: "agent-from-preset" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.querySelector("[data-agent-preset-id='team-gui-builder']"));

  assert.ok(document.textContent().includes("Plugin Presets"));
  assert.ok(document.textContent().includes("Team Presets"));
  assert.ok(document.textContent().includes("Team GUI Builder Agent"));

  const teamPreset = document.querySelector("[data-agent-preset-id='team-gui-builder']");
  teamPreset.dispatchEvent({ type: "click", target: teamPreset });
  document.querySelector("#preset-agent-name").value = "Edited Team GUI Agent";
  document.querySelector("#preset-agent-instructions").value = "Implement the edited preset flow.";

  const previewButton = document.querySelector("[data-action='preview-selected-preset']");
  previewButton.dispatchEvent({ type: "click", target: previewButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const createButton = document.querySelector("[data-action='create-selected-preset-agent']");
  createButton.dispatchEvent({ type: "click", target: createButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fetchCalls.some((call) => call.url === "/api/agent-presets"), true);
  assert.equal(fetchCalls.some((call) => call.url === "/api/agent-presets/team-gui-builder/plan"), true);
  assert.equal(fetchCalls.some((call) => call.url === "/api/agent-presets/team-gui-builder/create"), true);
  const createCall = fetchCalls.find((call) => call.url === "/api/agent-presets/team-gui-builder/create");
  assert.equal(JSON.parse(createCall.options.body).confirm, "CREATE-MULTICA-AGENT-FROM-PRESET");
  assert.ok(document.textContent().includes("agent-from-preset"));
  assert.ok(clickLog.includes("data-action:create-selected-preset-agent"));
});

test("GUI creates a team preset and refreshes the preset list", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document, clickLog } = createTinyDocument();
  const fetchCalls = [];
  const presets = [
    {
      id: "planner",
      source: "plugin",
      target: "agent",
      name: "Planner Agent",
      description: "Plan work.",
      role: "Plan owner",
      createdBy: "Multica++",
      useCases: ["planning"],
      agent: {
        name: "Multica++ Planner Agent",
        description: "Planner",
        instructions: "Plan carefully.",
        model: "pa/gpt-5.5",
        runtimeHint: "local-codex",
        visibility: "private",
        maxConcurrentTasks: 1,
      },
      skills: [{ name: "launch-review" }],
      mcpServers: [],
      permissions: { scopes: ["workspace:read"], ttl: "1 hour", approvalRequired: true, riskLevel: "low" },
      environment: [],
      guardrails: ["dry-run first"],
    },
  ];
  const context = createContext({
    document,
    window: {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets" && options.method === "POST") {
        const body = JSON.parse(options.body);
        const preset = {
          id: "team-image-review-agent",
          source: "team",
          target: "agent",
          name: body.name,
          description: body.description,
          role: body.role,
          createdBy: body.createdBy,
          useCases: ["team preset"],
          agent: {
            name: body.name,
            description: body.description,
            instructions: body.agent.instructions,
            model: body.agent.model,
            runtimeHint: body.agent.runtimeHint,
            visibility: "private",
            maxConcurrentTasks: 1,
          },
          skills: body.skills,
          mcpServers: body.mcpServers,
          permissions: body.permissions,
          environment: body.environment,
          guardrails: body.guardrails,
        };
        presets.push(preset);
        return responseJson({ ok: true, preset });
      }
      if (url === "/api/agent-presets") {
        return responseJson({ ok: true, presets });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.textContent().includes("Planner Agent"));

  document.querySelector("#new-preset-name").value = "Team Image Review Agent";
  document.querySelector("#new-preset-created-by").value = "DesignOps";
  document.querySelector("#new-preset-description").value = "Review generated image concepts before sharing.";
  document.querySelector("#new-preset-instructions").value = "Review generated images for quality and launch risk.";

  const createButton = document.querySelector("[data-action='create-team-preset']");
  createButton.dispatchEvent({ type: "click", target: createButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const createCall = fetchCalls.find((call) => call.url === "/api/agent-presets" && call.options.method === "POST");
  assert.ok(createCall, "team preset create endpoint should be called");
  const requestBody = JSON.parse(createCall.options.body);
  assert.equal(requestBody.name, "Team Image Review Agent");
  assert.equal(requestBody.createdBy, "DesignOps");
  assert.ok(document.textContent().includes("Team Image Review Agent"));
  assert.ok(document.textContent().includes("Team preset created"));
  assert.ok(clickLog.includes("data-action:create-team-preset"));
});

function responseJson(value) {
  return {
    ok: true,
    async json() {
      return value;
    },
  };
}

async function waitFor(fn) {
  for (let index = 0; index < 20; index += 1) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}

function createTinyDocument() {
  const clickHandlers = [];
  const clickLog = [];
  const nodes = new Map();
  const document = {
    readyState: "complete",
    body: element("body"),
    createElement: (tag) => element(tag),
    addEventListener(type, handler) {
      if (type === "click") clickHandlers.push(handler);
    },
    querySelector(selector) {
      if (selector.startsWith("[data-agent-preset-id='")) {
        const id = selector.slice("[data-agent-preset-id='".length, -2);
        return findNodeByAttribute(document.body, "data-agent-preset-id", id);
      }
      if (selector.startsWith("[data-action='")) {
        const action = selector.slice("[data-action='".length, -2);
        return nodes.get(selector) ?? findNodeByAttribute(document.body, "data-action", action);
      }
      return nodes.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-nav-target]") return [];
      if (selector === "[data-view]") return [];
      if (selector === ".cli-command-row code") return [];
      return [];
    },
    textContent() {
      return Array.from(nodes.values()).filter(Boolean).map((node) => node.textContentDeep()).join("\n");
    },
  };

  const selectors = [
    "#app-shell",
    "#project-value",
    "#agent-value",
    "#runtime-value",
    "#run-status-value",
    "#goal-summary",
    "#plan-list",
    "#permission-summary",
    "#permission-scopes",
    "#permission-risk",
    "#activity-feed",
    "#records-list",
    "#settings-panel",
    "#placeholder-heading",
    "#placeholder-content",
    "#agent-config-modal",
    "#agent-config-presets",
    "#agent-config-preview",
    "#agent-config-status",
    "#agent-config-feedback",
    "#plugin-preset-list",
    "#team-preset-list",
    "#preset-detail",
    "#preset-agent-name",
    "#preset-agent-instructions",
    "#preset-config-summary",
    "#preset-status",
    "#preset-feedback",
    "#new-preset-name",
    "#new-preset-created-by",
    "#new-preset-description",
    "#new-preset-instructions",
    "#new-preset-feedback",
  ];
  selectors.forEach((selector) => {
    const node = element(selector.replace(/^[#.]/, "div"));
    nodes.set(selector, node);
    document.body.appendChild(node);
  });
  nodes.get("#plugin-preset-list").textContent = "Plugin Presets";
  nodes.get("#team-preset-list").textContent = "Team Presets";
  nodes.set("[data-action='open-agent-config']", actionButton("open-agent-config"));
  nodes.set("[data-action='preview-selected-preset']", actionButton("preview-selected-preset"));
  nodes.set("[data-action='create-selected-preset-agent']", actionButton("create-selected-preset-agent"));
  nodes.set("[data-action='create-team-preset']", actionButton("create-team-preset"));
  nodes.set("[data-action='create-image2-agent']", null);
  document.body.appendChild(nodes.get("[data-action='open-agent-config']"));
  document.body.appendChild(nodes.get("[data-action='preview-selected-preset']"));
  document.body.appendChild(nodes.get("[data-action='create-selected-preset-agent']"));
  document.body.appendChild(nodes.get("[data-action='create-team-preset']"));

  function actionButton(action) {
    const node = element("button");
    node.setAttribute("data-action", action);
    node.dispatchEvent = (event) => {
      clickLog.push(`data-action:${action}`);
      clickHandlers.forEach((handler) => handler({ ...event, target: node }));
    };
    return node;
  }

  function element(tag) {
    const attributes = new Map();
    return {
      tag,
      hidden: false,
      children: [],
      firstChild: null,
      className: "",
      id: "",
      style: {},
      type: "",
      checked: false,
      value: "",
      textContent: "",
      appendChild(child) {
        this.children.push(child);
        this.firstChild = this.children[0] ?? null;
        if (child?.getAttribute?.("data-action") === "create-image2-agent") {
          nodes.set("[data-action='create-image2-agent']", child);
        }
        const presetId = child?.getAttribute?.("data-agent-preset-id");
        if (presetId) {
          nodes.set(`[data-agent-preset-id='${presetId}']`, child);
        }
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter((item) => item !== child);
        this.firstChild = this.children[0] ?? null;
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      classList: {
        toggle() {},
      },
      closest(selector) {
        if (selector === "[data-action]" && attributes.has("data-action")) return this;
        if (selector === "[data-agent-preset]" && attributes.has("data-agent-preset")) return this;
        if (selector === "[data-nav-target]" && attributes.has("data-nav-target")) return this;
        return null;
      },
      matches() {
        return false;
      },
      dispatchEvent(event) {
        if (attributes.has("data-action")) {
          clickLog.push(`data-action:${attributes.get("data-action")}`);
        }
        clickHandlers.forEach((handler) => handler({ ...event, target: this }));
      },
      textContentDeep() {
        return [this.textContent, ...this.children.map((child) => child.textContentDeep?.() ?? child.textContent ?? "")]
          .filter(Boolean)
          .join(" ");
      },
    };
  }

  return { document, clickLog };
}

function findNodeByAttribute(root, name, value) {
  if (!root) return null;
  if (root.getAttribute?.(name) === value) return root;
  for (const child of root.children ?? []) {
    const match = findNodeByAttribute(child, name, value);
    if (match) return match;
  }
  return null;
}
