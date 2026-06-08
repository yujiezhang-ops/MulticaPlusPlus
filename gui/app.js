(function () {
  "use strict";

  const WORKFLOW_STORAGE_KEY = "multica-plusplus.workflow.v1";
  const ASSIST_POLL_INTERVAL_MS = 60000;
  let assistSubscription = null;

  const mockData = {
    project: "MulticaPlusPlus",
    agent: "planner-agent",
    runtime: "local-docker",
    runStatus: "运行中",
    goal: {
      objective: "交付 GUI-first 的 Multica++ 控制台，覆盖目标、计划和一键 Agent 权限配置。",
      owner: "Codex 监控会话",
      status: "运行中",
      completedSteps: 6,
      totalSteps: 9,
      progress: 67,
      lastSaved: "2 分钟前",
      latestUpdateTime: "2 分钟前",
      latestUpdate:
        "静态 GUI、本地 server 桥接、预制体预览和 Image2 Agent 创建流程已就位；当前阶段是视觉 QA 和布局收敛。"
    },
    planItems: [
      { number: 1, task: "定义插件导航边界", status: "done", dependencies: "--" },
      { number: 2, task: "搭建目标 / 计划 / 权限控制面板", status: "done", dependencies: "1" },
      { number: 3, task: "加入预制体预览和编辑流程", status: "done", dependencies: "2" },
      { number: 4, task: "将本地 GUI server 接入 Multica CLI", status: "done", dependencies: "3" },
      { number: 5, task: "通过浏览器动作创建 Image2 Codex Agent", status: "done", dependencies: "4" },
      { number: 6, task: "收紧布局密度和响应式表现", status: "running", dependencies: "2, 3" },
      { number: 7, task: "记录预制体边界和交接规则", status: "pending", dependencies: "6" },
      { number: 8, task: "将团队预制体持久化到会话外", status: "blocked", dependencies: "7" },
      { number: 9, task: "运行浏览器 QA 和 Node 测试套件", status: "pending", dependencies: "6, 7" }
    ],
    templates: [
      {
        id: "backend",
        name: "后端开发（默认）",
        ttl: "2 小时",
        approvalRequired: true,
        riskLevel: "中风险",
        privileges: 18,
        writeAccess: 3,
        highRisk: 0,
        scopes: [
          { icon: "cube", group: "代码仓库", resource: "sparkproject/*", access: "读、写" },
          { icon: "database", group: "数据库", resource: "multica_pp_dev", access: "读、写" },
          { icon: "lock", group: "Secret 管理器", resource: "/multica_pp/*", access: "读" },
          { icon: "folder", group: "对象存储", resource: "s3://multica-pp-dev/*", access: "读、写" },
          { icon: "cube", group: "API", resource: "Internal APIs", access: "调用" }
        ]
      },
      {
        id: "review",
        name: "仅审查",
        ttl: "30 分钟",
        approvalRequired: true,
        riskLevel: "低风险",
        privileges: 7,
        writeAccess: 0,
        highRisk: 0,
        scopes: [
          { icon: "folder", group: "代码仓库", resource: "sparkproject/*", access: "读" },
          { icon: "database", group: "记录", resource: "launch-review/*", access: "读" },
          { icon: "cube", group: "API", resource: "Read-only status APIs", access: "调用" }
        ]
      },
      {
        id: "incident",
        name: "事故只读窗口",
        ttl: "15 分钟",
        approvalRequired: true,
        riskLevel: "中风险",
        privileges: 11,
        writeAccess: 1,
        highRisk: 0,
        scopes: [
          { icon: "folder", group: "代码仓库", resource: "sparkproject/*", access: "读" },
          { icon: "database", group: "数据库", resource: "multica_pp_dev", access: "读" },
          { icon: "lock", group: "Secret 管理器", resource: "/multica_pp/logs", access: "读" },
          { icon: "cube", group: "API", resource: "Recovery APIs", access: "调用" }
        ]
      }
    ],
    ttlOptions: ["30 分钟", "1 小时", "2 小时", "4 小时"],
    agentPresets: [
      {
        id: "image2",
        name: "Image2 Codex Agent",
        role: "高质量图像生成",
        model: "pa/gpt-5.5",
        runtime: "local-codex",
        permissionTemplate: "后端开发（默认）",
        ttl: "2 小时",
        cliPreset: "image2",
        skills: ["paigod-imagegen"],
        scopes: ["workspace:read", "skill:use", "shell:write", "imagegen:write"],
        guardrails: ["Codex 自动审批", "先 dry-run 图像 payload", "不记录 secret"],
        summary: "创建可运行的本地 Codex Agent，用于高质量 Paigod image2 生成。"
      },
      {
        id: "planner",
        name: "Planner Agent",
        role: "计划负责人",
        model: "gpt-5-codex",
        runtime: "local-docker",
        permissionTemplate: "后端开发（默认）",
        ttl: "2 小时",
        cliPreset: "planner",
        skills: ["launch-review", "plan-ledger", "permission-preview"],
        scopes: ["workspace:read", "repo:read", "issue:comment", "permission:preview"],
        guardrails: ["先 dry-run", "人工确认", "不写 secret env"],
        summary: "适合把目标拆成阶段计划和权限预览。"
      },
      {
        id: "reviewer",
        name: "Review Agent",
        role: "只读审查者",
        model: "gpt-5.4",
        runtime: "static-browser",
        permissionTemplate: "仅审查",
        ttl: "30 分钟",
        cliPreset: "review",
        skills: ["diff-review", "risk-summary", "records-check"],
        scopes: ["workspace:read", "records:read", "permission:preview"],
        guardrails: ["先 dry-run", "只读意图", "人工确认"],
        summary: "适合在应用运行配置前审查目标、计划和权限风险。"
      },
      {
        id: "incident",
        name: "Incident Triage Agent",
        role: "阻塞运行排查",
        model: "gpt-5-codex",
        runtime: "local-docker",
        permissionTemplate: "事故只读窗口",
        ttl: "15 分钟",
        cliPreset: "incident",
        skills: ["activity-scan", "blocked-reason", "recovery-note"],
        scopes: ["activity:read", "records:read", "runtime:read"],
        guardrails: ["先 dry-run", "限时窗口", "不写 secret env"],
        summary: "适合检查阻塞计划步骤并准备恢复说明。"
      }
    ],
    presetLibrary: [
      {
        id: "planner",
        source: "plugin",
        target: "agent",
        name: "Planner Agent",
        description: "把用户目标拆成检查点、launch review 记录和可维护计划。",
        role: "目标和计划负责人",
        createdBy: "Multica++",
        useCases: ["目标拆解", "计划台账", "launch review"],
        agent: {
          name: "Multica++ Planner Agent",
          description: "Planner",
          instructions: "将用户目标拆成可执行计划，先输出 Goal、Plan、权限预览和风险说明，再等待人工确认。",
          model: "pa/gpt-5.5",
          runtimeHint: "local-codex",
          visibility: "private",
          maxConcurrentTasks: 1
        },
        skills: [{ name: "launch-review" }, { name: "plan-ledger" }],
        mcpServers: [],
        permissions: { scopes: ["workspace:read", "issue:read"], ttl: "2 小时", approvalRequired: true, riskLevel: "中" },
        environment: [],
        guardrails: ["先预览", "写入前人工确认"]
      },
      {
        id: "image2-generation",
        source: "plugin",
        target: "agent",
        name: "Image2 Generation Agent",
        description: "创建高质量 Paigod image2 UI mockup 和视觉资产。",
        role: "高质量图像生成",
        createdBy: "Multica++",
        useCases: ["UI 概念生成", "产品 mockup"],
        agent: {
          name: "Multica++ Image2 Codex Agent",
          description: "Image2 生成器",
          instructions: "使用 paigod-imagegen 生成高质量 UI mockup。始终先 dry-run。",
          model: "pa/gpt-5.5",
          runtimeHint: "local-codex",
          visibility: "private",
          maxConcurrentTasks: 1
        },
        skills: [{ name: "paigod-imagegen", localPath: "C:\\Users\\PPIO\\.codex\\skills\\paigod-imagegen\\SKILL.md" }],
        mcpServers: [],
        permissions: { scopes: ["workspace:read", "skill:use", "shell:write"], ttl: "2 小时", approvalRequired: true, riskLevel: "中" },
        environment: [{ key: "OPENAI_API_KEY", pathHint: "%USERPROFILE%\\.codex\\auth.json", required: true }],
        guardrails: ["先 dry-run 图像 payload", "不记录 secret"]
      },
      {
        id: "team-gui-builder",
        source: "team",
        target: "agent",
        name: "Team GUI Builder Agent",
        description: "用于实现本地 Multica++ GUI 原型的团队预制体。",
        role: "GUI 实现成员",
        createdBy: "PPIO 团队",
        useCases: ["静态 GUI 实现", "视觉 QA", "本地测试"],
        agent: {
          name: "Team GUI Builder Agent",
          description: "GUI 构建器",
          instructions: "实现 Multica++ 本地 GUI 原型，保持黑白灰视觉、无前端构建依赖，并用测试验证交互。",
          model: "pa/gpt-5.5",
          runtimeHint: "local-codex",
          visibility: "private",
          maxConcurrentTasks: 1
        },
        skills: [{ name: "launch-review" }, { name: "test-driven-development" }],
        mcpServers: [{ name: "filesystem", purpose: "读取并编辑本地仓库。", required: true }],
        permissions: { scopes: ["workspace:read", "repo:write", "test:run"], ttl: "2 小时", approvalRequired: true, riskLevel: "中" },
        environment: [{ key: "GITHUB_TOKEN", pathHint: "GitHub CLI keyring", required: false }],
        guardrails: ["不 stage 无关文件", "运行 npm test", "不记录 secret"]
      }
    ],
    cliConfig: {
      confirmationToken: "APPLY-MULTICA-AGENT-CONFIG",
      image2ConfirmationToken: "CREATE-MULTICA-IMAGE2-CODEX-AGENT",
      presetConfirmationToken: "CREATE-MULTICA-AGENT-FROM-PRESET",
      discover: "node src/cli.js agent-config discover --output json",
      planOut: "out/agent-config-plan.json",
      reviewOut: "out/agent-config-plan.md"
    },
    llmAssist: {
      providerStatus: "未检测",
      providerSummary: "点击 Agent 辅助时自动检测 Multica daemon、runtime 和可用 Agent。",
      agentSelectionMode: "auto",
      selectedAgentId: "",
      agents: [],
      lastAssist: null,
      customCommand: "",
      model: "",
      timeoutMs: 300000,
      secretMetadataStatus: "未读取",
      secretMetadataSummary: "输入确认 token 后，只读取并展示本地密钥脱敏摘要。",
      secretMetadataConfirm: "",
      secretMetadata: null
    },
    records: [
      {
        time: "2026-06-04 15:00",
        title: "静态 GUI 会话已初始化",
        detail: "直接文件模式使用本地 mock 数据；npm run gui 会启用 Image2 Multica 创建按钮。"
      }
    ],
    languageOptions: [
      { id: "zh-CN", label: "中文", status: "当前", description: "当前默认界面语言，覆盖首屏和主要插件流程。" },
      { id: "en-US", label: "English", status: "预留", description: "英文入口已预留，完整英文文案包接入后启用。", reserved: true }
    ],
    placeholderCopy: {
      "native-boundary": "Project、Issues、Agents、Runs、Environments、Data、Skills、MCP 和 runtime settings 仍留在 Multica 原生侧。Multica++ 只预览和应用外部控制层配置。"
    }
  };

  const state = {
    activeView: "control",
    planFilter: "all",
    templateId: "backend",
    ttl: "2 小时",
    language: "zh-CN",
    goalRequest: "实现 Goal Plan 模块，复杂任务可以拆成一个或多个 Multica issue",
    normalizedGoal: null,
    lockedGoal: null,
    generatedPlan: null,
    planSet: null,
    pendingAssist: null,
    llmProviders: null,
    issueSplit: null,
    issueApplyConfirm: "",
    issueApplyStatus: "idle",
    issueApplyResult: null,
    issueApplyError: "",
    goalPlanStatus: "草稿",
    goalPlanFeedback: "先澄清并锁定 Goal；锁定后生成 Plan；Issue 只是 Plan 后的拆分预览。",
    goalPlanComplexity: "medium",
    agentConfigOpen: false,
    agentPresetId: "image2",
    selectedPresetId: "team-gui-builder",
    presetStatus: "草稿",
    presetFeedback: "选择预制体后可编辑默认配置。",
    agentConfigStatus: "草稿",
    agentConfigFeedback: "预览只发生在浏览器本地。真实 Multica 写入必须通过 CLI 并携带明确确认 token。",
    records: mockData.records.slice()
  };

  restoreWorkflowDraft();

  const viewIds = {
    control: "view-control",
    permissions: "permissions-view",
    activity: "activity-view",
    records: "records-view",
    settings: "settings-view",
    "native-boundary": "placeholder-view"
  };

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function currentTemplate() {
    return mockData.templates.find((template) => template.id === state.templateId) || mockData.templates[0];
  }

  function currentAgentPreset() {
    return mockData.agentPresets.find((preset) => preset.id === state.agentPresetId) || mockData.agentPresets[0];
  }

  function currentLibraryPreset() {
    return mockData.presetLibrary.find((preset) => preset.id === state.selectedPresetId) || mockData.presetLibrary[0];
  }

  function restoreWorkflowDraft() {
    const storage = browserStorage();
    if (!storage) return;
    try {
      const raw = storage.getItem(WORKFLOW_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object" || draft.version !== 1) return;
      [
        "language",
        "goalRequest",
        "normalizedGoal",
        "lockedGoal",
        "generatedPlan",
        "planSet",
        "pendingAssist",
        "issueSplit",
        "issueApplyStatus",
        "issueApplyResult",
        "issueApplyError",
        "goalPlanStatus",
        "goalPlanFeedback",
        "goalPlanComplexity",
      ].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(draft, field)) {
          state[field] = draft[field];
        }
      });
      if (draft.lastAssist) {
        mockData.llmAssist.lastAssist = draft.lastAssist;
      }
    } catch {
      storage.removeItem(WORKFLOW_STORAGE_KEY);
    }
  }

  function persistWorkflowDraft() {
    const storage = browserStorage();
    if (!storage) return;
    try {
      storage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        language: state.language,
        goalRequest: state.goalRequest,
        normalizedGoal: state.normalizedGoal,
        lockedGoal: state.lockedGoal,
        generatedPlan: state.generatedPlan,
        planSet: state.planSet,
        pendingAssist: state.pendingAssist,
        issueSplit: state.issueSplit,
        issueApplyStatus: state.issueApplyStatus,
        issueApplyResult: state.issueApplyResult,
        issueApplyError: state.issueApplyError,
        goalPlanStatus: state.goalPlanStatus,
        goalPlanFeedback: state.goalPlanFeedback,
        goalPlanComplexity: state.goalPlanComplexity,
        lastAssist: mockData.llmAssist.lastAssist || null,
      }));
    } catch {
      // localStorage can be unavailable in hardened browsers or file mode.
    }
  }

  function browserStorage() {
    try {
      return window?.localStorage || null;
    } catch {
      return null;
    }
  }

  function stableHash(value) {
    const input = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function nextAssistRequestId(kind) {
    return `request_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function assistChainId(kind, seed) {
    return `assist_${kind}_${stableHash(seed || kind)}`;
  }

  function stopAssistSubscription() {
    if (!assistSubscription) return;
    if (assistSubscription.eventSource) {
      assistSubscription.eventSource.close();
    }
    if (assistSubscription.timer) {
      clearTimeout(assistSubscription.timer);
    }
    assistSubscription = null;
  }

  function encodeQuery(params) {
    return Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
  }

  function statusLabel(status) {
    const labels = {
      done: "已完成",
      running: "进行中",
      pending: "待处理",
      blocked: "阻塞"
    };
    return labels[status] || status;
  }

  function goalStatusLabel(status) {
    const labels = {
      draft: "草稿",
      clarified: "已澄清",
      locked: "已锁定",
      "Needs clarification": "需要澄清",
      Clarified: "已澄清",
      Locked: "已锁定",
      Previewed: "已预览",
      Failed: "失败"
    };
    return labels[status] || status;
  }

  function compactText(value, maxLength = 160) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
  }

  function setPressed() {
    qsa("[data-nav-target]").forEach((node) => {
      const active = node.getAttribute("data-nav-target") === state.activeView;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-current", active ? "page" : "false");
    });
  }

  function makeIcon(name) {
    return el("span", `inline-icon inline-icon-${name}`);
  }

  function renderTopbar() {
    const project = qs("#project-value");
    const agent = qs("#agent-value");
    const runtime = qs("#runtime-value");
    const status = qs("#run-status-value");
    if (project) project.textContent = mockData.project;
    if (agent) agent.textContent = mockData.agent;
    if (runtime) runtime.textContent = mockData.runtime;
    if (status) status.textContent = mockData.runStatus;
  }

  function renderGoal() {
    const target = qs("#goal-summary");
    if (!target) return;
    clear(target);

    const builder = el("section", "goal-builder");
    builder.appendChild(el("span", "section-label", "澄清模糊需求"));
    const input = el("textarea", "goal-request-input");
    input.id = "goal-request-input";
    input.rows = 4;
    input.value = state.goalRequest;
    input.setAttribute("aria-label", "目标需求输入");
    builder.appendChild(input);
    const controls = el("div", "goal-action-row");
    const clarify = el("button", "outline-button");
    clarify.type = "button";
    clarify.setAttribute("data-action", "clarify-goal");
    clarify.appendChild(makeIcon("spark"));
    clarify.appendChild(el("span", "", state.goalPlanStatus === "澄清中" ? "澄清中" : "澄清目标"));
    const lock = el("button", "primary-button");
    lock.type = "button";
    lock.disabled = !state.normalizedGoal || state.normalizedGoal.status === "draft" || state.goalPlanStatus === "锁定中";
    lock.setAttribute("data-action", "lock-goal");
    lock.appendChild(makeIcon("lock"));
    lock.appendChild(el("span", "", state.goalPlanStatus === "锁定中" ? "锁定中" : "锁定目标"));
    controls.appendChild(clarify);
    controls.appendChild(lock);
    builder.appendChild(controls);
    builder.appendChild(el("p", "goal-feedback", state.goalPlanFeedback));
    target.appendChild(builder);

    const objective = el("section", "goal-section");
    objective.appendChild(el("span", "section-label", "当前目标"));
    objective.appendChild(el("h2", "goal-title", state.lockedGoal?.objective || state.normalizedGoal?.objective || mockData.goal.objective));
    if (state.normalizedGoal?.successCriteria?.length) {
      objective.appendChild(configList("目标详情 · 成功标准", state.normalizedGoal.successCriteria));
    }
    if (state.normalizedGoal?.clarificationQuestions?.length) {
      objective.appendChild(configList("目标详情 · 待澄清问题", state.normalizedGoal.clarificationQuestions));
    }
    target.appendChild(objective);

    const meta = el("div", "goal-meta-row");
    const owner = el("div", "goal-meta");
    owner.appendChild(el("span", "section-label", "负责人"));
    const ownerValue = el("span", "person-value");
    ownerValue.appendChild(makeIcon("user"));
    ownerValue.appendChild(el("span", "", state.lockedGoal?.owner || state.normalizedGoal?.owner || mockData.goal.owner));
    owner.appendChild(ownerValue);

    const status = el("div", "goal-meta");
    status.appendChild(el("span", "section-label", "状态"));
    const statusValue = el("span", "status-chip status-running");
    statusValue.appendChild(el("span", "status-dot"));
    statusValue.appendChild(el("span", "", goalStatusLabel(state.lockedGoal?.status || state.normalizedGoal?.status || mockData.goal.status)));
    status.appendChild(statusValue);
    meta.appendChild(owner);
    meta.appendChild(status);
    target.appendChild(meta);

    const progressSection = el("section", "goal-section progress-section");
    const progressHeader = el("div", "progress-header");
    progressHeader.appendChild(el("span", "", "进度"));
    progressHeader.appendChild(el("span", "", `${mockData.goal.completedSteps} / ${mockData.goal.totalSteps} 步`));
    progressHeader.appendChild(el("span", "", `${mockData.goal.progress}%`));
    progressSection.appendChild(progressHeader);
    const progress = el("div", "progress-track");
    const fill = el("span", "progress-fill");
    fill.style.width = `${mockData.goal.progress}%`;
    progress.appendChild(fill);
    progressSection.appendChild(progress);
    target.appendChild(progressSection);

    const resume = el("section", "resume-card");
    const resumeCopy = el("div", "");
    resumeCopy.appendChild(el("h3", "", "恢复 / 继续"));
    resumeCopy.appendChild(el("p", "", `最后保存 ${mockData.goal.lastSaved}`));
    const resumeButton = el("button", "outline-button resume-button");
    resumeButton.type = "button";
    resumeButton.setAttribute("data-action", "resume-goal");
    resumeButton.appendChild(makeIcon("play"));
    resumeButton.appendChild(el("span", "", "继续"));
    resume.appendChild(resumeCopy);
    resume.appendChild(resumeButton);
    target.appendChild(resume);

    const update = el("section", "goal-section latest-update");
    const updateHeader = el("div", "split-header");
    updateHeader.appendChild(el("h3", "", "最新目标更新"));
    updateHeader.appendChild(el("span", "", mockData.goal.latestUpdateTime));
    update.appendChild(updateHeader);
    update.appendChild(el("p", "", state.normalizedGoal?.title || mockData.goal.latestUpdate));
    target.appendChild(update);

    const history = el("button", "full-row-button");
    history.type = "button";
    history.setAttribute("data-action", "view-goal-history");
    history.appendChild(makeIcon("clock"));
    history.appendChild(el("span", "", "查看目标历史"));
    history.appendChild(el("span", "row-arrow"));
    target.appendChild(history);
  }

  function renderGoalPlanPath() {
    const wrapper = el("section", "goal-plan-path-wrap");
    wrapper.appendChild(el("p", "goal-plan-path-title", "Goal -> Plan -> Issue"));
    const path = el("ol", "goal-plan-path");
    [
      {
        label: "Goal",
        status: state.lockedGoal ? "已锁定" : state.normalizedGoal ? "待锁定" : "待澄清",
        done: Boolean(state.lockedGoal),
      },
      {
        label: "Plan",
        status: state.generatedPlan || state.planSet ? "已生成" : "待生成",
        done: Boolean(state.generatedPlan || state.planSet),
      },
      {
        label: "Issue",
        status: state.issueApplyResult?.createdIssues?.length ? "已创建" : state.issueSplit ? "已预览" : "待预览",
        done: Boolean(state.issueSplit),
      },
    ].forEach((item) => {
      const node = el("li", item.done ? "is-complete" : "");
      node.appendChild(el("span", "path-label", item.label));
      node.appendChild(el("span", "path-status", `${item.label} ${item.status}`));
      path.appendChild(node);
    });
    wrapper.appendChild(path);
    return wrapper;
  }

  function renderIssueSplitPreview() {
    const previewCard = el("section", "issue-split-card");
    previewCard.appendChild(el("h3", "", "Plan 到 Issue 预览"));
    previewCard.appendChild(el("p", "", state.issueSplit.summary));
    if (state.issueSplit.issues?.length) {
      const list = el("div", "issue-preview-list");
      state.issueSplit.issues.forEach((issue, index) => {
        const item = el("article", "issue-preview-item");
        const itemHeader = el("div", "split-header");
        itemHeader.appendChild(el("h4", "", issue.title));
        itemHeader.appendChild(el("span", "config-status", issue.priority || "medium"));
        item.appendChild(itemHeader);
        const description = compactText(issue.description || "", 150);
        if (description) {
          item.appendChild(el("p", "issue-description-preview", description));
        }
        const operation = state.issueSplit.operations?.[index];
        if (issue.metadata && Object.keys(issue.metadata).length) {
          const metadata = el("dl", "config-definition issue-metadata");
          Object.entries(issue.metadata).forEach(([key, value]) => {
            metadata.appendChild(el("dt", "", key));
            metadata.appendChild(el("dd", "", String(value)));
          });
          item.appendChild(metadata);
        }
        if (operation?.displayCommand) {
          const command = el("div", "cli-command-row issue-operation");
          command.appendChild(el("span", "cli-command-label", "将执行"));
          command.appendChild(el("code", "", operation.displayCommand));
          item.appendChild(command);
        }
        list.appendChild(item);
      });
      previewCard.appendChild(list);
      previewCard.appendChild(renderIssueApplyControls());
    } else {
      previewCard.appendChild(el("p", "", "不会创建 Multica issue。"));
    }
    return previewCard;
  }

  function renderIssueApplyControls() {
    const section = el("section", "issue-apply-card");
    section.appendChild(el("h4", "", "确认创建业务 Issue"));
    section.appendChild(el("p", "setting-help", "预览阶段不会写入 Multica。只有输入确认 token 后，才会创建真实业务 Issue；Agent assist issue 不算业务 Issue。"));
    if (state.issueSplit.confirmationRequired) {
      const token = state.issueSplit.confirmationToken || "APPLY-MULTICA-ISSUE-SPLIT";
      const input = el("input", "confirm-input");
      input.id = "issue-split-confirm";
      input.value = state.issueApplyConfirm;
      input.placeholder = token;
      input.setAttribute("aria-label", "业务 Issue 创建确认 token");
      section.appendChild(input);
      const actionRow = el("div", "goal-action-row");
      const create = el("button", "primary-button");
      create.type = "button";
      create.disabled = state.issueApplyStatus === "creating";
      create.setAttribute("data-action", "apply-issue-split");
      create.appendChild(makeIcon("plus"));
      create.appendChild(el("span", "", state.issueApplyStatus === "creating" ? "创建中" : "创建 Multica Issue"));
      actionRow.appendChild(create);
      section.appendChild(actionRow);
      section.appendChild(el("p", "setting-help", `必须输入 ${token}`));
    }
    if (state.issueApplyError) {
      section.appendChild(el("p", "goal-feedback error-text", state.issueApplyError));
    }
    if (state.issueApplyResult?.createdIssues?.length) {
      const created = el("ul", "created-issue-list");
      state.issueApplyResult.createdIssues.forEach((issue) => {
        created.appendChild(el("li", "", `${issue.identifier || issue.id} · ${issue.title || "Multica Issue"}`));
      });
      section.appendChild(created);
    }
    return section;
  }

  function renderAssistRunSummary(assist) {
    const section = el("section", "assist-run-summary");
    const issue = assist?.issue;
    const run = assist?.run;
    if (!issue && !run) {
      section.appendChild(el("p", "setting-help", "Agent 辅助会创建真实 Multica assist issue/task；业务 Issue 仍只生成预览候选。"));
      return section;
    }
    const rows = [
      ["Assist Issue", issue?.identifier || issue?.id],
      ["Issue 状态", issue?.status],
      ["Run", run?.id],
      ["Run 状态", run?.status],
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const definition = el("dl", "config-definition");
    rows.forEach(([label, value]) => {
      definition.appendChild(el("dt", "", label));
      definition.appendChild(el("dd", "", String(value)));
    });
    section.appendChild(definition);
    section.appendChild(el("p", "setting-help", "上方 assist issue/task 是点击即运行产生的真实 Multica 调用记录；下方业务 Issue 仍需预览和确认后才会创建。"));
    return section;
  }

  function renderPlan() {
    const target = qs("#plan-list");
    if (!target) return;
    clear(target);

    const planBuilder = el("section", "plan-builder");
    const header = el("div", "split-header");
    header.appendChild(el("h3", "", "目标到计划"));
    header.appendChild(el("span", "config-status", state.planSet ? "并行 Plan" : (state.generatedPlan?.issueSplitRecommendation || "预览")));
    planBuilder.appendChild(header);
    planBuilder.appendChild(renderGoalPlanPath());
    const controls = el("div", "goal-action-row");
    const complexity = el("select", "");
    complexity.id = "goal-plan-complexity";
    complexity.setAttribute("data-goal-plan-complexity", "true");
    [
      ["simple", "简单 · 不创建 issue"],
      ["medium", "中等 · 单个 issue"],
      ["complex", "复杂 · 多个 issue"]
    ].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      option.selected = value === state.goalPlanComplexity;
      complexity.appendChild(option);
    });
    const preview = el("button", "primary-button");
    preview.type = "button";
    preview.disabled = !state.lockedGoal || state.goalPlanStatus === "预览中";
    preview.setAttribute("data-action", "preview-issue-split");
    preview.appendChild(makeIcon("eye"));
    preview.appendChild(el("span", "", state.goalPlanStatus === "预览中" ? "预览中" : state.planSet ? "预览业务 Issue" : "生成 Plan 并预览 Issue"));
    const splitLlm = el("button", "outline-button");
    splitLlm.type = "button";
    splitLlm.disabled = !state.lockedGoal || state.goalPlanStatus === "Agent 拆分中";
    splitLlm.setAttribute("data-action", "split-plan-llm");
    splitLlm.appendChild(makeIcon("spark"));
    splitLlm.appendChild(el("span", "", state.goalPlanStatus === "Agent 拆分中" ? "Agent 拆分中" : "Agent 辅助拆分为多个 Plan"));
    controls.appendChild(complexity);
    controls.appendChild(preview);
    controls.appendChild(splitLlm);
    planBuilder.appendChild(controls);
    planBuilder.appendChild(el("p", "goal-feedback", state.planSet ? `${state.planSet.plans.length} 个并行 Plan 已生成，Agent：${state.planSet.assist?.agent?.name || state.planSet.provider?.model || state.planSet.provider?.kind || "Multica Agent"}；下一步预览业务 Issue，确认 token 后才会创建真实 Multica Issue。` : (state.issueSplit?.summary || "Locked Goal 会先生成 Plan，再由 Plan 预览是否需要创建 Multica issue。")));
    if (state.pendingAssist?.issueId) {
      const pendingCard = el("section", "assist-run-summary");
      pendingCard.appendChild(el("h3", "", "Assist Issue 收件箱订阅"));
      const rows = [
        ["类型", state.pendingAssist.kind === "goal" ? "Goal 澄清" : "Plan 拆分"],
        ["Issue", state.pendingAssist.issueIdentifier || state.pendingAssist.issueId],
        ["Agent", state.pendingAssist.agent?.name || state.pendingAssist.agent?.id],
        ["Request", state.pendingAssist.assistRequestId],
      ].filter(([, value]) => value !== undefined && value !== null && value !== "");
      const definition = el("dl", "config-definition");
      rows.forEach(([label, value]) => {
        definition.appendChild(el("dt", "", label));
        definition.appendChild(el("dd", "", String(value)));
      });
      pendingCard.appendChild(definition);
      pendingCard.appendChild(el("p", "setting-help", "页面刷新后会继续订阅同一个 Assist Issue 的评论/运行结果，不会重新创建 assist task。"));
      planBuilder.appendChild(pendingCard);
    }
    if (state.planSet?.plans?.length) {
      const planSetCard = el("section", "plan-set-card");
      const planSetHeader = el("div", "split-header");
      planSetHeader.appendChild(el("h3", "", "并行 Plan"));
      planSetHeader.appendChild(el("span", "config-status", state.planSet.assist?.agent?.name || state.planSet.provider?.model || state.planSet.provider?.kind || "Agent"));
      planSetCard.appendChild(planSetHeader);
      planSetCard.appendChild(renderAssistRunSummary(state.planSet.assist));
      state.planSet.plans.forEach((plan) => {
        const card = el("article", "sub-plan-card");
        const cardHeader = el("div", "split-header");
        cardHeader.appendChild(el("h4", "", `${plan.number}. ${plan.title}`));
        cardHeader.appendChild(el("span", "config-status", plan.workstream?.label || plan.workstream?.id || "workstream"));
        card.appendChild(cardHeader);
        card.appendChild(el("p", "", plan.objective));
        const meta = el("dl", "config-definition");
        [
          ["建议 Agent", plan.suggestedAgent || "未指定"],
          ["依赖", Array.isArray(plan.dependencies) && plan.dependencies.length ? plan.dependencies.join(", ") : "无"],
          ["验收证据", plan.acceptanceEvidence || "待补充"]
        ].forEach(([label, value]) => {
          meta.appendChild(el("dt", "", label));
          meta.appendChild(el("dd", "", value));
        });
        card.appendChild(meta);
        if (plan.steps?.length) {
          const steps = el("ol", "sub-plan-steps");
          plan.steps.forEach((step) => {
            steps.appendChild(el("li", "", `${step.title} · ${step.acceptanceEvidence || "待验收"}`));
          });
          card.appendChild(steps);
        }
        planSetCard.appendChild(card);
      });
      planBuilder.appendChild(planSetCard);
    }
    if (state.issueSplit) {
      planBuilder.appendChild(renderIssueSplitPreview());
    }
    target.appendChild(planBuilder);

    const toolbar = el("div", "plan-toolbar");
    [
      ["all", "全部"],
      ["running", "进行中"],
      ["pending", "待处理"],
      ["done", "已完成"],
      ["blocked", "阻塞"]
    ].forEach(([status, label]) => {
      const count = status === "all"
        ? mockData.planItems.length
        : mockData.planItems.filter((item) => item.status === status).length;
      const button = el("button", "plan-filter", `${label} ${count}`);
      button.type = "button";
      button.setAttribute("data-plan-filter", status);
      button.setAttribute("aria-pressed", state.planFilter === status ? "true" : "false");
      toolbar.appendChild(button);
    });
    target.appendChild(toolbar);

    const table = el("table", "plan-table");
    const thead = el("thead");
    const headerRow = el("tr");
    ["#", "任务", "状态", "依赖"].forEach((label) => headerRow.appendChild(el("th", "", label)));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    const sourceItems = state.planSet?.plans?.length
      ? state.planSet.plans.map((plan) => ({
        number: plan.number,
        task: plan.title,
        status: plan.status,
        dependencies: Array.isArray(plan.dependencies) && plan.dependencies.length ? plan.dependencies.join(", ") : "--"
      }))
      : state.generatedPlan?.steps?.length
      ? state.generatedPlan.steps.map((step) => ({
        number: step.number,
        task: step.title,
        status: step.status,
        dependencies: Array.isArray(step.dependencies) && step.dependencies.length ? step.dependencies.join(", ") : "--"
      }))
      : [];
    const items = state.planFilter === "all"
      ? sourceItems
      : sourceItems.filter((item) => item.status === state.planFilter);
    items.forEach((item) => {
      const row = el("tr", `plan-row status-${item.status}`);
      row.setAttribute("data-plan-status", item.status);
      row.appendChild(el("td", "plan-number", String(item.number)));
      row.appendChild(el("td", "plan-task", item.task));
      const statusCell = el("td", "plan-status-cell");
      const pill = el("span", `status-inline status-${item.status}`);
      pill.appendChild(el("span", "status-ring"));
      pill.appendChild(el("span", "", statusLabel(item.status)));
      statusCell.appendChild(pill);
      row.appendChild(statusCell);
      row.appendChild(el("td", "plan-deps", item.dependencies));
      tbody.appendChild(row);
    });
    if (items.length === 0) {
      const row = el("tr", "plan-row");
      const cell = el("td", "plan-empty", state.generatedPlan || state.planSet ? "没有符合当前筛选的计划项。" : "Plan 待生成。请先锁定 Goal，再生成 Plan。");
      cell.colSpan = 4;
      row.appendChild(cell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    target.appendChild(table);

    const legend = el("div", "plan-legend");
    ["done", "running", "pending", "blocked"].forEach((status) => {
      const item = el("span", `legend-item status-${status}`);
      item.appendChild(el("span", "status-ring"));
      item.appendChild(el("span", "", statusLabel(status)));
      legend.appendChild(item);
    });
    target.appendChild(legend);

    const current = sourceItems.find((item) => item.status === "running");
    const footer = el("div", "plan-current-step");
    footer.appendChild(el("span", "", "当前步骤"));
    footer.appendChild(el("strong", "", current ? `${current.number} / ${sourceItems.length}` : "--"));
    footer.appendChild(el("span", "", current ? current.task : "暂无活跃步骤"));
    target.appendChild(footer);
  }

  function renderPermissionSummary(template) {
    const target = qs("#permission-summary");
    if (!target) return;
    clear(target);

    const templateRow = el("section", "permission-template-row");
    templateRow.appendChild(el("label", "", "权限模板"));
    const select = el("select", "");
    select.id = "permission-template";
    select.setAttribute("data-permission-template", "true");
    mockData.templates.forEach((item) => {
      const option = el("option", "", item.name);
      option.value = item.id;
      option.selected = item.id === template.id;
      select.appendChild(option);
    });
    templateRow.appendChild(select);
    target.appendChild(templateRow);
  }

  function renderPermissionScopes(template) {
    const target = qs("#permission-scopes");
    if (!target) return;
    clear(target);

    const section = el("section", "scope-section");
    const header = el("div", "split-header");
    header.appendChild(el("h3", "", "Scope（资源组）"));
    const editButton = el("button", "ghost-button edit-button");
    editButton.type = "button";
    editButton.setAttribute("data-action", "edit-scopes");
    editButton.appendChild(el("span", "", "编辑"));
    editButton.appendChild(makeIcon("pencil"));
    header.appendChild(editButton);
    section.appendChild(header);

    const table = el("div", "scope-table");
    template.scopes.forEach((scope) => {
      const row = el("div", "scope-row");
      row.appendChild(makeIcon(scope.icon));
      row.appendChild(el("strong", "", scope.group));
      row.appendChild(el("span", "", scope.resource));
      row.appendChild(el("span", "", scope.access));
      table.appendChild(row);
    });
    section.appendChild(table);
    target.appendChild(section);
  }

  function renderPermissionRisk(template) {
    const target = qs("#permission-risk");
    if (!target) return;
    clear(target);

    const controls = el("section", "permission-controls");
    const ttl = el("label", "ttl-field");
    ttl.appendChild(el("span", "", "TTL（租约时长）"));
    const ttlSelect = el("select", "");
    ttlSelect.id = "permission-ttl";
    ttlSelect.setAttribute("data-permission-ttl", "true");
    mockData.ttlOptions.forEach((value) => {
      const option = el("option", "", value);
      option.value = value;
      option.selected = value === state.ttl;
      ttlSelect.appendChild(option);
    });
    ttl.appendChild(ttlSelect);
    controls.appendChild(ttl);

    const approval = el("label", "approval-toggle");
    approval.appendChild(el("span", "", "需要审批"));
    approval.appendChild(makeIcon("info"));
    const toggle = el("input", "");
    toggle.type = "checkbox";
    toggle.checked = template.approvalRequired;
    toggle.setAttribute("data-permission-approval", "true");
    const switcher = el("span", "switch-ui");
    approval.appendChild(toggle);
    approval.appendChild(switcher);
    controls.appendChild(approval);
    target.appendChild(controls);

    const risk = el("section", "risk-card");
    const riskHeader = el("div", "split-header");
    riskHeader.appendChild(el("h3", "", "风险摘要"));
    riskHeader.appendChild(el("span", "muted-link", "查看详情"));
    risk.appendChild(riskHeader);

    const riskGrid = el("div", "risk-grid");
    const meter = el("div", "risk-meter");
    meter.appendChild(makeIcon("shield"));
    const meterCopy = el("div", "");
    meterCopy.appendChild(el("strong", "", template.riskLevel));
    const bars = el("span", "risk-bars");
    for (let index = 0; index < 5; index += 1) bars.appendChild(el("i", index < 2 ? "is-filled" : ""));
    meterCopy.appendChild(bars);
    meter.appendChild(meterCopy);
    riskGrid.appendChild(meter);
    riskGrid.appendChild(riskMetric("权限项", template.privileges));
    riskGrid.appendChild(riskMetric("写权限", template.writeAccess));
    riskGrid.appendChild(riskMetric("高风险", template.highRisk));
    risk.appendChild(riskGrid);
    target.appendChild(risk);
  }

  function riskMetric(label, value) {
    const node = el("div", "risk-metric");
    node.appendChild(el("span", "", label));
    node.appendChild(el("strong", "", String(value)));
    return node;
  }

  function renderPermissions() {
    const template = currentTemplate();
    if (!mockData.ttlOptions.includes(state.ttl)) state.ttl = template.ttl;
    renderPermissionSummary(template);
    renderPermissionScopes(template);
    renderPermissionRisk(template);
  }

  function renderActivity() {
    const feed = qs("#activity-feed");
    if (!feed) return;
    clear(feed);
    feed.appendChild(el("p", "panel-note", "活动页目前是本地可视壳，尚未接入 runtime stream。"));
    const list = el("ul", "record-list");
    [
      "目标已从本地 mock 状态恢复。",
      "权限预览和应用动作只写入页面内记录。",
      "只有 Image2 创建按钮会调用本地 GUI server；其他控件仍保持本地行为。"
    ].forEach((item) => list.appendChild(el("li", "record-item", item)));
    feed.appendChild(list);
  }

  function renderRecords() {
    const list = qs("#records-list");
    if (!list) return;
    clear(list);
    list.appendChild(el("p", "panel-note", "记录页展示页面内 mock 记录，不做持久化写入。"));
    const records = el("ul", "record-list");
    state.records.slice().reverse().forEach((record) => {
      const item = el("li", "record-item");
      item.appendChild(el("span", "record-time", record.time));
      item.appendChild(el("strong", "", record.title));
      item.appendChild(el("p", "", record.detail));
      records.appendChild(item);
    });
    list.appendChild(records);
  }

  function renderSettings() {
    const panel = qs("#settings-panel");
    if (!panel) return;
    clear(panel);
    panel.appendChild(el("p", "panel-note", "设置页用于插件级偏好项。当前只启用中文界面，并预留英文切换入口。"));
    const language = el("section", "setting-card");
    const languageHeader = el("div", "split-header");
    languageHeader.appendChild(el("h3", "", "界面语言"));
    languageHeader.appendChild(el("span", "config-status", "中文优先"));
    language.appendChild(languageHeader);
    const languageOptions = el("div", "language-options");
    mockData.languageOptions.forEach((option) => {
      const button = el("button", option.reserved ? "language-option is-reserved" : "language-option");
      button.type = "button";
      button.setAttribute("data-language-option", option.id);
      button.setAttribute("aria-pressed", state.language === option.id ? "true" : "false");
      if (option.reserved) button.setAttribute("aria-disabled", "true");
      button.appendChild(el("strong", "", option.label));
      button.appendChild(el("span", "language-status", option.status));
      button.appendChild(el("span", "language-description", option.description));
      languageOptions.appendChild(button);
    });
    language.appendChild(languageOptions);
    language.appendChild(el("p", "setting-help", "英文入口已预留为插件设置项；在接入完整 en-US 文案包前不会切换当前界面。"));
    panel.appendChild(language);

    const llm = el("section", "setting-card");
    const llmHeader = el("div", "split-header");
    llmHeader.appendChild(el("h3", "", "Multica Agent 辅助"));
    llmHeader.appendChild(el("span", "config-status", mockData.llmAssist.providerStatus));
    llm.appendChild(llmHeader);
    llm.appendChild(el("p", "setting-help", mockData.llmAssist.providerSummary));
    const llmFields = el("div", "llm-settings-grid");
    const modeField = el("label", "preset-edit-field");
    modeField.appendChild(el("span", "", "选择方式"));
    const modeSelect = el("select", "");
    modeSelect.id = "assist-selection-mode";
    [
      ["auto", "自动选择"],
      ["manual", "手动选择"]
    ].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      option.selected = mockData.llmAssist.agentSelectionMode === value;
      modeSelect.appendChild(option);
    });
    modeField.appendChild(modeSelect);
    const agentField = el("label", "preset-edit-field");
    agentField.appendChild(el("span", "", "Agent"));
    const agentSelect = el("select", "");
    agentSelect.id = "assist-agent-id";
    const autoOption = el("option", "", "自动选择可用 Agent");
    autoOption.value = "";
    autoOption.selected = !mockData.llmAssist.selectedAgentId;
    agentSelect.appendChild(autoOption);
    mockData.llmAssist.agents.forEach((agent) => {
      const option = el("option", "", `${agent.name || agent.id} · ${agent.status || "unknown"} · ${agent.runtimeStatus || "runtime"}`);
      option.value = agent.id;
      option.selected = mockData.llmAssist.selectedAgentId === agent.id;
      agentSelect.appendChild(option);
    });
    agentField.appendChild(agentSelect);
    const timeoutField = el("label", "preset-edit-field");
    timeoutField.appendChild(el("span", "", "运行超时 ms（默认 300000）"));
    const timeoutInput = el("input", "");
    timeoutInput.id = "llm-timeout-ms";
    timeoutInput.type = "number";
    timeoutInput.value = String(mockData.llmAssist.timeoutMs);
    timeoutField.appendChild(timeoutInput);
    llmFields.appendChild(modeField);
    llmFields.appendChild(agentField);
    llmFields.appendChild(timeoutField);
    llm.appendChild(llmFields);
    llm.appendChild(renderAssistAgentList());
    const llmActions = el("div", "setting-actions");
    const diagnose = el("button", "outline-button");
    diagnose.type = "button";
    diagnose.setAttribute("data-action", "diagnose-llm");
    diagnose.appendChild(makeIcon("eye"));
    diagnose.appendChild(el("span", "", "检测 Agent"));
    llmActions.appendChild(diagnose);
    llm.appendChild(llmActions);
    panel.appendChild(llm);

    const legacy = el("details", "setting-card legacy-llm-card");
    const legacySummary = el("summary", "", "高级：本地 CLI 直连 provider（默认不使用）");
    legacy.appendChild(legacySummary);
    legacy.appendChild(el("p", "setting-help", "保留 Codex / Claude 直连配置用于排查旧链路；默认 Goal/Plan 辅助通过 Multica Agent。"));
    const legacyFields = el("div", "llm-settings-grid");
    const commandField = el("label", "preset-edit-field");
    commandField.appendChild(el("span", "", "用户自定义命令"));
    const commandInput = el("input", "");
    commandInput.id = "llm-custom-command";
    commandInput.type = "text";
    commandInput.value = mockData.llmAssist.customCommand;
    commandInput.setAttribute("placeholder", "codex 或 claude");
    commandField.appendChild(commandInput);
    const modelField = el("label", "preset-edit-field");
    modelField.appendChild(el("span", "", "模型名"));
    const modelInput = el("input", "");
    modelInput.id = "llm-custom-model";
    modelInput.type = "text";
    modelInput.value = mockData.llmAssist.model;
    modelInput.setAttribute("placeholder", "gpt-5-codex / runtime default");
    modelField.appendChild(modelInput);
    legacyFields.appendChild(commandField);
    legacyFields.appendChild(modelField);
    legacy.appendChild(legacyFields);
    panel.appendChild(legacy);

    const secret = el("details", "setting-card secret-metadata-card");
    const secretSummary = el("summary", "", "高级：读取本地 CLI 密钥摘要");
    secret.appendChild(secretSummary);
    const secretHeader = el("div", "split-header");
    secretHeader.appendChild(el("h3", "", "读取密钥摘要"));
    secretHeader.appendChild(el("span", "config-status", mockData.llmAssist.secretMetadataStatus));
    secret.appendChild(secretHeader);
    secret.appendChild(el("p", "setting-help", mockData.llmAssist.secretMetadataSummary));
    const secretFields = el("div", "llm-settings-grid secret-metadata-grid");
    const confirmField = el("label", "preset-edit-field");
    confirmField.appendChild(el("span", "", "确认 token"));
    const confirmInput = el("input", "");
    confirmInput.id = "llm-secret-confirm";
    confirmInput.type = "text";
    confirmInput.value = mockData.llmAssist.secretMetadataConfirm;
    confirmInput.setAttribute("placeholder", "READ-LOCAL-LLM-SECRET-METADATA");
    confirmField.appendChild(confirmInput);
    confirmField.appendChild(el("span", "setting-help", "确认 token 为 READ-LOCAL-LLM-SECRET-METADATA。"));
    secretFields.appendChild(confirmField);
    secret.appendChild(secretFields);
    const secretActions = el("div", "setting-actions");
    const readSecret = el("button", "outline-button");
    readSecret.type = "button";
    readSecret.setAttribute("data-action", "read-llm-secret-metadata");
    readSecret.appendChild(makeIcon("eye"));
    readSecret.appendChild(el("span", "", "读取密钥摘要"));
    secretActions.appendChild(readSecret);
    secret.appendChild(secretActions);
    secret.appendChild(renderSecretMetadataSummary());
    panel.appendChild(secret);

    const list = el("ul", "record-list");
    [
      "默认权限模板：后端开发（默认）",
      "默认 TTL：2 小时",
      "外部集成：禁用",
      "Metadata 写入：禁用"
    ].forEach((item) => list.appendChild(el("li", "record-item", item)));
    panel.appendChild(list);
  }

  function renderPresetSidebar() {
    renderPresetGroup("#plugin-preset-list", "plugin");
    renderPresetGroup("#team-preset-list", "team");
  }

  function renderPresetGroup(selector, source) {
    const target = qs(selector);
    if (!target) return;
    clear(target);
    const presets = mockData.presetLibrary.filter((preset) => preset.source === source);
    presets.forEach((preset) => {
      const button = el("button", "preset-sidebar-button");
      button.type = "button";
      button.setAttribute("data-agent-preset-id", preset.id);
      button.setAttribute("aria-pressed", preset.id === state.selectedPresetId ? "true" : "false");
      button.appendChild(el("strong", "", preset.name));
      button.appendChild(el("span", "", preset.createdBy || preset.source));
      target.appendChild(button);
    });
  }

  function renderPresetDetail() {
    const detail = qs("#preset-detail");
    const nameInput = qs("#preset-agent-name");
    const instructionsInput = qs("#preset-agent-instructions");
    const summary = qs("#preset-config-summary");
    const status = qs("#preset-status");
    const feedback = qs("#preset-feedback");
    const preset = currentLibraryPreset();
    if (!detail || !preset) return;
    if (nameInput && document.activeElement !== nameInput) nameInput.value = preset.agent.name;
    if (instructionsInput && document.activeElement !== instructionsInput) instructionsInput.value = preset.agent.instructions;
    if (status) status.textContent = state.presetStatus;
    if (feedback) feedback.textContent = state.presetFeedback;
    if (!summary) return;
    clear(summary);
    const rows = [
      ["来源", preset.source === "team" ? `团队 · ${preset.createdBy}` : "插件"],
      ["目标类型", preset.target],
      ["角色", preset.role],
      ["模型", preset.agent.model || "运行时默认"],
      ["运行时", preset.agent.runtimeHint || "local-codex"],
      ["TTL", preset.permissions.ttl],
      ["风险", preset.permissions.riskLevel],
      ["Skills", preset.skills.map((skill) => skill.name).join(", ") || "无"],
      ["MCP", preset.mcpServers.map((server) => server.name).join(", ") || "无"],
      ["Env 路径", preset.environment.map((item) => `${item.key}: ${item.pathHint || "另行配置"}`).join("; ") || "无"]
    ];
    const definition = el("dl", "config-definition preset-definition");
    rows.forEach(([label, value]) => {
      definition.appendChild(el("dt", "", label));
      definition.appendChild(el("dd", "", value));
    });
    summary.appendChild(definition);
  }

  function renderAgentConfig() {
    const modal = qs("#agent-config-modal");
    const presetList = qs("#agent-config-presets");
    const preview = qs("#agent-config-preview");
    const status = qs("#agent-config-status");
    const feedback = qs("#agent-config-feedback");
    if (modal) modal.hidden = !state.agentConfigOpen;
    if (status) status.textContent = state.agentConfigStatus;
    if (feedback) feedback.textContent = state.agentConfigFeedback;
    const newPresetFeedback = qs("#new-preset-feedback");
    if (newPresetFeedback && !newPresetFeedback.textContent) {
      newPresetFeedback.textContent = "创建当前会话内的团队预制体，不写入 Multica metadata。";
    }

    if (presetList) {
      clear(presetList);
      mockData.agentPresets.forEach((preset) => {
        const item = el("button", "preset-option");
        item.type = "button";
        item.setAttribute("data-agent-preset", preset.id);
        item.setAttribute("aria-pressed", preset.id === state.agentPresetId ? "true" : "false");
        item.appendChild(el("strong", "", preset.name));
        item.appendChild(el("span", "", preset.summary));
        presetList.appendChild(item);
      });
    }

    if (!preview) return;
    clear(preview);
    const preset = currentAgentPreset();
    const rows = [
      ["Agent", preset.name],
      ["角色", preset.role],
      ["模型", preset.model],
      ["运行时", preset.runtime],
      ["权限模板", preset.permissionTemplate],
      ["TTL", preset.ttl]
    ];
    const definition = el("dl", "config-definition");
    rows.forEach(([label, value]) => {
      definition.appendChild(el("dt", "", label));
      definition.appendChild(el("dd", "", value));
    });
    preview.appendChild(definition);
    preview.appendChild(configList("Skills", preset.skills));
    preview.appendChild(configList("Scopes", preset.scopes));
    preview.appendChild(configList("Guardrails", preset.guardrails));
    preview.appendChild(renderCliPlan(preset));
  }

  function renderCliPlan(preset) {
    const section = el("section", "cli-plan-card");
    const header = el("div", "split-header");
    header.appendChild(el("h3", "", "真实 Multica CLI 计划"));
    header.appendChild(el("span", "config-status", "需要终端"));
    section.appendChild(header);
    section.appendChild(el("p", "cli-plan-note", "直接文件模式不能执行本地命令。通过 npm run gui 打开时，Image2 创建按钮会调用本地 server；下方命令保留为可复现的终端 fallback。"));

    const commands = [
      ["发现", mockData.cliConfig.discover],
      ["Dry-run", `node src/cli.js agent-config apply --preset ${preset.cliPreset} --output json`],
      ["保存计划", `node src/cli.js agent-config plan --preset ${preset.cliPreset} --plan-out ${mockData.cliConfig.planOut} --review-out ${mockData.cliConfig.reviewOut}`],
      ["执行", `node src/cli.js agent-config apply --preset ${preset.cliPreset} --execute --confirm ${preset.cliPreset === "image2" ? mockData.cliConfig.image2ConfirmationToken : mockData.cliConfig.confirmationToken} --output json`]
    ];

    const list = el("div", "cli-command-list");
    commands.forEach(([label, command]) => {
      const row = el("div", "cli-command-row");
      row.appendChild(el("span", "cli-command-label", label));
      row.appendChild(el("code", "", command));
      list.appendChild(row);
    });
    section.appendChild(list);
    if (preset.cliPreset === "image2") {
      const button = el("button", "primary-button create-image2-agent-button");
      button.type = "button";
      button.disabled = state.agentConfigStatus === "创建中";
      button.setAttribute("data-action", "create-image2-agent");
      button.appendChild(makeIcon("spark"));
      button.appendChild(el("span", "", state.agentConfigStatus === "创建中" ? "正在创建 Image2 Codex Agent" : "创建 Image2 Codex Agent"));
      section.appendChild(button);
    }
    section.appendChild(el("p", "cli-plan-warning", "custom_env 写入默认阻断；只有人工确认后才使用 --custom-env-file 或 --custom-env-stdin。"));
    return section;
  }

  function configList(title, items) {
    const section = el("section", "config-list");
    section.appendChild(el("h3", "", title));
    const list = el("ul", "");
    items.forEach((item) => list.appendChild(el("li", "", item)));
    section.appendChild(list);
    return section;
  }

  function renderPlaceholder() {
    const heading = qs("#placeholder-heading");
    const content = qs("#placeholder-content");
    if (!heading || !content) return;
    const labels = {
      "native-boundary": "Multica 原生边界"
    };
    heading.textContent = labels[state.activeView] || "插件占位";
    clear(content);
    content.appendChild(el("p", "panel-note", mockData.placeholderCopy[state.activeView] || "该区域是本地可视占位。"));
  }

  function setViewVisibility() {
    const activeId = viewIds[state.activeView] || "placeholder-view";
    qsa("[data-view]").forEach((node) => {
      node.hidden = node.id !== activeId;
    });
  }

  function appendRecord(title, detail) {
    state.records.push({
      time: new Date().toLocaleString(),
      title,
      detail
    });
    renderRecords();
  }

  function renderAll() {
    renderTopbar();
    renderGoal();
    renderPlan();
    renderPermissions();
    renderActivity();
    renderRecords();
    renderSettings();
    renderPlaceholder();
    renderPresetSidebar();
    renderPresetDetail();
    renderAgentConfig();
    setViewVisibility();
    setPressed();
  }

  function savePendingAssist(pending) {
    stopAssistSubscription();
    state.pendingAssist = pending;
    mockData.llmAssist.lastAssist = pending.assist || null;
    persistWorkflowDraft();
    subscribeToPendingAssist();
  }

  function clearPendingAssist() {
    stopAssistSubscription();
    state.pendingAssist = null;
    persistWorkflowDraft();
  }

  function resetIssueApplyState() {
    state.issueApplyConfirm = "";
    state.issueApplyStatus = "idle";
    state.issueApplyResult = null;
    state.issueApplyError = "";
  }

  function subscribeToPendingAssist() {
    const pending = state.pendingAssist;
    if (!pending?.issueId) return;
    stopAssistSubscription();
    state.goalPlanFeedback = `${pending.label || "Agent assist"} 正在运行；已订阅 Assist Issue ${pending.issueIdentifier || pending.issueId} 的收件箱结果。`;
    renderAll();

    const params = encodeQuery({
      kind: pending.kind,
      issueId: pending.issueId,
      assistRequestId: pending.assistRequestId || "",
      language: pending.language || state.language,
      intervalMs: "5000",
      timeoutMs: String(pending.timeoutMs || 300000)
    });
    const EventSourceCtor = window?.EventSource;
    if (typeof EventSourceCtor === "function") {
      const eventSource = new EventSourceCtor(`/api/assist/subscribe?${params}`);
      assistSubscription = { eventSource, timer: null };
      eventSource.addEventListener("pending", () => {
        state.goalPlanStatus = pending.kind === "goal" ? "澄清中" : "Agent 拆分中";
        state.goalPlanFeedback = `${pending.label || "Agent assist"} 仍在运行；正在实时订阅 ${pending.issueIdentifier || pending.issueId}。`;
        renderAll();
      });
      eventSource.addEventListener("completed", async () => {
        eventSource.close();
        assistSubscription = null;
        await pollAssistResultOnce(pending, { fromSubscription: true });
      });
      eventSource.addEventListener("blocked", (event) => {
        eventSource.close();
        assistSubscription = null;
        let payload = {};
        try {
          payload = JSON.parse(event.data || "{}");
        } catch {
          payload = { reason: "multica_agent_result_failed" };
        }
        handleAssistBlocked(pending, payload);
      });
      eventSource.onerror = () => {
        eventSource.close();
        assistSubscription = null;
        scheduleAssistPolling(pending, 0);
      };
      return;
    }

    scheduleAssistPolling(pending, 0);
  }

  function scheduleAssistPolling(pending, delayMs) {
    if (!pending?.issueId) return;
    const timer = setTimeout(async () => {
      await pollAssistResultOnce(pending);
    }, delayMs);
    assistSubscription = { eventSource: null, timer };
  }

  async function pollAssistResultOnce(pending, options = {}) {
    if (!pending?.issueId) return;
    try {
      const response = await fetch("/api/assist/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: pending.kind,
          issueId: pending.issueId,
          assistRequestId: pending.assistRequestId,
          agent: pending.agent,
          request: pending.request,
          context: pending.context,
          lockedGoal: pending.lockedGoal,
          availableAgents: pending.availableAgents || [{ id: mockData.agent, role: "planner" }],
          language: pending.language || state.language
        })
      });
      const payload = await response.json();
      if (!response.ok || (!payload.ok && !payload.pending)) {
        handleAssistBlocked(pending, payload);
        return;
      }
      if (payload.pending) {
        state.goalPlanStatus = pending.kind === "goal" ? "澄清中" : "Agent 拆分中";
        state.goalPlanFeedback = `${pending.label || "Agent assist"} 仍在运行；下一次刷新或订阅会继续读取同一个 Assist Issue ${pending.issueIdentifier || pending.issueId}。`;
        persistWorkflowDraft();
        renderAll();
        scheduleAssistPolling(pending, ASSIST_POLL_INTERVAL_MS);
        return;
      }
      completePendingAssist(pending, payload, options);
    } catch (error) {
      state.goalPlanStatus = "阻塞";
      state.goalPlanFeedback = `${pending.label || "Agent assist"} 订阅读取失败：${error.message || String(error)}。刷新页面后会继续订阅同一个 Assist Issue ${pending.issueIdentifier || pending.issueId}。`;
      persistWorkflowDraft();
      renderAll();
      scheduleAssistPolling(pending, ASSIST_POLL_INTERVAL_MS);
    }
  }

  function completePendingAssist(pending, payload) {
    if (pending.kind === "goal" && payload.goal) {
      state.normalizedGoal = payload.goal;
      state.lockedGoal = null;
      state.generatedPlan = null;
      state.planSet = null;
      state.issueSplit = null;
      resetIssueApplyState();
      mockData.llmAssist.lastAssist = payload.assist || payload.goal.assist || pending.assist || null;
      state.goalPlanStatus = payload.goal.status === "draft" ? "需要澄清" : "已澄清";
      state.goalPlanFeedback = payload.goal.status === "draft"
        ? `Agent 已返回目标草稿；Assist Issue：${pending.issueIdentifier || pending.issueId}。`
        : `${payload.goal.title} 已可锁定；结果来自 Assist Issue ${pending.issueIdentifier || pending.issueId}。`;
      appendRecord("目标已从 Assist Issue 恢复", `${payload.goal.title}；结果来源：${payload.diagnostic?.outputSource || "unknown"}。`);
    }
    if (pending.kind === "planSet" && payload.planSet) {
      state.planSet = payload.planSet;
      state.generatedPlan = null;
      state.issueSplit = null;
      resetIssueApplyState();
      mockData.llmAssist.lastAssist = payload.assist || payload.planSet.assist || pending.assist || null;
      state.goalPlanStatus = "已拆分";
      state.goalPlanFeedback = `Multica Agent 已拆分为 ${payload.planSet.plans.length} 个并行 Plan；结果来自 Assist Issue ${pending.issueIdentifier || pending.issueId}。`;
      appendRecord("Agent 辅助拆分已从 Assist Issue 恢复", `${payload.planSet.plans.length} 个并行 Plan；结果来源：${payload.diagnostic?.outputSource || "unknown"}。`);
    }
    clearPendingAssist();
    persistWorkflowDraft();
    renderAll();
  }

  function handleAssistBlocked(pending, payload = {}) {
    state.goalPlanStatus = "阻塞";
    state.goalPlanFeedback = `${formatLlmFailure(payload)} Assist Issue：${pending.issueIdentifier || pending.issueId}。`;
    appendRecord("Agent assist 结果读取阻塞", state.goalPlanFeedback);
    clearPendingAssist();
    renderAll();
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav-target]");
      const action = event.target.closest("[data-action]");
      const planFilter = event.target.closest("[data-plan-filter]");
      const preset = event.target.closest("[data-agent-preset]");
      const libraryPreset = event.target.closest("[data-agent-preset-id]");
      const languageOption = event.target.closest("[data-language-option]");

      if (planFilter) {
        state.planFilter = planFilter.getAttribute("data-plan-filter") || "all";
        renderAll();
        return;
      }

      if (languageOption) {
        const languageId = languageOption.getAttribute("data-language-option") || "zh-CN";
        const option = mockData.languageOptions.find((item) => item.id === languageId);
        if (option?.reserved) {
          appendRecord("语言切换入口已预留", `${option.label} 文案包尚未接入，当前继续使用中文界面。`);
          renderAll();
          return;
        }
        state.language = languageId;
        appendRecord("界面语言已确认", "当前插件界面语言为中文。");
        persistWorkflowDraft();
        renderAll();
        return;
      }

      if (libraryPreset) {
        state.selectedPresetId = libraryPreset.getAttribute("data-agent-preset-id") || state.selectedPresetId;
        state.agentConfigOpen = true;
        state.presetStatus = "草稿";
        state.presetFeedback = `已选择 ${currentLibraryPreset().name}。可编辑默认值后预览或创建。`;
        renderAll();
        return;
      }

      if (preset) {
        state.agentPresetId = preset.getAttribute("data-agent-preset") || state.agentPresetId;
        state.agentConfigStatus = "草稿";
        state.agentConfigFeedback = `已选择 ${currentAgentPreset().name} 用于本地预览。`;
        renderAll();
        return;
      }

      if (nav) {
        state.activeView = nav.getAttribute("data-nav-target") || "project";
        renderAll();
        return;
      }

      if (!action) return;
      const kind = action.getAttribute("data-action");
      const template = currentTemplate();
      if (kind === "open-permissions") {
        state.activeView = "permissions";
        renderAll();
      } else if (kind === "open-agent-config") {
        state.agentConfigOpen = true;
        state.agentConfigStatus = "草稿";
        state.agentConfigFeedback = "选择预制体后可先本地预览，或在终端运行真实 CLI 计划。";
        renderAll();
      } else if (kind === "close-agent-config") {
        state.agentConfigOpen = false;
        renderAll();
      } else if (kind === "preview-agent-config") {
        const preset = currentAgentPreset();
        state.agentConfigStatus = "已预览";
        state.agentConfigFeedback = `${preset.name} 预览已生成。真实 CLI dry-run 请使用不带 --execute 的 agent-config apply。`;
        appendRecord("Agent 配置已预览", `${preset.name} 使用 CLI preset ${preset.cliPreset}。浏览器预览未更改 Multica。`);
        renderAll();
      } else if (kind === "create-image2-agent") {
        createImage2Agent();
      } else if (kind === "diagnose-llm") {
        diagnoseLlmProviderFromSettings();
      } else if (kind === "read-llm-secret-metadata") {
        readLlmSecretMetadataFromSettings();
      } else if (kind === "clarify-goal") {
        clarifyGoal();
      } else if (kind === "lock-goal") {
        lockGoal();
      } else if (kind === "preview-issue-split") {
        previewIssueSplit();
      } else if (kind === "apply-issue-split") {
        applyIssueSplit();
      } else if (kind === "split-plan-llm") {
        splitPlanWithLlm();
      } else if (kind === "preview-selected-preset") {
        previewSelectedPreset();
      } else if (kind === "create-selected-preset-agent") {
        createSelectedPresetAgent();
      } else if (kind === "create-team-preset") {
        createTeamPreset();
      } else if (kind === "apply-agent-config") {
        const preset = currentAgentPreset();
        state.agentConfigStatus = "已本地应用";
        state.agentConfigFeedback = `${preset.name} mock 配置已应用到页面。真实 Multica apply 需要终端确认 token。`;
        mockData.agent = preset.name;
        mockData.runtime = preset.runtime;
        const matchingTemplate = mockData.templates.find((template) => template.name === preset.permissionTemplate);
        if (matchingTemplate) {
          state.templateId = matchingTemplate.id;
          state.ttl = matchingTemplate.ttl;
        }
        appendRecord("Agent mock 配置已应用", `${preset.name} 已在页面本地应用。配置 Multica 需要运行 CLI 执行命令。`);
        renderAll();
      } else if (kind === "preview-permission") {
        appendRecord("权限预览已生成", `${template.name}，TTL ${state.ttl}，仅本地预览。`);
      } else if (kind === "apply-permission") {
        appendRecord("Mock 应用已记录", `${template.name} 已记录到本地页面，没有改变权限边界。`);
      } else if (kind === "resume-goal") {
        appendRecord("目标继续请求已记录", "继续动作只记录在本地页面内。");
      } else if (kind === "view-goal-history") {
        state.activeView = "records";
        renderAll();
      } else if (kind === "edit-scopes") {
        appendRecord("Scope 编辑已打开", "Scope 编辑当前表现为本地 mock 事件。");
      }
    });

    document.addEventListener("input", (event) => {
      const preset = currentLibraryPreset();
      if (!preset) return;
      if (event.target.matches("#preset-agent-name")) {
        preset.agent.name = event.target.value;
      }
      if (event.target.matches("#preset-agent-instructions")) {
        preset.agent.instructions = event.target.value;
      }
      if (event.target.matches("#goal-request-input")) {
        state.goalRequest = event.target.value;
        persistWorkflowDraft();
      }
      if (event.target.matches("#llm-custom-command")) {
        mockData.llmAssist.customCommand = event.target.value;
      }
      if (event.target.matches("#llm-custom-model")) {
        mockData.llmAssist.model = event.target.value;
      }
      if (event.target.matches("#llm-timeout-ms")) {
        mockData.llmAssist.timeoutMs = Number(event.target.value || 300000);
      }
      if (event.target.matches("#assist-selection-mode")) {
        mockData.llmAssist.agentSelectionMode = event.target.value;
      }
      if (event.target.matches("#assist-agent-id")) {
        mockData.llmAssist.selectedAgentId = event.target.value;
      }
      if (event.target.matches("#llm-secret-confirm")) {
        mockData.llmAssist.secretMetadataConfirm = event.target.value;
      }
      if (event.target.matches("#issue-split-confirm")) {
        state.issueApplyConfirm = event.target.value;
        persistWorkflowDraft();
      }
    });

    document.addEventListener("change", (event) => {
      if (event.target.matches("[data-permission-template]")) {
        state.templateId = event.target.value;
        state.ttl = currentTemplate().ttl;
        renderAll();
      }
      if (event.target.matches("[data-permission-ttl]")) {
        state.ttl = event.target.value;
        renderAll();
      }
      if (event.target.matches("[data-goal-plan-complexity]")) {
        state.goalPlanComplexity = event.target.value;
        persistWorkflowDraft();
        renderAll();
      }
    });
  }

  async function clarifyGoal() {
    if (state.goalPlanStatus === "澄清中") return;
    state.goalPlanStatus = "澄清中";
    state.goalPlanFeedback = "正在通过 Multica Agent 创建 assist issue/task 并归一化目标...";
    renderAll();
    try {
      const assistConfig = {
        ...currentAssistConfig(),
        chainId: assistChainId("goal", state.goalRequest),
        requestId: nextAssistRequestId("goal")
      };
      const response = await fetch("/api/goal/normalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request: state.goalRequest,
          mode: "agent",
          async: true,
          assist: assistConfig,
          language: state.language,
          context: {
            project: mockData.project,
            owner: "Codex monitoring session",
            source: "gui",
            language: state.language
          }
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(formatLlmFailure(payload));
      if (payload.pending) {
        const assist = payload.assist || {};
        const pending = {
          kind: "goal",
          label: "目标澄清",
          issueId: assist.issue?.id,
          issueIdentifier: assist.issue?.identifier,
          agent: assist.agent,
          assist,
          timeoutMs: assistConfig.timeoutMs,
          request: state.goalRequest,
          context: {
            project: mockData.project,
            owner: "Codex monitoring session",
            source: "gui",
            language: state.language
          },
          language: state.language,
          assistChainId: payload.assistChainId || assistConfig.chainId,
          assistRequestId: payload.assistRequestId || assistConfig.requestId
        };
        state.goalPlanStatus = "澄清中";
        state.goalPlanFeedback = `已创建并订阅 Assist Issue ${pending.issueIdentifier || pending.issueId}，等待 Agent 写入目标 JSON。`;
        savePendingAssist(pending);
        appendRecord("目标澄清 Assist Issue 已订阅", `正在订阅 ${pending.issueIdentifier || pending.issueId} 的收件箱结果。`);
        renderAll();
        return;
      }
      state.normalizedGoal = payload.goal;
      state.lockedGoal = null;
      state.generatedPlan = null;
      state.planSet = null;
      state.issueSplit = null;
      resetIssueApplyState();
      mockData.llmAssist.lastAssist = payload.assist || payload.goal.assist || null;
      state.goalPlanStatus = payload.goal.status === "draft" ? "需要澄清" : "已澄清";
      state.goalPlanFeedback = payload.goal.status === "draft"
        ? "目标仍为草稿。请先回答待澄清问题，再锁定。"
        : `${payload.goal.title} 已可锁定。Assist Issue：${payload.goal.assist?.issue?.identifier || payload.goal.assist?.issue?.id || "已创建"}。`;
      persistWorkflowDraft();
      appendRecord("目标已澄清", `${payload.goal.title}（${goalStatusLabel(payload.goal.status)}）；通过 Multica Agent assist issue/task 生成。`);
      renderAll();
    } catch (error) {
      state.goalPlanStatus = "失败";
      state.goalPlanFeedback = error.message || String(error);
      appendRecord("目标澄清失败", state.goalPlanFeedback);
      renderAll();
    }
  }

  async function lockGoal() {
    if (!state.normalizedGoal || state.goalPlanStatus === "锁定中") return;
    state.goalPlanStatus = "锁定中";
    state.goalPlanFeedback = "正在基于本地人工确认锁定目标...";
    renderAll();
    try {
      const response = await fetch("/api/goal/lock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: state.normalizedGoal,
          approvedBy: "gui-human"
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Goal lock failed.");
      state.lockedGoal = payload.goal;
      state.generatedPlan = null;
      state.planSet = null;
      state.issueSplit = null;
      state.goalPlanStatus = "已锁定";
      state.goalPlanFeedback = `${payload.goal.title} 已锁定，现在可以预览计划。`;
      persistWorkflowDraft();
      appendRecord("目标已锁定", `${payload.goal.id} 已由 ${payload.goal.approvedBy} 确认。`);
      renderAll();
    } catch (error) {
      state.goalPlanStatus = "失败";
      state.goalPlanFeedback = error.message || String(error);
      appendRecord("目标锁定失败", state.goalPlanFeedback);
      renderAll();
    }
  }

  async function previewIssueSplit() {
    if (!state.lockedGoal || state.goalPlanStatus === "预览中") return;
    state.goalPlanStatus = "预览中";
    state.goalPlanFeedback = state.planSet
      ? "正在从并行 Plan 预览业务 Multica Issue..."
      : "正在生成计划和 Multica issue 拆分预览...";
    renderAll();
    try {
      let previewBody;
      if (state.planSet?.plans?.length) {
        state.generatedPlan = null;
        previewBody = {
          goal: state.lockedGoal,
          planSet: state.planSet,
          language: state.language
        };
      } else {
        const planResponse = await fetch("/api/plan/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            goal: state.lockedGoal,
            complexity: state.goalPlanComplexity,
            language: state.language,
            availableAgents: [
              { id: mockData.agent, role: "planner" }
            ]
          })
        });
        const planPayload = await planResponse.json();
        if (!planResponse.ok || !planPayload.ok) throw new Error(planPayload.error || "Plan generation failed.");
        state.generatedPlan = planPayload.plan;
        state.planSet = null;
        previewBody = {
          goal: state.lockedGoal,
          plan: state.generatedPlan,
          language: state.language
        };
      }

      const splitResponse = await fetch("/api/plan/preview-issues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(previewBody)
      });
      const splitPayload = await splitResponse.json();
      if (!splitResponse.ok || !splitPayload.ok) throw new Error(splitPayload.error || "Issue split preview failed.");
      state.issueSplit = splitPayload.issueSplit;
      resetIssueApplyState();
      state.goalPlanStatus = "已预览";
      state.goalPlanFeedback = state.issueSplit.summary;
      persistWorkflowDraft();
      appendRecord("Issue 拆分已预览", `${state.issueSplit.mode} · ${state.issueSplit.issues.length} 个 issue 候选。`);
      renderAll();
    } catch (error) {
      state.goalPlanStatus = "失败";
      state.goalPlanFeedback = error.message || String(error);
      appendRecord("Issue 拆分预览失败", state.goalPlanFeedback);
      renderAll();
    }
  }

  async function applyIssueSplit() {
    if (!state.issueSplit || state.issueApplyStatus === "creating") return;
    const token = state.issueSplit.confirmationToken || "APPLY-MULTICA-ISSUE-SPLIT";
    const confirmInputValue = qs("#issue-split-confirm")?.value ?? state.issueApplyConfirm;
    state.issueApplyConfirm = confirmInputValue;
    if (state.issueSplit.confirmationRequired && confirmInputValue !== token) {
      state.issueApplyStatus = "blocked";
      state.issueApplyError = `必须输入 ${token}`;
      persistWorkflowDraft();
      renderAll();
      return;
    }

    state.issueApplyStatus = "creating";
    state.issueApplyError = "";
    state.goalPlanFeedback = "正在创建真实业务 Multica Issue...";
    renderAll();
    try {
      const response = await fetch("/api/plan/apply-issues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          issueSplit: state.issueSplit,
          execute: true,
          confirm: confirmInputValue
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.result?.ok) {
        throw new Error(payload.error || payload.result?.error || "Issue create failed.");
      }
      state.issueApplyStatus = "created";
      state.issueApplyResult = payload.result;
      state.issueApplyError = "";
      state.goalPlanStatus = "Issue 已创建";
      state.goalPlanFeedback = `已创建 ${payload.result.createdIssues?.length || 0} 个业务 Multica Issue。`;
      persistWorkflowDraft();
      appendRecord("业务 Issue 已创建", `${payload.result.createdIssues?.map((issue) => issue.identifier || issue.id).filter(Boolean).join(", ") || "无返回 id"}。`);
      renderAll();
    } catch (error) {
      state.issueApplyStatus = "failed";
      state.issueApplyError = error.message || String(error);
      state.goalPlanStatus = "失败";
      state.goalPlanFeedback = state.issueApplyError;
      appendRecord("业务 Issue 创建失败", state.issueApplyError);
      persistWorkflowDraft();
      renderAll();
    }
  }

  async function splitPlanWithLlm() {
    if (!state.lockedGoal || state.goalPlanStatus === "Agent 拆分中") return;
    state.goalPlanStatus = "Agent 拆分中";
    state.goalPlanFeedback = "正在检测 Multica Agent，并创建 assist issue/task 进行计划拆分...";
    renderAll();
    try {
      const providerResponse = await fetch("/api/assist/agents");
      const providerPayload = await providerResponse.json();
      state.llmProviders = providerPayload;
      mockData.llmAssist.agents = providerPayload.agents || [];
      if (!providerResponse.ok || providerPayload.status !== "available" || !providerPayload.selectedAgent) {
        mockData.llmAssist.providerStatus = "未发现";
        mockData.llmAssist.providerSummary = "未发现可用 Multica Agent，请检查 daemon、runtime 或 Agent 配置。";
        state.goalPlanStatus = "阻塞";
        state.goalPlanFeedback = mockData.llmAssist.providerSummary;
        appendRecord("Agent 拆分已阻塞", state.goalPlanFeedback);
        renderAll();
        return;
      }
      mockData.llmAssist.providerStatus = "已发现";
      mockData.llmAssist.providerSummary = `${providerPayload.selectedAgent.name || providerPayload.selectedAgent.id} · ${providerPayload.selectedAgent.model || "runtime default"}`;
      const assistConfig = {
        ...currentAssistConfig(),
        chainId: assistChainId("planSet", state.lockedGoal?.id || state.lockedGoal?.objective || state.lockedGoal?.title),
        requestId: nextAssistRequestId("planSet")
      };

      const splitResponse = await fetch("/api/plan/split", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: state.lockedGoal,
          mode: "agent",
          async: true,
          assist: assistConfig,
          language: state.language,
          availableAgents: [
            { id: mockData.agent, role: "planner" }
          ]
        })
      });
      const splitPayload = await splitResponse.json();
      if (!splitResponse.ok || !splitPayload.ok) {
        throw new Error(formatLlmFailure(splitPayload));
      }
      if (splitPayload.pending) {
        const assist = splitPayload.assist || {};
        const pending = {
          kind: "planSet",
          label: "Plan 拆分",
          issueId: assist.issue?.id,
          issueIdentifier: assist.issue?.identifier,
          agent: assist.agent,
          assist,
          timeoutMs: assistConfig.timeoutMs,
          lockedGoal: state.lockedGoal,
          availableAgents: [{ id: mockData.agent, role: "planner" }],
          language: state.language,
          assistChainId: splitPayload.assistChainId || assistConfig.chainId,
          assistRequestId: splitPayload.assistRequestId || assistConfig.requestId
        };
        state.goalPlanStatus = "Agent 拆分中";
        state.goalPlanFeedback = `已创建并订阅 Assist Issue ${pending.issueIdentifier || pending.issueId}，等待 Agent 写入 PlanSet JSON。`;
        savePendingAssist(pending);
        appendRecord("Plan 拆分 Assist Issue 已订阅", `正在订阅 ${pending.issueIdentifier || pending.issueId} 的收件箱结果。`);
        renderAll();
        return;
      }
      state.planSet = splitPayload.planSet;
      state.generatedPlan = null;
      state.issueSplit = null;
      resetIssueApplyState();
      state.goalPlanStatus = "已拆分";
      mockData.llmAssist.lastAssist = splitPayload.assist || state.planSet.assist || null;
      state.goalPlanFeedback = `Multica Agent 已拆分为 ${state.planSet.plans.length} 个并行 Plan。Assist Issue：${state.planSet.assist?.issue?.identifier || state.planSet.assist?.issue?.id || "已创建"}。`;
      persistWorkflowDraft();
      appendRecord("Agent 辅助拆分已完成", `${state.planSet.assist?.agent?.name || "Multica Agent"} · ${state.planSet.plans.length} 个并行 Plan。`);
      renderAll();
    } catch (error) {
      state.goalPlanStatus = "失败";
      state.goalPlanFeedback = error.message || String(error);
      appendRecord("Agent 辅助拆分失败", state.goalPlanFeedback);
      renderAll();
    }
  }

  async function diagnoseLlmProviderFromSettings() {
    readLlmSettingsFromInputs();
    mockData.llmAssist.providerStatus = "检测中";
    mockData.llmAssist.providerSummary = "正在检查 Multica daemon、runtime 和 Agent 可用性。";
    renderAll();
    try {
      const response = await fetch("/api/assist/diagnose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = await response.json();
      mockData.llmAssist.agents = payload.agents || [];
      if (!response.ok || !payload.ok) {
        mockData.llmAssist.providerStatus = "不可用";
        mockData.llmAssist.providerSummary = formatLlmFailure(payload);
        appendRecord("Agent 检测失败", mockData.llmAssist.providerSummary);
        renderAll();
        return;
      }
      mockData.llmAssist.providerStatus = "可用";
      mockData.llmAssist.providerSummary = `${payload.selectedAgent?.name || "Multica Agent"} · ${payload.selectedAgent?.model || "runtime default"}；点击 Agent 辅助会创建真实 assist issue/task。`;
      appendRecord("Agent 检测通过", mockData.llmAssist.providerSummary);
      renderAll();
    } catch (error) {
      mockData.llmAssist.providerStatus = "失败";
      mockData.llmAssist.providerSummary = error.message || String(error);
      appendRecord("Agent 检测失败", mockData.llmAssist.providerSummary);
      renderAll();
    }
  }

  async function readLlmSecretMetadataFromSettings() {
    readLlmSettingsFromInputs();
    const confirmInput = qs("#llm-secret-confirm");
    if (confirmInput) mockData.llmAssist.secretMetadataConfirm = confirmInput.value.trim();
    mockData.llmAssist.secretMetadataStatus = "读取中";
    mockData.llmAssist.secretMetadataSummary = "正在读取本地 LLM 密钥摘要；不会展示或记录明文密钥。";
    renderAll();
    try {
      const response = await fetch("/api/llm/secret-metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: mockData.llmAssist.secretMetadataConfirm,
          llm: currentLlmConfig()
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        mockData.llmAssist.secretMetadataStatus = "阻塞";
        mockData.llmAssist.secretMetadataSummary = formatLlmFailure(payload);
        mockData.llmAssist.secretMetadata = null;
        appendRecord("LLM 密钥摘要读取阻塞", mockData.llmAssist.secretMetadataSummary);
        renderAll();
        return;
      }
      mockData.llmAssist.secretMetadataStatus = "已读取";
      mockData.llmAssist.secretMetadata = sanitizeSecretMetadata(payload.metadata || payload.secretMetadata || payload);
      mockData.llmAssist.secretMetadataSummary = "已读取脱敏密钥摘要；未展示 raw secret。";
      appendRecord("LLM 密钥摘要已读取", "已展示 provider、path hint、key name、present、fingerprint、lengthRange、formatHint 等脱敏字段。");
      renderAll();
    } catch (error) {
      mockData.llmAssist.secretMetadataStatus = "失败";
      mockData.llmAssist.secretMetadataSummary = error.message || String(error);
      mockData.llmAssist.secretMetadata = null;
      appendRecord("LLM 密钥摘要读取失败", mockData.llmAssist.secretMetadataSummary);
      renderAll();
    }
  }

  function readLlmSettingsFromInputs() {
    const commandInput = qs("#llm-custom-command");
    const modelInput = qs("#llm-custom-model");
    const timeoutInput = qs("#llm-timeout-ms");
    const modeInput = qs("#assist-selection-mode");
    const agentInput = qs("#assist-agent-id");
    if (commandInput) mockData.llmAssist.customCommand = commandInput.value.trim();
    if (modelInput) mockData.llmAssist.model = modelInput.value.trim();
    if (timeoutInput) {
      const timeout = Number(timeoutInput.value);
      if (Number.isFinite(timeout) && timeout > 0) mockData.llmAssist.timeoutMs = timeout;
    }
    if (modeInput) mockData.llmAssist.agentSelectionMode = modeInput.value;
    if (agentInput) mockData.llmAssist.selectedAgentId = agentInput.value;
  }

  function currentAssistConfig() {
    readLlmSettingsFromInputs();
    return {
      agentId: mockData.llmAssist.selectedAgentId,
      selectionMode: mockData.llmAssist.agentSelectionMode || (mockData.llmAssist.selectedAgentId ? "manual" : "auto"),
      timeoutMs: mockData.llmAssist.timeoutMs
    };
  }

  function currentLlmConfig() {
    readLlmSettingsFromInputs();
    return {
      provider: inferLlmProvider(mockData.llmAssist.customCommand),
      command: mockData.llmAssist.customCommand,
      model: mockData.llmAssist.model,
      timeoutMs: mockData.llmAssist.timeoutMs
    };
  }

  function sanitizeSecretMetadata(metadata = {}) {
    const entry = Array.isArray(metadata)
      ? (metadata.find((item) => item && item.present) || metadata[0] || {})
      : metadata;
    const allowed = {};
    [
      "provider",
      "pathHint",
      "sourcePathHint",
      "keyName",
      "present",
      "fingerprint",
      "lengthRange",
      "formatHint"
    ].forEach((key) => {
      if (entry[key] !== undefined && entry[key] !== null) allowed[key] = entry[key];
    });
    if (!allowed.pathHint && allowed.sourcePathHint) {
      allowed.pathHint = allowed.sourcePathHint;
      delete allowed.sourcePathHint;
    }
    return allowed;
  }

  function renderSecretMetadataSummary() {
    const metadata = mockData.llmAssist.secretMetadata;
    const section = el("section", "secret-metadata-result");
    if (!metadata || Object.keys(metadata).length === 0) {
      section.appendChild(el("p", "setting-help", "尚未读取密钥摘要。"));
      return section;
    }
    const rows = [
      ["provider", metadata.provider],
      ["path hint", metadata.pathHint],
      ["key name", metadata.keyName],
      ["present", metadata.present === undefined ? undefined : String(metadata.present)],
      ["fingerprint", metadata.fingerprint],
      ["lengthRange", metadata.lengthRange],
      ["formatHint", metadata.formatHint]
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const definition = el("dl", "config-definition secret-metadata-definition");
    rows.forEach(([label, value]) => {
      definition.appendChild(el("dt", "", label));
      definition.appendChild(el("dd", "", String(value)));
    });
    section.appendChild(definition);
    return section;
  }

  function renderAssistAgentList() {
    const section = el("section", "assist-agent-list");
    const agents = mockData.llmAssist.agents || [];
    if (!agents.length) {
      section.appendChild(el("p", "setting-help", "尚未检测 Multica Agent。点击“检测 Agent”读取本机 daemon/runtime/agent 元数据。"));
      return section;
    }
    const list = el("ul", "record-list");
    agents.slice(0, 6).forEach((agent) => {
      const label = `${agent.name || agent.id} · ${agent.status || "unknown"} · ${agent.runtimeStatus || "runtime"} · ${agent.model || "model default"}`;
      list.appendChild(el("li", "record-item", label));
    });
    section.appendChild(list);
    return section;
  }

  function llmProviderUrl() {
    const params = [];
    const config = currentLlmConfig();
    if (config.provider) params.push(`provider=${encodeURIComponent(config.provider)}`);
    if (config.command) params.push(`command=${encodeURIComponent(config.command)}`);
    if (config.model) params.push(`model=${encodeURIComponent(config.model)}`);
    if (config.timeoutMs && config.timeoutMs !== 300000) params.push(`timeoutMs=${encodeURIComponent(String(config.timeoutMs))}`);
    const query = params.join("&");
    return query ? `/api/llm/providers?${query}` : "/api/llm/providers";
  }

  function inferLlmProvider(command) {
    const text = String(command || "").toLowerCase();
    if (text.includes("claude")) return "claude";
    if (text.includes("codex")) return "codex";
    return "";
  }

  function formatLlmFailure(payload = {}) {
    const reason = payload.reason || payload.error || "llm_unknown_exit";
    const messages = {
      no_assist_agent: "未发现可用 Multica Agent：请先在 Multica 中创建或恢复 Agent。",
      assist_agent_required: "当前为手动选择模式，请先选择一个 Multica Agent。",
      assist_agent_not_found: "所选 Multica Agent 不存在或已不可用，请重新检测 Agent。",
      multica_cli_not_found: "Multica CLI 不可用：请确认 multica 已安装并在 PATH 中，或从本地 GUI server 指定 cliPath。",
      multica_cli_failed: "Multica CLI 调用失败：请检查 daemon、workspace 和 CLI 输出。",
      multica_issue_duplicate_blocked: "Multica 拦截了重复 assist issue：请关闭已有 assist issue，或升级到允许重复创建的本地 GUI server。",
      multica_api_network_failed: "Multica API 网络连接失败：daemon 正在运行，但 CLI 访问 api.multica.ai 时失败。请检查网络、代理、TLS/DNS 或稍后重试。",
      multica_auth_required: "Multica CLI 需要认证：请先完成 Multica 登录或检查本机 daemon 权限。",
      multica_daemon_unavailable: "Multica daemon 不可用：请先运行或重启 multica daemon。",
      multica_agent_timeout: "Multica Agent assist task 超时：默认等待 5 分钟。请在 Multica 中查看 assist issue/run 状态，或在设置中继续增大运行超时。",
      multica_agent_run_failed: "Multica Agent 运行失败：请打开 assist issue 查看 run 错误。",
      multica_agent_run_cancelled: "Multica Agent 运行已取消：请重新触发或选择其他 Agent。",
      multica_agent_output_missing: "Multica Agent 已完成但没有可解析输出：请要求 Agent 只返回 JSON。",
      multica_agent_non_json_output: "Multica Agent 输出不是 JSON：请重试或切换 Agent。",
      multica_agent_invalid_json: "Multica Agent 输出 JSON 缺少所需字段：请重试或切换 Agent。",
      no_llm_provider: "未发现可用 Codex/Claude CLI，请在设置中配置或安装本机 Agent。",
      llm_command_not_found: "LLM 命令不可用：请确认 Codex/Claude CLI 已安装并在 PATH 中，或在设置里填写完整命令路径。",
      llm_unsupported_flags: "LLM CLI 不支持当前调用参数：请升级 Codex/Claude CLI，或切换到另一个 provider。",
      llm_codex_plugin_auth_required: "Codex 远端插件目录同步需要 ChatGPT 登录；Multica++ 会尝试隔离用户配置并保留 base_url/model 设置。若仍失败，请在 Codex App 登录或暂时禁用远端插件同步。",
      llm_auth_required: "LLM CLI 需要登录：请先在终端完成 Codex/Claude 登录认证，再重试。",
      llm_auth_failed: "LLM CLI 认证失败：请检查本机 Agent 登录状态、权限或模型访问。",
      llm_model_unavailable: "当前模型不可用：请在设置中清空模型名使用默认模型，或填写已授权模型。",
      llm_network_failed: "LLM CLI 网络失败：请检查代理、TLS、DNS 或外网连接。",
      llm_timeout: "LLM CLI 调用超时：请增大超时，或先用设置里的 provider 测试确认可用。",
      llm_provider_config_failed: "LLM provider 配置不可用：请检查本机 Agent 配置 profile。",
      llm_schema_not_supported: "LLM CLI 不支持结构化输出参数：请升级 CLI 或切换 provider。",
      llm_output_missing: "LLM 已运行但没有生成最终输出文件：请用设置里的 provider 测试查看诊断。",
      llm_non_json_stdout: "LLM 输出不是 JSON：请重试或切换 provider。",
      llm_invalid_json_shape: "LLM 输出 JSON 缺少 Plan 字段：请重试或切换 provider。",
      llm_unknown_exit: "LLM CLI 调用失败：请在设置里测试 provider 查看退出码和错误摘要。"
    };
    const base = messages[reason] || String(reason);
    const detail = payload.diagnostic?.result?.stderrExcerpt
      || payload.diagnostic?.create?.stderrExcerpt
      || payload.diagnostic?.poll?.stderrExcerpt
      || payload.diagnostic?.poll?.lastRunsResult?.stderrExcerpt
      || payload.diagnostic?.invocation?.result?.stderrExcerpt
      || payload.diagnostic?.help?.stderrExcerpt
      || "";
    return detail ? `${base} 错误摘要：${detail}` : base;
  }

  async function createImage2Agent() {
    const preset = currentAgentPreset();
    if (state.agentConfigStatus === "创建中") {
      return;
    }
    if (preset.cliPreset !== "image2") {
      state.agentConfigStatus = "阻塞";
      state.agentConfigFeedback = "创建真实 Image2 agent 前，请先选择 Image2 Codex Agent 预制体。";
      renderAll();
      return;
    }

    state.agentConfigStatus = "创建中";
    state.agentConfigFeedback = "正在调用本地 GUI server 创建或更新 Multica Image2 Codex Agent...";
    renderAll();

    try {
      const response = await fetch("/api/agent-config/image2/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: mockData.cliConfig.image2ConfirmationToken })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || payload.result?.error || "Image2 agent creation failed.");
      }

      const agentId = payload.result?.targetAgentId || "";
      const skillId = payload.result?.skillIds?.paigodImagegen || "";
      mockData.agent = "Multica++ Image2 Codex Agent";
      mockData.runtime = "local-codex";
      state.agentConfigStatus = "已在 Multica 创建";
      state.agentConfigFeedback = `已创建或更新 Image2 Codex Agent（${agentId}），并绑定 paigod-imagegen skill（${skillId}）。`;
      appendRecord("Image2 Codex Agent 已创建", `Multica agent ${agentId || "unknown"} 已绑定 skill ${skillId || "unknown"}。`);
      renderAll();
    } catch (error) {
      state.agentConfigStatus = "失败";
      state.agentConfigFeedback = error.message || String(error);
      appendRecord("Image2 Codex Agent 创建失败", state.agentConfigFeedback);
      renderAll();
    }
  }

  function selectedPresetOverrides() {
    return {
      agent: {
        name: qs("#preset-agent-name")?.value || currentLibraryPreset().agent.name,
        instructions: qs("#preset-agent-instructions")?.value || currentLibraryPreset().agent.instructions
      }
    };
  }

  async function previewSelectedPreset() {
    const preset = currentLibraryPreset();
    state.presetStatus = "预览中";
    state.presetFeedback = `正在为 ${preset.name} 生成预览计划...`;
    renderAll();
    try {
      const response = await fetch(`/api/agent-presets/${encodeURIComponent(preset.id)}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overrides: selectedPresetOverrides() })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Preset preview failed.");
      state.presetStatus = "已预览";
      state.presetFeedback = `${payload.plan?.target?.name || preset.agent.name} 预览已就绪。不支持的 MCP/env 写入仍保持阻断。`;
      appendRecord("预制体计划已预览", `${preset.name} 已生成 dry-run 计划。`);
      renderAll();
    } catch (error) {
      state.presetStatus = "失败";
      state.presetFeedback = error.message || String(error);
      renderAll();
    }
  }

  async function createSelectedPresetAgent() {
    const preset = currentLibraryPreset();
    if (state.presetStatus === "创建中") return;
    state.presetStatus = "创建中";
    state.presetFeedback = `正在从 ${preset.name} 创建 Multica Agent...`;
    renderAll();
    try {
      const response = await fetch(`/api/agent-presets/${encodeURIComponent(preset.id)}/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: mockData.cliConfig.presetConfirmationToken,
          overrides: selectedPresetOverrides()
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || payload.result?.error || "Preset agent creation failed.");
      const agentId = payload.result?.targetAgentId || "";
      mockData.agent = qs("#preset-agent-name")?.value || preset.agent.name;
      mockData.runtime = preset.agent.runtimeHint || "local-codex";
      state.presetStatus = "已在 Multica 创建";
      state.presetFeedback = `已从预制体创建 Multica Agent（${agentId || "unknown"}）。`;
      appendRecord("预制体 Agent 已创建", `${preset.name} 创建了 Multica agent ${agentId || "unknown"}。`);
      renderAll();
    } catch (error) {
      state.presetStatus = "失败";
      state.presetFeedback = error.message || String(error);
      appendRecord("预制体 Agent 创建失败", state.presetFeedback);
      renderAll();
    }
  }

  async function loadPresetLibrary() {
    try {
      const response = await fetch("/api/agent-presets");
      const payload = await response.json();
      if (response.ok && payload.ok && Array.isArray(payload.presets)) {
        mockData.presetLibrary = payload.presets;
        if (!mockData.presetLibrary.some((preset) => preset.id === state.selectedPresetId)) {
          state.selectedPresetId = mockData.presetLibrary[0]?.id || "";
        }
      }
    } catch {
      // 直接文件模式使用本地 fallback 预制体。
    }
  }

  async function createTeamPreset() {
    const feedback = qs("#new-preset-feedback");
    const name = qs("#new-preset-name")?.value?.trim() || "团队 Agent 预制体";
    const createdBy = qs("#new-preset-created-by")?.value?.trim() || "团队";
    const description = qs("#new-preset-description")?.value?.trim() || `${name} 基于共享本地环境生成。`;
    const instructions = qs("#new-preset-instructions")?.value?.trim() || "先预览计划，并避免把 secret 写入日志。";
    if (feedback) feedback.textContent = `正在创建 ${name}...`;

    try {
      const response = await fetch("/api/agent-presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          createdBy,
          description,
          role: "团队配置的 agent",
          useCases: ["团队预制体", "共享本地环境"],
          agent: {
            instructions,
            model: "pa/gpt-5.5",
            runtimeHint: "local-codex",
            maxConcurrentTasks: 1
          },
          skills: [
            { name: "launch-review", description: "审查 launch artifact。" }
          ],
          mcpServers: [
            { name: "filesystem", purpose: "读取本地工作区文件。", required: true }
          ],
          permissions: {
            scopes: ["workspace:read", "repo:read", "test:run"],
            ttl: "1 hour",
            approvalRequired: true,
            riskLevel: "medium"
          },
          environment: [
            { key: "OPENAI_API_KEY", pathHint: "%USERPROFILE%\\.codex\\auth.json or process env", required: false }
          ],
          guardrails: ["先预览", "不记录 secret", "写入前人工确认"]
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Team preset creation failed.");
      await loadPresetLibrary();
      state.selectedPresetId = payload.preset.id;
      state.agentConfigOpen = true;
      state.presetStatus = "草稿";
      state.presetFeedback = `已选择 ${payload.preset.name}。可编辑默认值后预览或创建。`;
      if (feedback) feedback.textContent = `团队预制体已创建：${payload.preset.name}`;
      appendRecord("团队预制体已创建", `${payload.preset.name} 已在本地 GUI 会话中创建。`);
      renderAll();
    } catch (error) {
      if (feedback) feedback.textContent = error.message || String(error);
      appendRecord("团队预制体创建失败", error.message || String(error));
      renderAll();
    }
  }

  async function init() {
    const shell = qs("#app-shell");
    if (shell) shell.setAttribute("data-prototype", "visual-mock");
    bindEvents();
    await loadPresetLibrary();
    renderAll();
    if (state.pendingAssist?.issueId) {
      subscribeToPendingAssist();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
