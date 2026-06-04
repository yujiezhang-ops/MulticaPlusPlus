(function () {
  "use strict";

  const mockData = {
    project: "MulticaPlusPlus",
    agent: "planner-agent",
    runtime: "local-docker",
    runStatus: "Running",
    goal: {
      objective: "Ship a GUI-first Multica++ control console for Goal, Plan, and one-click Agent permission setup.",
      owner: "Codex monitoring session",
      status: "Running",
      completedSteps: 6,
      totalSteps: 9,
      progress: 67,
      lastSaved: "2 minutes ago",
      latestUpdateTime: "2 minutes ago",
      latestUpdate:
        "Static GUI, local server bridge, preset preview, and Image2 Agent creation flow are in place. Current pass is visual QA and layout polish."
    },
    planItems: [
      { number: 1, task: "Define plugin-only navigation boundary", status: "done", dependencies: "--" },
      { number: 2, task: "Build Goal / Plan / Permission control panels", status: "done", dependencies: "1" },
      { number: 3, task: "Add preset preview and editor flow", status: "done", dependencies: "2" },
      { number: 4, task: "Wire local GUI server to Multica CLI", status: "done", dependencies: "3" },
      { number: 5, task: "Create Image2 Codex Agent from browser action", status: "done", dependencies: "4" },
      { number: 6, task: "Tighten layout density and responsive behavior", status: "running", dependencies: "2, 3" },
      { number: 7, task: "Document preset boundary and handoff rules", status: "pending", dependencies: "6" },
      { number: 8, task: "Persist team presets beyond current session", status: "blocked", dependencies: "7" },
      { number: 9, task: "Run browser QA and Node test suite", status: "pending", dependencies: "6, 7" }
    ],
    templates: [
      {
        id: "backend",
        name: "Backend Development (Default)",
        ttl: "2 hours",
        approvalRequired: true,
        riskLevel: "Medium Risk",
        privileges: 18,
        writeAccess: 3,
        highRisk: 0,
        scopes: [
          { icon: "cube", group: "Code Repositories", resource: "sparkproject/*", access: "Read, Write" },
          { icon: "database", group: "Databases", resource: "multica_pp_dev", access: "Read, Write" },
          { icon: "lock", group: "Secret Manager", resource: "/multica_pp/*", access: "Read" },
          { icon: "folder", group: "Object Storage", resource: "s3://multica-pp-dev/*", access: "Read, Write" },
          { icon: "cube", group: "APIs", resource: "Internal APIs", access: "Invoke" }
        ]
      },
      {
        id: "review",
        name: "Review Only",
        ttl: "30 minutes",
        approvalRequired: true,
        riskLevel: "Low Risk",
        privileges: 7,
        writeAccess: 0,
        highRisk: 0,
        scopes: [
          { icon: "folder", group: "Code Repositories", resource: "sparkproject/*", access: "Read" },
          { icon: "database", group: "Records", resource: "launch-review/*", access: "Read" },
          { icon: "cube", group: "APIs", resource: "Read-only status APIs", access: "Invoke" }
        ]
      },
      {
        id: "incident",
        name: "Incident Read Window",
        ttl: "15 minutes",
        approvalRequired: true,
        riskLevel: "Medium Risk",
        privileges: 11,
        writeAccess: 1,
        highRisk: 0,
        scopes: [
          { icon: "folder", group: "Code Repositories", resource: "sparkproject/*", access: "Read" },
          { icon: "database", group: "Databases", resource: "multica_pp_dev", access: "Read" },
          { icon: "lock", group: "Secret Manager", resource: "/multica_pp/logs", access: "Read" },
          { icon: "cube", group: "APIs", resource: "Recovery APIs", access: "Invoke" }
        ]
      }
    ],
    ttlOptions: ["30 minutes", "1 hour", "2 hours", "4 hours"],
    agentPresets: [
      {
        id: "image2",
        name: "Image2 Codex Agent",
        role: "High-quality image generation",
        model: "pa/gpt-5.5",
        runtime: "local-codex",
        permissionTemplate: "Backend Development (Default)",
        ttl: "2 hours",
        cliPreset: "image2",
        skills: ["paigod-imagegen"],
        scopes: ["workspace:read", "skill:use", "shell:write", "imagegen:write"],
        guardrails: ["Codex auto approval", "dry-run image payload first", "no secret logging"],
        summary: "Creates a runnable local Codex agent for high-quality Paigod image2 generation."
      },
      {
        id: "planner",
        name: "Planner Agent",
        role: "Plan owner",
        model: "gpt-5-codex",
        runtime: "local-docker",
        permissionTemplate: "Backend Development (Default)",
        ttl: "2 hours",
        cliPreset: "planner",
        skills: ["launch-review", "plan-ledger", "permission-preview"],
        scopes: ["workspace:read", "repo:read", "issue:comment", "permission:preview"],
        guardrails: ["dry-run first", "human confirmation", "no secret env writes"],
        summary: "Best for turning a goal into staged plan steps and permission previews."
      },
      {
        id: "reviewer",
        name: "Review Agent",
        role: "Read-only reviewer",
        model: "gpt-5.4",
        runtime: "static-browser",
        permissionTemplate: "Review Only",
        ttl: "30 minutes",
        cliPreset: "review",
        skills: ["diff-review", "risk-summary", "records-check"],
        scopes: ["workspace:read", "records:read", "permission:preview"],
        guardrails: ["dry-run first", "read-only intent", "human confirmation"],
        summary: "Best for checking goal, plan, and permission risk before applying a run setup."
      },
      {
        id: "incident",
        name: "Incident Triage Agent",
        role: "Blocked run triage",
        model: "gpt-5-codex",
        runtime: "local-docker",
        permissionTemplate: "Incident Read Window",
        ttl: "15 minutes",
        cliPreset: "incident",
        skills: ["activity-scan", "blocked-reason", "recovery-note"],
        scopes: ["activity:read", "records:read", "runtime:read"],
        guardrails: ["dry-run first", "time boxed", "no secret env writes"],
        summary: "Best for inspecting blocked plan steps and preparing a recovery note."
      }
    ],
    presetLibrary: [
      {
        id: "planner",
        source: "plugin",
        target: "agent",
        name: "Planner Agent",
        description: "Turns a user goal into checkpoints, launch review notes, and a maintainable plan.",
        role: "Goal and plan owner",
        createdBy: "Multica++",
        useCases: ["goal decomposition", "plan ledger", "launch review"],
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
        permissions: { scopes: ["workspace:read", "issue:read"], ttl: "2 hours", approvalRequired: true, riskLevel: "medium" },
        environment: [],
        guardrails: ["preview first", "human confirmation before writes"]
      },
      {
        id: "image2-generation",
        source: "plugin",
        target: "agent",
        name: "Image2 Generation Agent",
        description: "Creates high-quality Paigod image2 UI mockups and visual assets.",
        role: "High-quality image generation",
        createdBy: "Multica++",
        useCases: ["UI concept generation", "product mockups"],
        agent: {
          name: "Multica++ Image2 Codex Agent",
          description: "Image2 generator",
          instructions: "Use paigod-imagegen to generate high-quality UI mockups. Always dry-run first.",
          model: "pa/gpt-5.5",
          runtimeHint: "local-codex",
          visibility: "private",
          maxConcurrentTasks: 1
        },
        skills: [{ name: "paigod-imagegen", localPath: "C:\\Users\\PPIO\\.codex\\skills\\paigod-imagegen\\SKILL.md" }],
        mcpServers: [],
        permissions: { scopes: ["workspace:read", "skill:use", "shell:write"], ttl: "2 hours", approvalRequired: true, riskLevel: "medium" },
        environment: [{ key: "OPENAI_API_KEY", pathHint: "%USERPROFILE%\\.codex\\auth.json", required: true }],
        guardrails: ["dry-run image payload first", "no secret logging"]
      },
      {
        id: "team-gui-builder",
        source: "team",
        target: "agent",
        name: "Team GUI Builder Agent",
        description: "Team preset for implementing the local Multica++ GUI prototype.",
        role: "GUI implementation worker",
        createdBy: "PPIO Team",
        useCases: ["static GUI implementation", "visual QA", "local tests"],
        agent: {
          name: "Team GUI Builder Agent",
          description: "GUI builder",
          instructions: "实现 Multica++ 本地 GUI 原型，保持黑白灰视觉、无前端构建依赖，并用测试验证交互。",
          model: "pa/gpt-5.5",
          runtimeHint: "local-codex",
          visibility: "private",
          maxConcurrentTasks: 1
        },
        skills: [{ name: "launch-review" }, { name: "test-driven-development" }],
        mcpServers: [{ name: "filesystem", purpose: "Read and edit the local repository.", required: true }],
        permissions: { scopes: ["workspace:read", "repo:write", "test:run"], ttl: "2 hours", approvalRequired: true, riskLevel: "medium" },
        environment: [{ key: "GITHUB_TOKEN", pathHint: "GitHub CLI keyring", required: false }],
        guardrails: ["do not stage unrelated files", "run npm test", "no secret logging"]
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
    records: [
      {
        time: "2026-06-04 15:00",
        title: "Static GUI session initialized",
        detail: "Direct file mode uses local mock data; npm run gui enables the Image2 Multica create button."
      }
    ],
    placeholderCopy: {
      "native-boundary": "Project, Issues, Agents, Runs, Environments, Data, Skills, MCP, and runtime settings stay in native Multica. Multica++ only previews and applies the external control-layer configuration."
    }
  };

  const state = {
    activeView: "control",
    planFilter: "all",
    templateId: "backend",
    ttl: "2 hours",
    agentConfigOpen: false,
    agentPresetId: "image2",
    selectedPresetId: "team-gui-builder",
    presetStatus: "Draft",
    presetFeedback: "Select a preset to edit its default configuration.",
    agentConfigStatus: "Draft",
    agentConfigFeedback: "Preview is local in the browser. Real Multica writes must run through the CLI with an explicit confirmation token.",
    records: mockData.records.slice()
  };

  const viewIds = {
    control: "view-control",
    permissions: "view-control",
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

  function statusLabel(status) {
    const labels = {
      done: "Done",
      running: "Running",
      pending: "Pending",
      blocked: "Blocked"
    };
    return labels[status] || status;
  }

  function setPressed() {
    qsa("[data-nav-target]").forEach((node) => {
      const active = node.getAttribute("data-nav-target") === state.activeView;
      const projectActive = state.activeView === "permissions" && node.getAttribute("data-nav-target") === "control";
      node.classList.toggle("is-active", active || projectActive);
      node.setAttribute("aria-current", active || projectActive ? "page" : "false");
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

    const objective = el("section", "goal-section");
    objective.appendChild(el("span", "section-label", "Current Objective"));
    objective.appendChild(el("h2", "goal-title", mockData.goal.objective));
    target.appendChild(objective);

    const meta = el("div", "goal-meta-row");
    const owner = el("div", "goal-meta");
    owner.appendChild(el("span", "section-label", "Owner"));
    const ownerValue = el("span", "person-value");
    ownerValue.appendChild(makeIcon("user"));
    ownerValue.appendChild(el("span", "", mockData.goal.owner));
    owner.appendChild(ownerValue);

    const status = el("div", "goal-meta");
    status.appendChild(el("span", "section-label", "Status"));
    const statusValue = el("span", "status-chip status-running");
    statusValue.appendChild(el("span", "status-dot"));
    statusValue.appendChild(el("span", "", mockData.goal.status));
    status.appendChild(statusValue);
    meta.appendChild(owner);
    meta.appendChild(status);
    target.appendChild(meta);

    const progressSection = el("section", "goal-section progress-section");
    const progressHeader = el("div", "progress-header");
    progressHeader.appendChild(el("span", "", "Progress"));
    progressHeader.appendChild(el("span", "", `${mockData.goal.completedSteps} / ${mockData.goal.totalSteps} steps`));
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
    resumeCopy.appendChild(el("h3", "", "Restore / Resume"));
    resumeCopy.appendChild(el("p", "", `Last saved ${mockData.goal.lastSaved}`));
    const resumeButton = el("button", "outline-button resume-button");
    resumeButton.type = "button";
    resumeButton.setAttribute("data-action", "resume-goal");
    resumeButton.appendChild(makeIcon("play"));
    resumeButton.appendChild(el("span", "", "Resume"));
    resume.appendChild(resumeCopy);
    resume.appendChild(resumeButton);
    target.appendChild(resume);

    const update = el("section", "goal-section latest-update");
    const updateHeader = el("div", "split-header");
    updateHeader.appendChild(el("h3", "", "Latest Goal Update"));
    updateHeader.appendChild(el("span", "", mockData.goal.latestUpdateTime));
    update.appendChild(updateHeader);
    update.appendChild(el("p", "", mockData.goal.latestUpdate));
    target.appendChild(update);

    const history = el("button", "full-row-button");
    history.type = "button";
    history.setAttribute("data-action", "view-goal-history");
    history.appendChild(makeIcon("clock"));
    history.appendChild(el("span", "", "View Goal History"));
    history.appendChild(el("span", "row-arrow"));
    target.appendChild(history);
  }

  function renderPlan() {
    const target = qs("#plan-list");
    if (!target) return;
    clear(target);

    const toolbar = el("div", "plan-toolbar");
    [
      ["all", "All"],
      ["running", "Running"],
      ["pending", "Pending"],
      ["done", "Done"],
      ["blocked", "Blocked"]
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
    ["#", "Task", "Status", "Dependencies"].forEach((label) => headerRow.appendChild(el("th", "", label)));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    const items = state.planFilter === "all"
      ? mockData.planItems
      : mockData.planItems.filter((item) => item.status === state.planFilter);
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
      const cell = el("td", "plan-empty", "No plan items match this filter.");
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

    const current = mockData.planItems.find((item) => item.status === "running");
    const footer = el("div", "plan-current-step");
    footer.appendChild(el("span", "", "Current Step"));
    footer.appendChild(el("strong", "", current ? `${current.number} / ${mockData.planItems.length}` : "--"));
    footer.appendChild(el("span", "", current ? current.task : "No active step"));
    target.appendChild(footer);
  }

  function renderPermissionSummary(template) {
    const target = qs("#permission-summary");
    if (!target) return;
    clear(target);

    const templateRow = el("section", "permission-template-row");
    templateRow.appendChild(el("label", "", "Permission Template"));
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
    header.appendChild(el("h3", "", "Scope (Resource Groups)"));
    const editButton = el("button", "ghost-button edit-button");
    editButton.type = "button";
    editButton.setAttribute("data-action", "edit-scopes");
    editButton.appendChild(el("span", "", "Edit"));
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
    ttl.appendChild(el("span", "", "TTL (Lease Duration)"));
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
    approval.appendChild(el("span", "", "Approval Required"));
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
    riskHeader.appendChild(el("h3", "", "Risk Summary"));
    riskHeader.appendChild(el("span", "muted-link", "View Details"));
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
    riskGrid.appendChild(riskMetric("Privileges", template.privileges));
    riskGrid.appendChild(riskMetric("Write Access", template.writeAccess));
    riskGrid.appendChild(riskMetric("High Risk", template.highRisk));
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
    feed.appendChild(el("p", "panel-note", "Activity is a local visual shell. Runtime streams are not connected."));
    const list = el("ul", "record-list");
    [
      "Goal restored from local mock state.",
      "Permission preview and apply actions write page-local records only.",
      "Only the Image2 create button can call the local GUI server; other controls remain local."
    ].forEach((item) => list.appendChild(el("li", "record-item", item)));
    feed.appendChild(list);
  }

  function renderRecords() {
    const list = qs("#records-list");
    if (!list) return;
    clear(list);
    list.appendChild(el("p", "panel-note", "Records are page-local mock entries. Nothing is persisted."));
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
    panel.appendChild(el("p", "panel-note", "Settings are placeholders for future plugin options."));
    const list = el("ul", "record-list");
    [
      "Default template: Backend Development (Default)",
      "Default TTL: 2 hours",
      "External integrations: disabled",
      "Metadata writes: disabled"
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
      ["Source", preset.source === "team" ? `Team · ${preset.createdBy}` : "Plugin"],
      ["Target", preset.target],
      ["Role", preset.role],
      ["Model", preset.agent.model || "runtime default"],
      ["Runtime", preset.agent.runtimeHint || "local-codex"],
      ["TTL", preset.permissions.ttl],
      ["Risk", preset.permissions.riskLevel],
      ["Skills", preset.skills.map((skill) => skill.name).join(", ") || "none"],
      ["MCP", preset.mcpServers.map((server) => server.name).join(", ") || "none"],
      ["Env paths", preset.environment.map((item) => `${item.key}: ${item.pathHint || "configured separately"}`).join("; ") || "none"]
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
      newPresetFeedback.textContent = "Creates a session-local team preset. It does not write Multica metadata.";
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
      ["Role", preset.role],
      ["Model", preset.model],
      ["Runtime", preset.runtime],
      ["Permission Template", preset.permissionTemplate],
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
    header.appendChild(el("h3", "", "Real Multica CLI Plan"));
    header.appendChild(el("span", "config-status", "Requires terminal"));
    section.appendChild(header);
    section.appendChild(el("p", "cli-plan-note", "Direct file mode cannot execute local commands. When opened through npm run gui, the Image2 create button calls the local server; the commands below remain reproducible terminal fallbacks."));

    const commands = [
      ["Discover", mockData.cliConfig.discover],
      ["Dry-run", `node src/cli.js agent-config apply --preset ${preset.cliPreset} --output json`],
      ["Save plan", `node src/cli.js agent-config plan --preset ${preset.cliPreset} --plan-out ${mockData.cliConfig.planOut} --review-out ${mockData.cliConfig.reviewOut}`],
      ["Execute", `node src/cli.js agent-config apply --preset ${preset.cliPreset} --execute --confirm ${preset.cliPreset === "image2" ? mockData.cliConfig.image2ConfirmationToken : mockData.cliConfig.confirmationToken} --output json`]
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
      button.disabled = state.agentConfigStatus === "Creating";
      button.setAttribute("data-action", "create-image2-agent");
      button.appendChild(makeIcon("spark"));
      button.appendChild(el("span", "", state.agentConfigStatus === "Creating" ? "Creating Image2 Codex Agent" : "Create Image2 Codex Agent"));
      section.appendChild(button);
    }
    section.appendChild(el("p", "cli-plan-warning", "custom_env writes are blocked by design; use --custom-env-file or --custom-env-stdin only after human approval."));
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
    const label = state.activeView.charAt(0).toUpperCase() + state.activeView.slice(1);
    heading.textContent = label;
    clear(content);
    content.appendChild(el("p", "panel-note", mockData.placeholderCopy[state.activeView] || "This section is a visual placeholder."));
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

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav-target]");
      const action = event.target.closest("[data-action]");
      const planFilter = event.target.closest("[data-plan-filter]");
      const preset = event.target.closest("[data-agent-preset]");
      const libraryPreset = event.target.closest("[data-agent-preset-id]");

      if (planFilter) {
        state.planFilter = planFilter.getAttribute("data-plan-filter") || "all";
        renderAll();
        return;
      }

      if (libraryPreset) {
        state.selectedPresetId = libraryPreset.getAttribute("data-agent-preset-id") || state.selectedPresetId;
        state.agentConfigOpen = true;
        state.presetStatus = "Draft";
        state.presetFeedback = `${currentLibraryPreset().name} selected. Edit defaults, then preview or create.`;
        renderAll();
        return;
      }

      if (preset) {
        state.agentPresetId = preset.getAttribute("data-agent-preset") || state.agentPresetId;
        state.agentConfigStatus = "Draft";
        state.agentConfigFeedback = `${currentAgentPreset().name} selected for local preview.`;
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
        state.agentConfigStatus = "Draft";
        state.agentConfigFeedback = "Choose a preset, then preview locally or run the real CLI plan from a terminal.";
        renderAll();
      } else if (kind === "close-agent-config") {
        state.agentConfigOpen = false;
        renderAll();
      } else if (kind === "preview-agent-config") {
        const preset = currentAgentPreset();
        state.agentConfigStatus = "Previewed";
        state.agentConfigFeedback = `${preset.name} preview generated. Use agent-config apply without --execute for a real CLI dry-run.`;
        appendRecord("Agent configuration previewed", `${preset.name} uses CLI preset ${preset.cliPreset}. Browser preview did not change Multica.`);
        renderAll();
      } else if (kind === "create-image2-agent") {
        createImage2Agent();
      } else if (kind === "preview-selected-preset") {
        previewSelectedPreset();
      } else if (kind === "create-selected-preset-agent") {
        createSelectedPresetAgent();
      } else if (kind === "create-team-preset") {
        createTeamPreset();
      } else if (kind === "apply-agent-config") {
        const preset = currentAgentPreset();
        state.agentConfigStatus = "Applied locally";
        state.agentConfigFeedback = `${preset.name} mock configuration applied to the page. Real Multica apply requires the terminal confirmation token.`;
        mockData.agent = preset.name;
        mockData.runtime = preset.runtime;
        const matchingTemplate = mockData.templates.find((template) => template.name === preset.permissionTemplate);
        if (matchingTemplate) {
          state.templateId = matchingTemplate.id;
          state.ttl = matchingTemplate.ttl;
        }
        appendRecord("Agent mock configuration applied", `${preset.name} was applied locally. Run the CLI Execute command to configure Multica.`);
        renderAll();
      } else if (kind === "preview-permission") {
        appendRecord("Permission preview generated", `${template.name} with TTL ${state.ttl} was previewed locally.`);
      } else if (kind === "apply-permission") {
        appendRecord("Mock apply recorded", `${template.name} was recorded locally. No permission boundary changed.`);
      } else if (kind === "resume-goal") {
        appendRecord("Goal resume requested", "Resume was recorded inside the local page only.");
      } else if (kind === "view-goal-history") {
        state.activeView = "records";
        renderAll();
      } else if (kind === "edit-scopes") {
        appendRecord("Scope edit opened", "Scope editing is represented as a local mock event.");
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
    });
  }

  async function createImage2Agent() {
    const preset = currentAgentPreset();
    if (state.agentConfigStatus === "Creating") {
      return;
    }
    if (preset.cliPreset !== "image2") {
      state.agentConfigStatus = "Blocked";
      state.agentConfigFeedback = "Select the Image2 Codex Agent preset before creating a real Image2 agent.";
      renderAll();
      return;
    }

    state.agentConfigStatus = "Creating";
    state.agentConfigFeedback = "Calling local GUI server to create or update the Multica Image2 Codex Agent...";
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
      state.agentConfigStatus = "Created in Multica";
      state.agentConfigFeedback = `Created or updated Image2 Codex Agent (${agentId}) with paigod-imagegen skill (${skillId}).`;
      appendRecord("Image2 Codex Agent created", `Multica agent ${agentId || "unknown"} bound skill ${skillId || "unknown"}.`);
      renderAll();
    } catch (error) {
      state.agentConfigStatus = "Failed";
      state.agentConfigFeedback = error.message || String(error);
      appendRecord("Image2 Codex Agent creation failed", state.agentConfigFeedback);
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
    state.presetStatus = "Previewing";
    state.presetFeedback = `Generating preview plan for ${preset.name}...`;
    renderAll();
    try {
      const response = await fetch(`/api/agent-presets/${encodeURIComponent(preset.id)}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overrides: selectedPresetOverrides() })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Preset preview failed.");
      state.presetStatus = "Previewed";
      state.presetFeedback = `${payload.plan?.target?.name || preset.agent.name} preview ready. Unsupported MCP/env writes stay blocked.`;
      appendRecord("Preset plan previewed", `${preset.name} generated a dry-run plan.`);
      renderAll();
    } catch (error) {
      state.presetStatus = "Failed";
      state.presetFeedback = error.message || String(error);
      renderAll();
    }
  }

  async function createSelectedPresetAgent() {
    const preset = currentLibraryPreset();
    if (state.presetStatus === "Creating") return;
    state.presetStatus = "Creating";
    state.presetFeedback = `Creating Multica Agent from ${preset.name}...`;
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
      state.presetStatus = "Created in Multica";
      state.presetFeedback = `Created Multica Agent from preset (${agentId || "unknown"}).`;
      appendRecord("Preset Agent created", `${preset.name} created Multica agent ${agentId || "unknown"}.`);
      renderAll();
    } catch (error) {
      state.presetStatus = "Failed";
      state.presetFeedback = error.message || String(error);
      appendRecord("Preset Agent creation failed", state.presetFeedback);
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
      // Direct file mode uses local fallback presets.
    }
  }

  async function createTeamPreset() {
    const feedback = qs("#new-preset-feedback");
    const name = qs("#new-preset-name")?.value?.trim() || "Team Agent Preset";
    const createdBy = qs("#new-preset-created-by")?.value?.trim() || "Team";
    const description = qs("#new-preset-description")?.value?.trim() || `${name} generated from the shared local environment.`;
    const instructions = qs("#new-preset-instructions")?.value?.trim() || "Preview the plan first and keep secrets out of logs.";
    if (feedback) feedback.textContent = `Creating ${name}...`;

    try {
      const response = await fetch("/api/agent-presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          createdBy,
          description,
          role: "Team configured agent",
          useCases: ["team preset", "shared local environment"],
          agent: {
            instructions,
            model: "pa/gpt-5.5",
            runtimeHint: "local-codex",
            maxConcurrentTasks: 1
          },
          skills: [
            { name: "launch-review", description: "Review launch artifacts." }
          ],
          mcpServers: [
            { name: "filesystem", purpose: "Read local workspace files.", required: true }
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
          guardrails: ["preview first", "no secret logging", "human confirmation before writes"]
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Team preset creation failed.");
      await loadPresetLibrary();
      state.selectedPresetId = payload.preset.id;
      state.agentConfigOpen = true;
      state.presetStatus = "Draft";
      state.presetFeedback = `${payload.preset.name} selected. Edit defaults, then preview or create.`;
      if (feedback) feedback.textContent = `Team preset created: ${payload.preset.name}`;
      appendRecord("Team preset created", `${payload.preset.name} was created in the local GUI session.`);
      renderAll();
    } catch (error) {
      if (feedback) feedback.textContent = error.message || String(error);
      appendRecord("Team preset creation failed", error.message || String(error));
      renderAll();
    }
  }

  async function init() {
    const shell = qs("#app-shell");
    if (shell) shell.setAttribute("data-prototype", "visual-mock");
    bindEvents();
    await loadPresetLibrary();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
