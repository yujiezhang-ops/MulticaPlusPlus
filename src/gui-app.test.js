import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";

test("GUI design system documents desktop-first Chinese console constraints", async () => {
  const designDoc = await readFile(new URL("../DESIGN.md", import.meta.url), "utf8");

  assert.ok(designDoc.includes("desktop-first operations console"));
  assert.ok(designDoc.includes("Simplified Chinese"));
  assert.ok(designDoc.includes("1280px to 1600px"));
  assert.ok(designDoc.includes("low-opacity surface transitions"));
  assert.ok(designDoc.includes("No new Multica write behavior"));
});

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
  assert.ok(document.textContent().includes("已在 Multica 创建"));
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

  assert.ok(document.textContent().includes("插件预制体"));
  assert.ok(document.textContent().includes("团队预制体"));
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

test("GUI settings renders Chinese-first language setting with English reserved", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document } = createTinyDocument();
  const context = createContext({
    document,
    window: {},
    fetch: async (url) => {
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.textContent().includes("界面语言"));

  const pageText = document.textContent();
  assert.ok(pageText.includes("界面语言"));
  assert.ok(pageText.includes("中文"));
  assert.ok(pageText.includes("English"));
  assert.ok(pageText.includes("预留"));
});

test("GUI settings renders Multica Agent assisted configuration without secret fields", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document } = createTinyDocument();
  const context = createContext({
    document,
    window: {},
    fetch: async (url) => {
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.textContent().includes("Multica Agent 辅助"));

  const pageText = document.textContent();
  assert.ok(pageText.includes("Multica Agent 辅助"));
  assert.ok(pageText.includes("自动选择"));
  assert.ok(pageText.includes("Agent"));
  assert.ok(pageText.includes("超时"));
  assert.ok(pageText.includes("检测 Agent"));
  assert.ok(pageText.includes("高级：本地 CLI 直连 provider"));
  assert.ok(pageText.includes("读取密钥摘要"));
  assert.ok(pageText.includes("READ-LOCAL-LLM-SECRET-METADATA"));
  assert.equal(pageText.includes("API Key"), false);
});

test("GUI settings keeps Agent test and secret metadata as separate actions", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document } = createTinyDocument();
  const context = createContext({
    document,
    window: {},
    fetch: async (url) => {
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.querySelector("[data-action='diagnose-llm']"));

  assert.ok(document.querySelector("[data-action='diagnose-llm']"), "provider test action should render");
  assert.ok(document.querySelector("[data-action='read-llm-secret-metadata']"), "secret metadata action should render");
  const pageText = document.textContent();
  assert.ok(pageText.includes("检测 Agent"));
  assert.ok(pageText.includes("读取密钥摘要"));
});

test("GUI reads LLM secret metadata with confirmation token and provider config", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document, clickLog } = createTinyDocument();
  const fetchCalls = [];
  const context = createContext({
    document,
    window: {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/llm/secret-metadata") {
        return responseJson({
          ok: true,
          metadata: {
            provider: "codex",
            pathHint: "%USERPROFILE%\\.codex\\auth.json",
            keyName: "OPENAI_API_KEY",
            present: true,
            fingerprint: "sha256:abcd",
            lengthRange: "sk-...48",
            formatHint: "bearer token",
            rawSecret: "must-not-render",
          },
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
  await waitFor(() => document.querySelector("[data-action='read-llm-secret-metadata']"));

  document.querySelector("#llm-custom-command").value = "codex";
  document.querySelector("#llm-custom-model").value = "gpt-5-codex";
  document.querySelector("#llm-secret-confirm").value = "READ-LOCAL-LLM-SECRET-METADATA";
  const readButton = document.querySelector("[data-action='read-llm-secret-metadata']");
  readButton.dispatchEvent({ type: "click", target: readButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const metadataCall = fetchCalls.find((call) => call.url === "/api/llm/secret-metadata");
  assert.ok(metadataCall, "secret metadata endpoint should be called");
  const body = JSON.parse(metadataCall.options.body);
  assert.equal(body.confirm, "READ-LOCAL-LLM-SECRET-METADATA");
  assert.equal(body.llm.provider, "codex");
  assert.equal(body.llm.model, "gpt-5-codex");
  const pageText = document.textContent();
  assert.ok(pageText.includes("sha256:abcd"));
  assert.ok(pageText.includes("OPENAI_API_KEY"));
  assert.equal(pageText.includes("must-not-render"), false);
  assert.ok(clickLog.includes("data-action:read-llm-secret-metadata"));
});

test("GUI clarifies a goal, locks it, and previews issue split from the control panel", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document, clickLog } = createTinyDocument();
  const fetchCalls = [];
  const context = createContext({
    document,
    window: {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") {
        return responseJson({ ok: true, presets: [] });
      }
      if (url === "/api/goal/normalize") {
        return responseJson({
          ok: true,
          goal: {
            id: "goal-1",
            status: "clarified",
            title: "实现 Goal/Plan 拆分能力",
            objective: "把模糊需求整理成 locked Goal 和 Plan。",
            owner: "Codex",
            source: "gui",
            successCriteria: ["Goal can be locked", "Plan can preview issue split"],
            clarificationQuestions: [],
          },
        });
      }
      if (url === "/api/goal/lock") {
        return responseJson({
          ok: true,
          goal: {
            id: "goal-1",
            status: "locked",
            title: "实现 Goal/Plan 拆分能力",
            objective: "把模糊需求整理成 locked Goal 和 Plan。",
            owner: "Codex",
            source: "gui",
            successCriteria: ["Goal can be locked", "Plan can preview issue split"],
            clarificationQuestions: [],
          },
        });
      }
      if (url === "/api/plan/generate") {
        return responseJson({
          ok: true,
          plan: {
            id: "plan-1",
            goalId: "goal-1",
            status: "draft",
            complexity: "complex",
            issueSplitRecommendation: "multiple",
            steps: [
              { number: 1, title: "锁定 Goal", status: "pending", dependencies: [] },
              { number: 2, title: "拆分 Plan", status: "pending", dependencies: [1] },
            ],
          },
        });
      }
      if (url === "/api/plan/preview-issues") {
        return responseJson({
          ok: true,
          issueSplit: {
            mode: "multiple",
            confirmationRequired: true,
            summary: "确认后创建 2 个 Multica issue。",
            issues: [
              { title: "实现 Goal", priority: "medium" },
              { title: "实现 Plan", priority: "medium" },
            ],
          },
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
  await waitFor(() => document.querySelector("[data-action='clarify-goal']"));

  const input = document.querySelector("#goal-request-input");
  input.value = "实现 Goal Plan 模块，复杂任务可以拆成多个 Multica issue";

  const clarifyButton = document.querySelector("[data-action='clarify-goal']");
  clarifyButton.dispatchEvent({ type: "click", target: clarifyButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const lockButton = document.querySelector("[data-action='lock-goal']");
  lockButton.dispatchEvent({ type: "click", target: lockButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const previewButton = document.querySelector("[data-action='preview-issue-split']");
  previewButton.dispatchEvent({ type: "click", target: previewButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(fetchCalls.map((call) => call.url).filter((url) => url.startsWith("/api/goal") || url.startsWith("/api/plan")), [
    "/api/goal/normalize",
    "/api/goal/lock",
    "/api/plan/generate",
    "/api/plan/preview-issues",
  ]);
  const normalizeBody = JSON.parse(fetchCalls.find((call) => call.url === "/api/goal/normalize").options.body);
  assert.equal(normalizeBody.mode, "agent");
  assert.equal(normalizeBody.language, "zh-CN");
  assert.equal(normalizeBody.context.language, "zh-CN");
  assert.equal(normalizeBody.assist.timeoutMs, 300000);
  assert.equal(JSON.parse(fetchCalls.find((call) => call.url === "/api/plan/generate").options.body).language, "zh-CN");
  assert.equal(JSON.parse(fetchCalls.find((call) => call.url === "/api/plan/preview-issues").options.body).language, "zh-CN");
  assert.ok(document.textContent().includes("Goal 已锁定"));
  assert.ok(document.textContent().includes("Plan 已生成"));
  assert.ok(document.textContent().includes("Issue 已预览"));
  assert.ok(document.textContent().includes("当前旅程"));
  assert.ok(document.textContent().includes("当前可执行动作"));
  assert.ok(document.textContent().includes("预览并创建 Issue"));
  assert.ok(document.textContent().includes("Plan 到 Issue 预览"));
  assert.ok(document.textContent().includes("生成 Plan 并预览 Issue"));
  assert.ok(document.textContent().includes("确认后创建 2 个 Multica issue"));
  assert.ok(document.querySelector(".goal-summary-card"), "Goal should render as a compact summary card");
  assert.ok(document.querySelector(".journey-header"), "Plan should render the journey rail");
  assert.ok(document.querySelector(".action-banner"), "Plan should render a single next-action banner");
  assert.ok(document.querySelector(".goal-detail-disclosure"), "Goal details should be folded into a disclosure");
  assert.ok(document.querySelector(".plan-step-details"), "Plan step table should be folded into a disclosure");
  assert.equal(document.textContent().includes("Create 2 Multica issues"), false);
  assert.ok(clickLog.includes("data-action:clarify-goal"));
  assert.ok(clickLog.includes("data-action:lock-goal"));
  assert.ok(clickLog.includes("data-action:preview-issue-split"));
});

test("GUI lets users answer draft Goal clarification questions before locking", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document } = createTinyDocument();
  const fetchCalls = [];
  let normalizeCount = 0;
  const context = createContext({
    document,
    window: {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/goal/normalize") {
        normalizeCount += 1;
        if (normalizeCount === 1) {
          return responseJson({
            ok: true,
            goal: {
              id: "goal-draft",
              status: "draft",
              title: "需要澄清的目标",
              objective: "需要确认审查器实时性和回写方式。",
              owner: "Codex",
              source: "gui",
              successCriteria: [],
              clarificationQuestions: ["实时性阈值是多少？", "审查结论回写到哪里？"],
            },
          });
        }
        return responseJson({
          ok: true,
          goal: {
            id: "goal-clarified",
            status: "clarified",
            title: "自动监听 GitHub 项目的审查器",
            objective: "分钟级监听 push/PR 并回写结构化审查结论。",
            owner: "Codex",
            source: "gui",
            successCriteria: ["push/PR 自动触发", "PR 评论可见"],
            clarificationQuestions: [],
          },
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
  await waitFor(() => document.querySelector("[data-action='clarify-goal']"));

  document.querySelector("[data-action='clarify-goal']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='clarify-goal']") });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.querySelector("[data-action='lock-goal']").disabled, true);
  assert.ok(document.textContent().includes("当前 Goal 仍是草稿，请先补充澄清信息。"));
  assert.ok(document.textContent().includes("实时性阈值是多少？"));
  assert.ok(document.textContent().includes("提交补充澄清"));

  document.querySelector("[data-action='submit-goal-clarification']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='submit-goal-clarification']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls.filter((call) => call.url === "/api/goal/normalize").length, 1);
  assert.ok(document.textContent().includes("请先填写澄清补充说明。"));

  document.querySelector("#goal-clarification-answer").value = "实时性目标为 5 分钟内；审查结论回写到 PR 评论和状态检查。";
  document.querySelector("[data-action='submit-goal-clarification']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='submit-goal-clarification']") });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fetchCalls.filter((call) => call.url === "/api/goal/normalize").length, 2);
  const secondBody = JSON.parse(fetchCalls.filter((call) => call.url === "/api/goal/normalize")[1].options.body);
  assert.equal(secondBody.context.clarification.answer, "实时性目标为 5 分钟内；审查结论回写到 PR 评论和状态检查。");
  assert.equal(secondBody.context.clarification.previousGoal.status, "draft");
  assert.deepEqual(secondBody.context.clarification.questions, ["实时性阈值是多少？", "审查结论回写到哪里？"]);
  assert.equal(document.querySelector("[data-action='lock-goal']").disabled, false);
  assert.ok(document.textContent().includes("自动监听 GitHub 项目的审查器"));
});

test("GUI sends follow-up clarification to the existing Assist Issue inbox", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const storage = createMemoryStorage();
  storage.setItem("multica-plusplus.workflow.v1", JSON.stringify({
    version: 1,
    language: "zh-CN",
    goalRequest: "搭建 GitHub 审查器",
    normalizedGoal: {
      id: "goal-draft",
      status: "draft",
      title: "需要澄清的目标",
      objective: "需要确认实时性和回写方式。",
      clarificationQuestions: ["实时性阈值是多少？"],
      successCriteria: [],
    },
    pendingAssist: {
      kind: "goal",
      label: "目标澄清",
      issueId: "issue-goal",
      issueIdentifier: "SPA-99",
      agent: { id: "agent-lead", name: "Claude-Lead" },
      assistRequestId: "request_goal_initial",
      request: "搭建 GitHub 审查器",
      context: { project: "MulticaPlusPlus", language: "zh-CN" },
      language: "zh-CN",
    },
    goalPlanStatus: "需要澄清",
    goalPlanFeedback: "目标仍为草稿。",
  }));
  const { document } = createTinyDocument();
  const fetchCalls = [];

  new Script(appSource).runInContext(createContext({
    document,
    window: { localStorage: storage },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/assist/result") {
        return responseJson({ ok: true, pending: true, status: "pending" });
      }
      if (url === "/api/assist/reply") {
        const body = JSON.parse(options.body);
        assert.equal(body.issueId, "issue-goal");
        assert.equal(body.kind, "goal");
        assert.equal(body.context.clarification.answer, "实时性目标为 5 分钟内；回写到 PR 评论。");
        assert.equal(body.context.clarification.previousGoal.status, "draft");
        return responseJson({
          ok: true,
          pending: true,
          assistRequestId: "request_goal_followup",
          assist: {
            issue: { id: "issue-goal", identifier: "SPA-99" },
            agent: { id: "agent-lead", name: "Claude-Lead" },
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout: () => 1,
    clearTimeout,
    Date,
  }));

  await waitFor(() => document.querySelector("[data-action='submit-goal-clarification']"));
  document.querySelector("#goal-clarification-answer").value = "实时性目标为 5 分钟内；回写到 PR 评论。";
  document.querySelector("[data-action='submit-goal-clarification']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='submit-goal-clarification']") });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fetchCalls.some((call) => call.url === "/api/assist/reply"), true);
  assert.equal(fetchCalls.filter((call) => call.url === "/api/goal/normalize").length, 0);
  assert.ok(storage.getItem("multica-plusplus.workflow.v1").includes("request_goal_followup"));
  assert.ok(document.textContent().includes("已发送到 Assist Issue SPA-99"));
});

test("GUI separates Goal/Plan control and permissions into distinct pages", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const htmlSource = await readFile(new URL("../gui/index.html", import.meta.url), "utf8");
  const { document } = createTinyDocument();
  const context = createContext({
    document,
    window: {},
    fetch: async (url) => {
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.querySelector("[data-action='open-permissions']"));

  assert.ok(htmlSource.includes('id="permissions-view"'));
  assert.ok(htmlSource.includes('data-view="permissions"'));
  assert.ok(htmlSource.indexOf('id="permission-panel"') > htmlSource.indexOf('id="permissions-view"'));
  assert.ok(htmlSource.indexOf('id="permission-panel"') > htmlSource.indexOf('</section>\n\n          <section id="permissions-view"'));

  const topbarButton = document.querySelector("[data-action='open-permissions']");
  topbarButton.dispatchEvent({ type: "click", target: topbarButton });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const permissionsNav = document.querySelector("[data-nav-target='permissions']");
  const controlNav = document.querySelector("[data-nav-target='control']");
  assert.equal(permissionsNav.getAttribute("aria-current"), "page");
  assert.equal(controlNav.getAttribute("aria-current"), "false");
});

test("GUI can temporarily hide and restore the current workspace content", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document, clickLog } = createTinyDocument();
  const context = createContext({
    document,
    window: {},
    fetch: async (url) => {
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.querySelector("[data-action='toggle-content-visibility']")?.getAttribute("aria-pressed") === "false");

  const toggle = document.querySelector("[data-action='toggle-content-visibility']");
  const controlView = document.querySelector("#view-control");
  const privacyPlaceholder = document.querySelector("#content-privacy-placeholder");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(controlView.hidden, false);
  assert.equal(privacyPlaceholder.hidden, true);

  toggle.dispatchEvent({ type: "click", target: toggle });
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.ok(document.textContent().includes("当前内容已隐藏"));
  assert.equal(controlView.hidden, true);
  assert.equal(privacyPlaceholder.hidden, false);

  const show = document.querySelector("[data-action='show-workspace-content']");
  show.dispatchEvent({ type: "click", target: show });
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(controlView.hidden, false);
  assert.equal(privacyPlaceholder.hidden, true);
  assert.ok(clickLog.includes("data-action:toggle-content-visibility"));
  assert.ok(clickLog.includes("data-action:show-workspace-content"));
});

test("GUI surfaces Multica assist issue create diagnostics during goal clarification", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document } = createTinyDocument();
  const context = createContext({
    document,
    window: {},
    fetch: async (url) => {
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/goal/normalize") {
        return responseJson({
          ok: false,
          blocked: true,
          reason: "multica_issue_duplicate_blocked",
          diagnostic: {
            create: {
              code: 1,
              stderrExcerpt: "active duplicate issue already exists",
            },
          },
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
  await waitFor(() => document.querySelector("[data-action='clarify-goal']"));

  const clarifyButton = document.querySelector("[data-action='clarify-goal']");
  clarifyButton.dispatchEvent({ type: "click", target: clarifyButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pageText = document.textContent();
  assert.ok(pageText.includes("Multica 拦截了重复 assist issue"));
  assert.ok(pageText.includes("active duplicate issue already exists"));
});

test("GUI blocks Agent-assisted plan split when no agent is available", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document, clickLog } = createTinyDocument();
  const fetchCalls = [];
  const context = createContext({
    document,
    window: {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/goal/normalize") {
        return responseJson({
          ok: true,
          goal: {
            id: "goal-1",
            status: "clarified",
            title: "实现 Goal/Plan 拆分能力",
            objective: "把模糊需求整理成 locked Goal 和多个 Plan。",
            owner: "Codex",
            source: "gui",
            successCriteria: ["PlanSet can be generated"],
            clarificationQuestions: [],
          },
        });
      }
      if (url === "/api/goal/lock") {
        return responseJson({
          ok: true,
          goal: {
            id: "goal-1",
            status: "locked",
            title: "实现 Goal/Plan 拆分能力",
            objective: "把模糊需求整理成 locked Goal 和多个 Plan。",
            owner: "Codex",
            source: "gui",
            successCriteria: ["PlanSet can be generated"],
            clarificationQuestions: [],
          },
        });
      }
      if (url === "/api/assist/agents") {
        return responseJson({ ok: true, status: "blocked", reason: "no_assist_agent", agents: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.querySelector("[data-action='clarify-goal']"));

  document.querySelector("[data-action='clarify-goal']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='clarify-goal']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector("[data-action='lock-goal']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='lock-goal']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const splitButton = document.querySelector("[data-action='split-plan-llm']");
  splitButton.dispatchEvent({ type: "click", target: splitButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(fetchCalls.some((call) => call.url === "/api/assist/agents"));
  assert.equal(fetchCalls.some((call) => call.url === "/api/plan/split"), false);
  assert.ok(document.textContent().includes("未发现可用 Multica Agent"));
  assert.ok(clickLog.includes("data-action:split-plan-llm"));
});

test("GUI renders multiple Agent-assisted parallel Plan cards", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document } = createTinyDocument();
  const fetchCalls = [];
  const context = createContext({
    document,
    window: {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/goal/normalize") {
        return responseJson({
          ok: true,
          goal: {
            id: "goal-1",
            status: "clarified",
            title: "实现 Goal/Plan 拆分能力",
            objective: "把模糊需求整理成 locked Goal 和多个 Plan。",
            owner: "Codex",
            source: "gui",
            successCriteria: ["PlanSet can be generated"],
            clarificationQuestions: [],
          },
        });
      }
      if (url === "/api/goal/lock") {
        return responseJson({
          ok: true,
          goal: {
            id: "goal-1",
            status: "locked",
            title: "实现 Goal/Plan 拆分能力",
            objective: "把模糊需求整理成 locked Goal 和多个 Plan。",
            owner: "Codex",
            source: "gui",
            successCriteria: ["PlanSet can be generated"],
            clarificationQuestions: [],
          },
        });
      }
      if (url === "/api/assist/agents") {
        return responseJson({
          ok: true,
          status: "available",
          selectedAgent: { id: "agent-lead", name: "Claude-Lead", model: "pa/claude-opus", status: "idle", runtimeStatus: "online" },
          agents: [{ id: "agent-lead", name: "Claude-Lead", model: "pa/claude-opus", status: "idle", runtimeStatus: "online" }],
        });
      }
      if (url === "/api/plan/split") {
        const body = JSON.parse(options.body);
        assert.equal(body.mode, "agent");
        assert.equal(body.async, true);
        assert.equal(body.language, "zh-CN");
        return responseJson({
          ok: true,
          pending: true,
          assist: {
            agent: { id: "agent-lead", name: "Claude-Lead" },
            issue: { id: "issue-plan", identifier: "SPA-100", status: "todo" },
          },
          assistChainId: body.assist.chainId,
          assistRequestId: body.assist.requestId,
        });
      }
      if (url === "/api/assist/result") {
        const body = JSON.parse(options.body);
        assert.equal(body.kind, "planSet");
        assert.equal(body.issueId, "issue-plan");
        return responseJson({
          ok: true,
          status: "completed",
          diagnostic: { outputSource: "comments" },
          assist: {
            agent: { id: "agent-lead", name: "Claude-Lead" },
            issue: { id: "issue-plan", identifier: "SPA-100", status: "todo" },
            run: { id: "run-plan", status: "completed" },
          },
          planSet: {
            id: "plan_set_1",
            status: "draft",
            splitMode: "parallel",
            strategy: "llm-assisted-workstreams",
            provider: { id: "provider-multica-agent", kind: "multica-agent", command: "multica", model: "pa/claude-opus", source: "multica-agent" },
            assist: {
              agent: { id: "agent-lead", name: "Claude-Lead" },
              issue: { id: "issue-plan", identifier: "SPA-100", status: "todo" },
              run: { id: "run-plan", status: "completed" },
            },
            plans: [
              {
                id: "subplan-1",
                number: 1,
                title: "Provider discovery",
                objective: "Detect local providers.",
                workstream: { id: "provider", label: "Provider", reason: "Independent." },
                suggestedAgent: "planner-agent",
                dependencies: [],
                steps: [
                  { number: 1, title: "Detect CLI", status: "pending", dependencies: [] },
                  { number: 2, title: "Block missing provider", status: "pending", dependencies: [1] },
                ],
                acceptanceEvidence: "Provider discovery output.",
              },
              {
                id: "subplan-2",
                number: 2,
                title: "Plan rendering",
                objective: "Render plan cards.",
                workstream: { id: "rendering", label: "Rendering", reason: "Independent." },
                suggestedAgent: "gui-agent",
                dependencies: [],
                steps: [
                  { number: 1, title: "Render cards", status: "pending", dependencies: [] },
                  { number: 2, title: "Show steps", status: "pending", dependencies: [1] },
                ],
                acceptanceEvidence: "Cards visible.",
              },
            ],
            warnings: [],
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    clearTimeout,
    Date,
  });

  new Script(appSource).runInContext(context);
  await waitFor(() => document.querySelector("[data-action='clarify-goal']"));

  document.querySelector("[data-action='clarify-goal']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='clarify-goal']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector("[data-action='lock-goal']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='lock-goal']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector("[data-action='split-plan-llm']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='split-plan-llm']") });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(fetchCalls.some((call) => call.url === "/api/plan/split"));
  assert.ok(document.textContent().includes("Provider discovery"));
  assert.ok(document.textContent().includes("Plan rendering"));
  assert.ok(document.textContent().includes("并行 Plan"));
  assert.ok(document.textContent().includes("Claude-Lead"));
  assert.ok(document.textContent().includes("SPA-100"));
});

test("GUI previews and explicitly creates business issues from an Agent PlanSet", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const storage = createMemoryStorage();
  storage.setItem("multica-plusplus.workflow.v1", JSON.stringify({
    version: 1,
    language: "zh-CN",
    goalRequest: "实现 Goal Plan 模块",
    lockedGoal: {
      id: "goal-1",
      status: "locked",
      title: "实现 Goal Plan 模块",
      objective: "拆分为多个计划。",
      successCriteria: ["PlanSet can be generated"],
      constraints: ["preview-first"],
      language: "zh-CN",
    },
    planSet: {
      id: "plan_set_1",
      goalId: "goal-1",
      status: "draft",
      language: "zh-CN",
      splitMode: "parallel",
      strategy: "llm-assisted-workstreams",
      provider: { id: "provider-multica-agent", kind: "multica-agent", command: "multica", model: "pa/claude-opus", source: "multica-agent" },
      assist: {
        agent: { id: "agent-lead", name: "Claude-Lead" },
        issue: { id: "assist-issue", identifier: "SPA-100" },
      },
      plans: [
        {
          id: "subplan-1",
          number: 1,
          title: "目标澄清 Plan",
          objective: "完成目标澄清。",
          workstream: { id: "goal", label: "目标", reason: "独立工作流。" },
          suggestedAgent: "planner-agent",
          dependencies: [],
          steps: [{ number: 1, title: "澄清目标", status: "pending", dependencies: [] }],
          acceptanceEvidence: "目标可锁定。",
        },
        {
          id: "subplan-2",
          number: 2,
          title: "计划拆分 Plan",
          objective: "完成计划拆分。",
          workstream: { id: "plan", label: "计划", reason: "独立工作流。" },
          suggestedAgent: "planner-agent",
          dependencies: [],
          steps: [{ number: 1, title: "拆分计划", status: "pending", dependencies: [] }],
          acceptanceEvidence: "PlanSet 可预览业务 Issue。",
        },
      ],
      warnings: [],
    },
  }));
  const { document } = createTinyDocument();
  const fetchCalls = [];

  new Script(appSource).runInContext(createContext({
    document,
    window: { localStorage: storage },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/plan/preview-issues") {
        const body = JSON.parse(options.body);
        assert.equal(body.goal.id, "goal-1");
        assert.equal(body.planSet.id, "plan_set_1");
        assert.equal(body.plan, undefined);
        assert.equal(body.language, "zh-CN");
        return responseJson({
          ok: true,
          issueSplit: {
            id: "issue_split_1",
            mode: "plan_set",
            confirmationRequired: true,
            confirmationToken: "APPLY-MULTICA-ISSUE-SPLIT",
            summary: "将为 2 个并行 Plan 预览 2 个业务 Multica Issue。",
            issues: [
              {
                id: "issue_preview_1",
                title: "实现 Goal Plan 模块 · 目标澄清 Plan",
                priority: "medium",
                description: "## 业务 Issue\n完成目标澄清，不会自动创建 assist issue。",
                metadata: { goal_id: "goal-1", plan_set_id: "plan_set_1", subplan_id: "subplan-1" },
              },
              {
                id: "issue_preview_2",
                title: "实现 Goal Plan 模块 · 计划拆分 Plan",
                priority: "medium",
                description: "## 业务 Issue\n完成计划拆分，确认后写入 Multica。",
                metadata: { goal_id: "goal-1", plan_set_id: "plan_set_1", subplan_id: "subplan-2" },
              },
            ],
            operations: [
              { type: "issue:create", displayCommand: "multica issue create --title \"实现 Goal Plan 模块 · 目标澄清 Plan\" --description-file <file> --priority medium --output json" },
              { type: "issue:create", displayCommand: "multica issue create --title \"实现 Goal Plan 模块 · 计划拆分 Plan\" --description-file <file> --priority medium --output json" },
            ],
          },
        });
      }
      if (url === "/api/plan/apply-issues") {
        const body = JSON.parse(options.body);
        assert.equal(body.execute, true);
        assert.equal(body.confirm, "APPLY-MULTICA-ISSUE-SPLIT");
        if (body.issuePreviewId) {
          assert.equal(body.issuePreviewId, "issue_preview_2");
          return responseJson({
            ok: true,
            result: {
              ok: true,
              mode: "execute",
              issueSplitId: "issue_split_1",
              createdIssues: [
                { id: "issue-2", identifier: "SPA-202", title: "实现 Goal Plan 模块 · 计划拆分 Plan", issuePreviewId: "issue_preview_2" },
              ],
              operations: [],
            },
          });
        }
        return responseJson({
          ok: true,
          result: {
            ok: true,
            mode: "execute",
            issueSplitId: "issue_split_1",
            createdIssues: [
              { id: "issue-1", identifier: "SPA-201", title: "实现 Goal Plan 模块 · 目标澄清 Plan" },
              { id: "issue-2", identifier: "SPA-202", title: "实现 Goal Plan 模块 · 计划拆分 Plan" },
            ],
            operations: [],
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  }));
  await waitFor(() => document.querySelector("[data-action='preview-issue-split']"));

  const previewButton = document.querySelector("[data-action='preview-issue-split']");
  previewButton.dispatchEvent({ type: "click", target: previewButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(document.textContent().includes("Plan 到 Issue 预览"));
  assert.ok(document.textContent().includes("预览业务 Issue"));
  assert.ok(document.textContent().includes("创建全部 Multica Issue"));
  assert.ok(document.textContent().includes("创建此 Issue"));
  assert.ok(document.textContent().includes("查看写入详情"));
  assert.ok(document.textContent().includes("复制命令"));
  assert.ok(document.textContent().includes("plan_set_1"));
  assert.ok(document.querySelector(".compact-issue-card"), "Issue preview should use compact action cards");
  assert.ok(document.querySelector(".issue-write-details"), "CLI command and metadata should live in write details disclosure");
  assert.equal(fetchCalls.filter((call) => call.url === "/api/plan/generate").length, 0);
  assert.equal(fetchCalls.filter((call) => call.url === "/api/plan/apply-issues").length, 0);

  const createButton = document.querySelector("[data-action='apply-issue-split']");
  createButton.dispatchEvent({ type: "click", target: createButton });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(document.textContent().includes("必须输入 APPLY-MULTICA-ISSUE-SPLIT"));
  assert.equal(fetchCalls.filter((call) => call.url === "/api/plan/apply-issues").length, 0);

  document.querySelector("#issue-split-confirm").value = "APPLY-MULTICA-ISSUE-SPLIT";
  const singleCreateButton = document.querySelector("[data-action='apply-single-issue'][data-issue-preview-id='issue_preview_2']");
  assert.ok(singleCreateButton, "single issue create button should render for each preview card");
  singleCreateButton.dispatchEvent({ type: "click", target: singleCreateButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fetchCalls.filter((call) => call.url === "/api/plan/apply-issues").length, 1);
  assert.ok(document.textContent().includes("SPA-202"));
  assert.ok(document.textContent().includes("打开 Issue"));
  assert.ok(document.textContent().includes("复制 Issue ID"));

  createButton.dispatchEvent({ type: "click", target: createButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fetchCalls.filter((call) => call.url === "/api/plan/apply-issues").length, 2);
  assert.ok(document.textContent().includes("SPA-201"));
  assert.ok(document.textContent().includes("SPA-202"));
  assert.ok(storage.getItem("multica-plusplus.workflow.v1").includes("issue-1"));
});

test("GUI loads and syncs issue subscriptions as one aggregate polling loop", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const { document } = createTinyDocument();
  const fetchCalls = [];
  const timers = [];

  new Script(appSource).runInContext(createContext({
    document,
    window: { localStorage: createMemoryStorage() },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/issue-subscriptions") {
        return responseJson({
          ok: true,
          subscriptions: [
            {
              id: "sub-assist-goal",
              kind: "assist_goal",
              issueId: "assist-goal-1",
              issueIdentifier: "SPA-10",
              title: "Goal 澄清 Assist Issue",
              state: "active",
              lastKnownStatus: "todo",
            },
            {
              id: "sub-assist-plan",
              kind: "assist_plan_split",
              issueId: "assist-plan-1",
              issueIdentifier: "SPA-11",
              title: "Plan 拆分 Assist Issue",
              state: "active",
              lastRunStatus: "running",
            },
            {
              id: "sub-business",
              kind: "business_issue",
              issueId: "business-1",
              issueIdentifier: "SPA-12",
              title: "业务 Issue",
              state: "active",
              lastKnownStatus: "in_progress",
              lastCommentExcerpt: "正在处理业务 Issue。",
            },
          ],
        });
      }
      if (url === "/api/issue-subscriptions/sync") {
        return responseJson({
          ok: true,
          synced: [
            {
              id: "sub-business",
              kind: "business_issue",
              issueId: "business-1",
              issueIdentifier: "SPA-12",
              title: "业务 Issue",
              state: "active",
              lastKnownStatus: "in_progress",
              lastRunStatus: "running",
              lastCommentExcerpt: "同步后的业务 Issue 摘要。",
            },
          ],
          skipped: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout: (fn, ms) => {
      timers.push(ms);
      return timers.length;
    },
    clearTimeout,
    Date,
  }));

  await waitFor(() => document.textContent().includes("订阅和历史记录在记录页管理"));
  assert.equal(document.querySelector("#plan-list").textContentDeep().includes("Issue 执行跟踪"), false);
  assert.equal(document.querySelector("#plan-list").textContentDeep().includes("暂停订阅"), false);
  assert.equal(document.querySelector("#plan-list").textContentDeep().includes("关闭真实 Issue"), false);

  const recordsEntry = document.querySelector("[data-action='open-records']");
  assert.ok(recordsEntry, "Plan page should render a compact records entry");
  recordsEntry.dispatchEvent({ type: "click", target: recordsEntry });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(document.querySelector("#records-list").textContentDeep().includes("工作流记录"));
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("Issue 执行跟踪"));
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("记录与 Issue 订阅"));
  assert.ok(document.querySelector(".records-dashboard"), "records page should render as a dashboard");
  assert.ok(document.querySelector(".records-overview-grid"), "records page should include overview metrics");
  assert.ok(document.querySelector(".records-main-grid"), "records page should split workflow and subscription panels");
  assert.ok(document.querySelector(".subscription-lane-board"), "subscription groups should render as lanes");
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("Assist Goal"));
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("Assist Plan"));
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("Business Issues"));
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("SPA-12"));
  assert.equal(fetchCalls.filter((call) => call.url === "/api/issue-subscriptions").length, 1);
  assert.equal(timers.includes(60000), true);
});

test("GUI records workflow snapshots and manages subscribed issue rows", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const storage = createMemoryStorage();
  storage.setItem("multica-plusplus.workflow.v1", JSON.stringify({
    version: 1,
    savedAt: "2026-06-08T00:00:00.000Z",
    goalRequest: "历史需求",
    normalizedGoal: { id: "goal-old", title: "历史 Goal", objective: "恢复历史目标", status: "clarified" },
    lockedGoal: { id: "goal-old", title: "历史 Goal", objective: "恢复历史目标", status: "locked" },
    planSet: { id: "plan_set_old", plans: [{ id: "sub-1", number: 1, title: "历史 Plan", objective: "恢复计划", workstream: { id: "ws", label: "工作流" }, steps: [] }] },
    issueSplit: { id: "split-old", summary: "历史 Issue 预览", issues: [], operations: [] },
    issueApplyResult: { createdIssues: [{ id: "business-1", identifier: "SPA-12", title: "业务 Issue" }] },
    issueSubscriptions: [],
    goalPlanStatus: "已预览",
    goalPlanFeedback: "历史记录",
  }));
  const { document } = createTinyDocument();
  const fetchCalls = [];

  new Script(appSource).runInContext(createContext({
    document,
    window: { localStorage: storage },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/issue-subscriptions") {
        return responseJson({
          ok: true,
          subscriptions: [
            {
              id: "sub-business",
              kind: "business_issue",
              issueId: "business-1",
              issueIdentifier: "SPA-12",
              title: "业务 Issue",
              state: "active",
              lastKnownStatus: "in_progress",
            },
          ],
        });
      }
      if (url === "/api/issue-subscriptions/sub-business/pause") {
        return responseJson({
          ok: true,
          subscription: {
            id: "sub-business",
            kind: "business_issue",
            issueId: "business-1",
            issueIdentifier: "SPA-12",
            title: "业务 Issue",
            state: "paused",
            lastKnownStatus: "in_progress",
          },
        });
      }
      if (url === "/api/issue-subscriptions/sub-business/close") {
        const body = JSON.parse(options.body);
        if (body.execute === true && body.confirm === "CLOSE-MULTICA-SUBSCRIBED-ISSUE") {
          return responseJson({
            ok: true,
            result: {
              ok: true,
              mode: "execute",
              subscription: {
                id: "sub-business",
                kind: "business_issue",
                issueId: "business-1",
                issueIdentifier: "SPA-12",
                title: "业务 Issue",
                state: "completed",
                lastKnownStatus: "cancelled",
              },
            },
          });
        }
        return responseJson({ ok: false, result: { ok: false, blocked: true, reason: "close_subscription_confirmation_required" } });
      }
      if (url === "/api/issue-subscriptions/sub-business") {
        return responseJson({ ok: true, deleted: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  }));

  await waitFor(() => document.textContent().includes("订阅和历史记录在记录页管理"));
  assert.equal(document.querySelector("#plan-list").textContentDeep().includes("Issue 执行跟踪"), false);
  assert.equal(document.querySelector("#plan-list").textContentDeep().includes("暂停订阅"), false);
  assert.equal(document.querySelector("#plan-list").textContentDeep().includes("关闭真实 Issue"), false);

  const recordsNav = document.querySelector("[data-nav-target='records']");
  recordsNav.dispatchEvent({ type: "click", target: recordsNav });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(document.textContent().includes("工作流记录"));
  assert.ok(document.textContent().includes("记录与 Issue 订阅"));
  assert.ok(document.textContent().includes("历史 Goal"));
  assert.ok(document.querySelector(".records-dashboard"), "records page should render dashboard shell");
  assert.ok(document.querySelector(".workflow-record-panel"), "workflow records should be grouped in a panel");
  assert.ok(document.querySelector(".records-activity-panel"), "page events should be moved to a secondary panel");
  assert.ok(document.querySelector(".subscription-lane-board"), "issue subscriptions should use a lane board");
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("Issue 执行跟踪"));
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("暂停"));
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("本地移除"));
  assert.ok(document.querySelector("#records-list").textContentDeep().includes("关闭真实 Issue"));

  const newFlow = document.querySelector("[data-action='new-workflow']");
  newFlow.dispatchEvent({ type: "click", target: newFlow });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(storage.getItem("multica-plusplus.workflow.v1").includes("实现 Goal Plan 模块"));
  assert.ok(storage.getItem("multica-plusplus.workflow-records.v1").includes("历史 Goal"));

  recordsNav.dispatchEvent({ type: "click", target: recordsNav });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const restore = document.querySelector("[data-action='restore-workflow-record']");
  restore.dispatchEvent({ type: "click", target: restore });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(document.textContent().includes("恢复历史目标"));

  document.querySelector("[data-action='pause-subscription']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='pause-subscription']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls.some((call) => call.url === "/api/issue-subscriptions/sub-business/pause"), true);
  assert.ok(document.textContent().includes("paused") || document.textContent().includes("暂停"));

  document.querySelector("[data-action='close-subscription']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='close-subscription']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(document.textContent().includes("必须输入 CLOSE-MULTICA-SUBSCRIBED-ISSUE"));
  assert.equal(fetchCalls.filter((call) => call.url === "/api/issue-subscriptions/sub-business/close").length, 0);

  document.querySelector("#subscription-close-confirm").value = "CLOSE-MULTICA-SUBSCRIBED-ISSUE";
  document.querySelector("[data-action='close-subscription']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='close-subscription']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const closeCall = fetchCalls.find((call) => call.url === "/api/issue-subscriptions/sub-business/close");
  assert.equal(JSON.parse(closeCall.options.body).confirm, "CLOSE-MULTICA-SUBSCRIBED-ISSUE");
  assert.ok(document.textContent().includes("cancelled"));

  document.querySelector("[data-action='delete-subscription']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='delete-subscription']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls.some((call) => call.url === "/api/issue-subscriptions/sub-business" && call.options.method === "DELETE"), true);

  recordsNav.dispatchEvent({ type: "click", target: recordsNav });
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector("[data-action='delete-workflow-record']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='delete-workflow-record']") });
  assert.equal(storage.getItem("multica-plusplus.workflow-records.v1").includes("历史 Goal"), false);
});

test("GUI restores Agent-assisted PlanSet after a browser refresh", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const storage = createMemoryStorage();
  const first = createTinyDocument();
  const fetchCalls = [];
  const fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
    if (url === "/api/goal/normalize") {
      return responseJson({
        ok: true,
        goal: {
          id: "goal-1",
          status: "clarified",
          title: "实现 Goal/Plan 拆分能力",
          objective: "把模糊需求整理成 locked Goal 和多个 Plan。",
          owner: "Codex",
          source: "gui",
          successCriteria: ["PlanSet can be generated"],
          clarificationQuestions: [],
        },
      });
    }
    if (url === "/api/goal/lock") {
      return responseJson({
        ok: true,
        goal: {
          id: "goal-1",
          status: "locked",
          title: "实现 Goal/Plan 拆分能力",
          objective: "把模糊需求整理成 locked Goal 和多个 Plan。",
          owner: "Codex",
          source: "gui",
          successCriteria: ["PlanSet can be generated"],
          clarificationQuestions: [],
        },
      });
    }
    if (url === "/api/assist/agents") {
      return responseJson({
        ok: true,
        status: "available",
        selectedAgent: { id: "agent-lead", name: "Claude-Lead", model: "pa/claude-opus", status: "idle", runtimeStatus: "online" },
        agents: [{ id: "agent-lead", name: "Claude-Lead", model: "pa/claude-opus", status: "idle", runtimeStatus: "online" }],
      });
    }
    if (url === "/api/plan/split") {
      const body = JSON.parse(options.body);
      return responseJson({
        ok: true,
        pending: true,
        assist: {
          agent: { id: "agent-lead", name: "Claude-Lead" },
          issue: { id: "issue-plan", identifier: "SPA-100", status: "todo" },
        },
        assistChainId: body.assist.chainId,
        assistRequestId: body.assist.requestId,
      });
    }
    if (url === "/api/assist/result") {
      return responseJson({
        ok: true,
        status: "completed",
        diagnostic: { outputSource: "comments" },
        assist: {
          agent: { id: "agent-lead", name: "Claude-Lead" },
          issue: { id: "issue-plan", identifier: "SPA-100", status: "todo" },
          run: { id: "run-plan", status: "completed" },
        },
        planSet: {
          id: "plan_set_1",
          status: "draft",
          splitMode: "parallel",
          strategy: "llm-assisted-workstreams",
          provider: { id: "provider-multica-agent", kind: "multica-agent", command: "multica", model: "pa/claude-opus", source: "multica-agent" },
          assist: {
            agent: { id: "agent-lead", name: "Claude-Lead" },
            issue: { id: "issue-plan", identifier: "SPA-100", status: "todo" },
            run: { id: "run-plan", status: "completed" },
          },
          plans: [
            {
              id: "subplan-1",
              number: 1,
              title: "刷新后保留的 Plan",
              objective: "刷新页面后仍展示 PlanSet。",
              workstream: { id: "persist", label: "Persist", reason: "Independent." },
              suggestedAgent: "planner-agent",
              dependencies: [],
              steps: [{ number: 1, title: "保存草稿", status: "pending", dependencies: [] }],
              acceptanceEvidence: "PlanSet visible after reload.",
            },
          ],
          warnings: [],
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  new Script(appSource).runInContext(createContext({
    document: first.document,
    window: { localStorage: storage },
    fetch,
    console,
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    clearTimeout,
    Date,
  }));
  await waitFor(() => first.document.querySelector("[data-action='clarify-goal']"));

  first.document.querySelector("[data-action='clarify-goal']").dispatchEvent({ type: "click", target: first.document.querySelector("[data-action='clarify-goal']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  first.document.querySelector("[data-action='lock-goal']").dispatchEvent({ type: "click", target: first.document.querySelector("[data-action='lock-goal']") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  first.document.querySelector("[data-action='split-plan-llm']").dispatchEvent({ type: "click", target: first.document.querySelector("[data-action='split-plan-llm']") });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(first.document.textContent().includes("刷新后保留的 Plan"));

  const second = createTinyDocument();
  new Script(appSource).runInContext(createContext({
    document: second.document,
    window: { localStorage: storage },
    fetch: async (url) => {
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      throw new Error(`unexpected fetch after refresh ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  }));
  await waitFor(() => second.document.querySelector("[data-action='split-plan-llm']"));

  assert.ok(second.document.textContent().includes("刷新后保留的 Plan"));
  assert.ok(second.document.textContent().includes("并行 Plan"));
  assert.ok(second.document.textContent().includes("SPA-100"));
  assert.equal(fetchCalls.filter((call) => call.url === "/api/plan/split").length, 1);
});

test("GUI resumes a pending Assist Issue inbox after refresh without creating a new split task", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const storage = createMemoryStorage();
  storage.setItem("multica-plusplus.workflow.v1", JSON.stringify({
    version: 1,
    language: "zh-CN",
    goalRequest: "实现 Goal Plan 模块",
    lockedGoal: {
      id: "goal-1",
      status: "locked",
      title: "实现 Goal Plan 模块",
      objective: "拆分为多个计划。",
      successCriteria: ["PlanSet can be generated"],
      constraints: ["preview-first"],
      language: "zh-CN",
    },
    pendingAssist: {
      kind: "planSet",
      label: "Plan 拆分",
      issueId: "issue-plan",
      issueIdentifier: "SPA-100",
      assistRequestId: "request-plan-refresh",
      agent: { id: "agent-lead", name: "Claude-Lead" },
      lockedGoal: {
        id: "goal-1",
        status: "locked",
        title: "实现 Goal Plan 模块",
        objective: "拆分为多个计划。",
        successCriteria: ["PlanSet can be generated"],
        constraints: ["preview-first"],
        language: "zh-CN",
      },
      availableAgents: [{ id: "planner-agent", role: "planner" }],
      language: "zh-CN",
      timeoutMs: 300000,
    },
  }));
  const { document } = createTinyDocument();
  const fetchCalls = [];

  new Script(appSource).runInContext(createContext({
    document,
    window: { localStorage: storage },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/assist/result") {
        const body = JSON.parse(options.body);
        assert.equal(body.issueId, "issue-plan");
        assert.equal(body.assistRequestId, "request-plan-refresh");
        return responseJson({
          ok: true,
          status: "completed",
          diagnostic: { outputSource: "comments" },
          assist: {
            agent: { id: "agent-lead", name: "Claude-Lead" },
            issue: { id: "issue-plan", identifier: "SPA-100" },
            run: { id: "run-plan", status: "completed" },
          },
          planSet: {
            id: "plan_set_refresh",
            status: "draft",
            splitMode: "parallel",
            strategy: "llm-assisted-workstreams",
            provider: { id: "provider-multica-agent", kind: "multica-agent", command: "multica", source: "multica-agent" },
            assist: {
              agent: { id: "agent-lead", name: "Claude-Lead" },
              issue: { id: "issue-plan", identifier: "SPA-100" },
              run: { id: "run-plan", status: "completed" },
            },
            plans: [
              {
                id: "subplan-1",
                number: 1,
                title: "刷新后从收件箱恢复的 Plan",
                objective: "刷新页面后从 Assist Issue comment 恢复 PlanSet。",
                workstream: { id: "persist", label: "Persist", reason: "Independent." },
                suggestedAgent: "planner-agent",
                dependencies: [],
                steps: [{ number: 1, title: "读取 comment", status: "pending", dependencies: [] }],
                acceptanceEvidence: "PlanSet visible after reload.",
              },
            ],
            warnings: [],
          },
        });
      }
      if (url === "/api/plan/split") throw new Error("refresh recovery must not create a new assist issue");
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    clearTimeout,
    Date,
  }));

  await waitFor(() => document.textContent().includes("刷新后从收件箱恢复的 Plan"));
  assert.ok(document.textContent().includes("刷新后从收件箱恢复的 Plan"));
  assert.ok(document.textContent().includes("SPA-100"));
  assert.equal(fetchCalls.some((call) => call.url === "/api/plan/split"), false);
  assert.ok(fetchCalls.some((call) => call.url === "/api/assist/result"));
});

test("GUI keeps concurrent Assist Issue results isolated by workflow", async () => {
  const appSource = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const storage = createMemoryStorage();
  storage.setItem("multica-plusplus.workflow.v1", JSON.stringify({
    version: 1,
    workflowId: "workflow-one",
    language: "zh-CN",
    goalRequest: "流程 1：拆分 Plan",
    lockedGoal: {
      id: "goal-flow-one",
      status: "locked",
      title: "流程 1 目标",
      objective: "需要拆分 Plan。",
      successCriteria: ["生成 PlanSet"],
      constraints: ["preview-first"],
      language: "zh-CN",
    },
    pendingAssist: {
      id: "pending-flow-one-plan",
      workflowId: "workflow-one",
      kind: "planSet",
      label: "Plan 拆分",
      issueId: "issue-plan-a",
      issueIdentifier: "SPA-A",
      assistRequestId: "request-plan-a",
      agent: { id: "agent-lead", name: "Claude-Lead" },
      lockedGoal: {
        id: "goal-flow-one",
        status: "locked",
        title: "流程 1 目标",
        objective: "需要拆分 Plan。",
        successCriteria: ["生成 PlanSet"],
        constraints: ["preview-first"],
        language: "zh-CN",
      },
      language: "zh-CN",
      timeoutMs: 300000,
    },
  }));

  const { document } = createTinyDocument();
  const fetchCalls = [];
  const pendingResponses = new Map([
    ["issue-plan-a", {
      ok: true,
      status: "completed",
      diagnostic: { outputSource: "comments" },
      assist: {
        issue: { id: "issue-plan-a", identifier: "SPA-A" },
        agent: { id: "agent-lead", name: "Claude-Lead" },
        run: { id: "run-plan-a", status: "completed" },
      },
      planSet: {
        id: "plan_set_flow_one",
        status: "draft",
        splitMode: "parallel",
        strategy: "llm-assisted-workstreams",
        provider: { id: "provider-multica-agent", kind: "multica-agent", source: "multica-agent" },
        assist: {
          issue: { id: "issue-plan-a", identifier: "SPA-A" },
          agent: { id: "agent-lead", name: "Claude-Lead" },
          run: { id: "run-plan-a", status: "completed" },
        },
        plans: [
          {
            id: "subplan-flow-one",
            number: 1,
            title: "流程 1 已完成的 Plan",
            objective: "旧流程结果应只写回流程 1 记录。",
            workstream: { id: "flow-one", label: "流程 1", reason: "隔离验证" },
            suggestedAgent: "planner-agent",
            dependencies: [],
            steps: [{ number: 1, title: "更新流程 1", status: "pending", dependencies: [] }],
            acceptanceEvidence: "记录中可恢复。",
          },
        ],
        warnings: [],
      },
    }],
    ["issue-goal-b", {
      ok: true,
      status: "completed",
      diagnostic: { outputSource: "comments" },
      assist: {
        issue: { id: "issue-goal-b", identifier: "SPA-B" },
        agent: { id: "agent-lead", name: "Claude-Lead" },
        run: { id: "run-goal-b", status: "completed" },
      },
      goal: {
        id: "goal-flow-two",
        status: "clarified",
        title: "流程 2 已澄清目标",
        objective: "新流程当前页面应显示这个目标。",
        successCriteria: ["流程 2 更新当前 UI"],
        constraints: ["preview-first"],
        risks: [],
        clarificationQuestions: [],
        owner: "Codex monitoring session",
        source: "gui",
        language: "zh-CN",
      },
    }],
  ]);

  new Script(appSource).runInContext(createContext({
    document,
    window: { localStorage: storage },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "/api/agent-presets") return responseJson({ ok: true, presets: [] });
      if (url === "/api/assist/result") {
        const body = JSON.parse(options.body);
        return responseJson(pendingResponses.get(body.issueId) || { ok: true, pending: true, status: "pending" });
      }
      if (url === "/api/goal/normalize") {
        return responseJson({
          ok: true,
          pending: true,
          assistChainId: "assist-goal-b",
          assistRequestId: "request-goal-b",
          assist: {
            issue: { id: "issue-goal-b", identifier: "SPA-B" },
            agent: { id: "agent-lead", name: "Claude-Lead" },
          },
        });
      }
      if (url === "/api/plan/split") throw new Error("existing pending plan assist must not be recreated");
      throw new Error(`unexpected fetch ${url}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
  }));

  await waitFor(() => document.querySelector("[data-action='new-workflow']"));
  document.querySelector("[data-action='new-workflow']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='new-workflow']") });
  document.querySelector("#goal-request-input").value = "流程 2：澄清 Goal";
  document.querySelector("[data-action='clarify-goal']").dispatchEvent({ type: "click", target: document.querySelector("[data-action='clarify-goal']") });

  await waitFor(() => document.textContent().includes("流程 2 已澄清目标"));

  assert.ok(document.textContent().includes("流程 2 已澄清目标"));
  assert.equal(document.textContent().includes("流程 1 已完成的 Plan"), false);

  const draft = JSON.parse(storage.getItem("multica-plusplus.workflow.v1"));
  assert.equal(draft.pendingAssists.length, 0);
  assert.equal(draft.pendingAssist, null);

  const records = JSON.parse(storage.getItem("multica-plusplus.workflow-records.v1")).records;
  const flowOne = records.find((record) => record.snapshot?.workflowId === "workflow-one");
  assert.ok(flowOne, "flow one record should still exist");
  assert.ok(JSON.stringify(flowOne.snapshot.planSet).includes("流程 1 已完成的 Plan"));
  assert.equal(JSON.stringify(draft.normalizedGoal).includes("流程 2 已澄清目标"), true);
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
  assert.ok(document.textContent().includes("团队预制体已创建"));
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

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
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
      if (selector.startsWith("[data-action='") && selector.includes("'][data-issue-preview-id='")) {
        const match = selector.match(/^\[data-action='([^']+)'\]\[data-issue-preview-id='([^']+)'\]$/);
        if (match) {
          return findNodeByAttributes(document.body, {
            "data-action": match[1],
            "data-issue-preview-id": match[2],
          });
        }
      }
      if (selector.startsWith("[data-agent-preset-id='")) {
        const id = selector.slice("[data-agent-preset-id='".length, -2);
        return findNodeByAttribute(document.body, "data-agent-preset-id", id);
      }
      if (selector.startsWith("[data-nav-target='")) {
        const target = selector.slice("[data-nav-target='".length, -2);
        return nodes.get(selector) ?? findNodeByAttribute(document.body, "data-nav-target", target);
      }
      if (selector.startsWith("[data-action='")) {
        const action = selector.slice("[data-action='".length, -2);
        return nodes.get(selector) ?? findNodeByAttribute(document.body, "data-action", action);
      }
      if (selector.startsWith("#")) {
        return nodes.get(selector) ?? findNodeById(document.body, selector.slice(1));
      }
      if (selector.startsWith(".")) {
        return findNodeByClass(document.body, selector.slice(1));
      }
      return nodes.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-nav-target]") {
        return Array.from(nodes.values()).filter((node) => node?.getAttribute?.("data-nav-target"));
      }
      if (selector === "[data-view]") {
        return Array.from(nodes.values()).filter((node) => node?.getAttribute?.("data-view"));
      }
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
    "#content-privacy-placeholder",
    "#view-control",
    "#permissions-view",
    "#activity-view",
    "#records-view",
    "#settings-view",
    "#placeholder-view",
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
    "#llm-custom-command",
    "#llm-custom-model",
    "#llm-timeout-ms",
    "#llm-secret-confirm",
  ];
  selectors.forEach((selector) => {
    const node = element(selector.replace(/^[#.]/, "div"));
    if (selector.startsWith("#")) {
      node.id = selector.slice(1);
      node.setAttribute("id", selector.slice(1));
    }
    nodes.set(selector, node);
    document.body.appendChild(node);
  });
  nodes.get("#plugin-preset-list").textContent = "插件预制体";
  nodes.get("#team-preset-list").textContent = "团队预制体";
  nodes.get("#content-privacy-placeholder").textContent = "当前内容已隐藏";
  [
    ["#view-control", "control"],
    ["#permissions-view", "permissions"],
    ["#activity-view", "activity"],
    ["#records-view", "records"],
    ["#settings-view", "settings"],
    ["#placeholder-view", "placeholder"],
  ].forEach(([selector, view]) => {
    nodes.get(selector).setAttribute("data-view", view);
  });
  nodes.set("[data-action='open-agent-config']", actionButton("open-agent-config"));
  nodes.set("[data-action='open-permissions']", actionButton("open-permissions"));
  nodes.set("[data-action='toggle-content-visibility']", actionButton("toggle-content-visibility", "toggle-content-visibility"));
  nodes.set("[data-action='show-workspace-content']", actionButton("show-workspace-content"));
  nodes.set("[data-action='preview-selected-preset']", actionButton("preview-selected-preset"));
  nodes.set("[data-action='create-selected-preset-agent']", actionButton("create-selected-preset-agent"));
  nodes.set("[data-action='create-team-preset']", actionButton("create-team-preset"));
  nodes.set("[data-action='split-plan-llm']", null);
  nodes.set("[data-action='create-image2-agent']", null);
  nodes.set("[data-nav-target='control']", navButton("control"));
  nodes.set("[data-nav-target='permissions']", navButton("permissions"));
  nodes.set("[data-nav-target='records']", navButton("records"));
  document.body.appendChild(nodes.get("[data-action='open-agent-config']"));
  document.body.appendChild(nodes.get("[data-action='open-permissions']"));
  document.body.appendChild(nodes.get("[data-action='toggle-content-visibility']"));
  document.body.appendChild(nodes.get("[data-action='show-workspace-content']"));
  document.body.appendChild(nodes.get("[data-action='preview-selected-preset']"));
  document.body.appendChild(nodes.get("[data-action='create-selected-preset-agent']"));
  document.body.appendChild(nodes.get("[data-action='create-team-preset']"));
  document.body.appendChild(nodes.get("[data-nav-target='control']"));
  document.body.appendChild(nodes.get("[data-nav-target='permissions']"));
  document.body.appendChild(nodes.get("[data-nav-target='records']"));
  nodes.set("#toggle-content-visibility", nodes.get("[data-action='toggle-content-visibility']"));

  function actionButton(action, id) {
    const node = element("button");
    node.setAttribute("data-action", action);
    if (id) {
      node.id = id;
      node.setAttribute("id", id);
    }
    node.dispatchEvent = (event) => {
      clickLog.push(`data-action:${action}`);
      clickHandlers.forEach((handler) => handler({ ...event, target: node }));
    };
    return node;
  }

  function navButton(target) {
    const node = element("button");
    node.setAttribute("data-nav-target", target);
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
        const action = child?.getAttribute?.("data-action");
        if (action) {
          nodes.set(`[data-action='${action}']`, child);
        }
        const id = child?.id || child?.getAttribute?.("id");
        if (id) {
          nodes.set(`#${id}`, child);
        }
        if (child?.getAttribute?.("data-action") === "create-image2-agent") {
          nodes.set("[data-action='create-image2-agent']", child);
        }
        if (child?.getAttribute?.("data-action") === "split-plan-llm") {
          nodes.set("[data-action='split-plan-llm']", child);
        }
        const presetId = child?.getAttribute?.("data-agent-preset-id");
        if (presetId) {
          nodes.set(`[data-agent-preset-id='${presetId}']`, child);
        }
        const navTarget = child?.getAttribute?.("data-nav-target");
        if (navTarget) {
          nodes.set(`[data-nav-target='${navTarget}']`, child);
        }
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter((item) => item !== child);
        this.firstChild = this.children[0] ?? null;
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
        if (name === "id") this.id = String(value);
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
        if (selector === "[data-issue-preview-id]" && attributes.has("data-issue-preview-id")) return this;
        if (selector === "[data-nav-target]" && attributes.has("data-nav-target")) return this;
        return null;
      },
      matches(selector) {
        if (selector?.startsWith("#")) return this.id === selector.slice(1) || attributes.get("id") === selector.slice(1);
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

function findNodeByAttributes(root, expected) {
  if (!root) return null;
  if (Object.entries(expected).every(([name, value]) => root.getAttribute?.(name) === value)) return root;
  for (const child of root.children ?? []) {
    const match = findNodeByAttributes(child, expected);
    if (match) return match;
  }
  return null;
}

function findNodeById(root, id) {
  if (!root) return null;
  if (root.id === id || root.getAttribute?.("id") === id) return root;
  for (const child of root.children ?? []) {
    const match = findNodeById(child, id);
    if (match) return match;
  }
  return null;
}

function findNodeByClass(root, className) {
  if (!root) return null;
  const classes = String(root.className || root.getAttribute?.("class") || "").split(/\s+/).filter(Boolean);
  if (classes.includes(className)) return root;
  for (const child of root.children ?? []) {
    const match = findNodeByClass(child, className);
    if (match) return match;
  }
  return null;
}
