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

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/api/agent-config/image2/create");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.equal(JSON.parse(fetchCalls[0].options.body).confirm, "CREATE-MULTICA-IMAGE2-CODEX-AGENT");
  assert.ok(document.textContent().includes("Created in Multica"));
  assert.ok(document.textContent().includes("agent-created"));
  assert.ok(clickLog.includes("data-action:create-image2-agent"));
});

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
      return nodes.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-nav-target]") return [];
      if (selector === "[data-view]") return [];
      if (selector === ".cli-command-row code") return [];
      return [];
    },
    textContent() {
      return Array.from(nodes.values()).map((node) => node.textContentDeep()).join("\n");
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
  ];
  selectors.forEach((selector) => nodes.set(selector, element(selector.replace(/^[#.]/, "div"))));
  nodes.set("[data-action='open-agent-config']", actionButton("open-agent-config"));
  nodes.set("[data-action='create-image2-agent']", null);

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
