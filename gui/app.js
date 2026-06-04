(function () {
  "use strict";

  const mockData = {
    project: "MulticaPlusPlus",
    agent: "planner-agent",
    runtime: "local-docker",
    runStatus: "Running",
    goal: {
      objective: "Implement user authentication with email verification and role-based access control.",
      owner: "admin",
      status: "Running",
      completedSteps: 5,
      totalSteps: 9,
      progress: 56,
      lastSaved: "2 minutes ago",
      latestUpdateTime: "2 minutes ago",
      latestUpdate:
        "Completed database schema for users and roles. Moving on to implement email verification service."
    },
    planItems: [
      { number: 1, task: "Define data models for users and roles", status: "done", dependencies: "--" },
      { number: 2, task: "Create database migrations", status: "done", dependencies: "1" },
      { number: 3, task: "Implement user registration API", status: "done", dependencies: "1, 2" },
      { number: 4, task: "Implement email verification service", status: "running", dependencies: "2" },
      { number: 5, task: "Integrate email provider (SMTP)", status: "pending", dependencies: "4" },
      { number: 6, task: "Implement login API", status: "pending", dependencies: "3, 4" },
      { number: 7, task: "Implement RBAC middleware", status: "pending", dependencies: "3" },
      { number: 8, task: "Add role management APIs", status: "blocked", dependencies: "7" },
      { number: 9, task: "Write tests and documentation", status: "pending", dependencies: "5, 6, 7" }
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
        id: "planner",
        name: "Planner Agent",
        role: "Plan owner",
        model: "gpt-5-codex",
        runtime: "local-docker",
        permissionTemplate: "Backend Development (Default)",
        ttl: "2 hours",
        skills: ["launch-review", "plan-ledger", "permission-preview"],
        scopes: ["workspace:read", "repo:read", "issue:comment", "permission:preview"],
        guardrails: ["approval required", "no metadata writes", "mock apply only"],
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
        skills: ["diff-review", "risk-summary", "records-check"],
        scopes: ["workspace:read", "records:read", "permission:preview"],
        guardrails: ["read-only", "short lease", "human confirmation"],
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
        skills: ["activity-scan", "blocked-reason", "recovery-note"],
        scopes: ["activity:read", "records:read", "runtime:read"],
        guardrails: ["time boxed", "no secret writes", "local event only"],
        summary: "Best for inspecting blocked plan steps and preparing a recovery note."
      }
    ],
    records: [
      {
        time: "2026-06-04 15:00",
        title: "Static GUI session initialized",
        detail: "The concept screen is using local mock data only."
      }
    ],
    placeholderCopy: {
      overview: "Overview is represented as a visual shell only. The prototype keeps real work inside the three project panels.",
      agents: "Agent management stays in Multica. This plugin only previews permission setup for the active agent.",
      runs: "Run history stays in Multica. The prototype only shows the current run status in the top bar.",
      environments: "Runtime and environment management are not implemented in this local GUI mock.",
      data: "Data appears only as permission resource groups in this prototype.",
      docs: "Docs is a shell link in this visual reproduction.",
      support: "Support is a shell link in this visual reproduction."
    }
  };

  const state = {
    activeView: "project",
    templateId: "backend",
    ttl: "2 hours",
    agentConfigOpen: false,
    agentPresetId: "planner",
    agentConfigStatus: "Draft",
    agentConfigFeedback: "Preview is local only. No Multica CLI command or metadata write will run.",
    records: mockData.records.slice()
  };

  const viewIds = {
    project: "view-control",
    permissions: "view-control",
    activity: "activity-view",
    records: "records-view",
    settings: "settings-view",
    overview: "placeholder-view",
    agents: "placeholder-view",
    runs: "placeholder-view",
    environments: "placeholder-view",
    data: "placeholder-view",
    docs: "placeholder-view",
    support: "placeholder-view"
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
      const projectActive = state.activeView === "permissions" && node.getAttribute("data-nav-target") === "project";
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

    const table = el("table", "plan-table");
    const thead = el("thead");
    const headerRow = el("tr");
    ["#", "Task", "Status", "Dependencies"].forEach((label) => headerRow.appendChild(el("th", "", label)));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    mockData.planItems.forEach((item) => {
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
      "No Multica CLI command is executed by this page."
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

  function renderAgentConfig() {
    const modal = qs("#agent-config-modal");
    const presetList = qs("#agent-config-presets");
    const preview = qs("#agent-config-preview");
    const status = qs("#agent-config-status");
    const feedback = qs("#agent-config-feedback");
    if (modal) modal.hidden = !state.agentConfigOpen;
    if (status) status.textContent = state.agentConfigStatus;
    if (feedback) feedback.textContent = state.agentConfigFeedback;

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
    renderAgentConfig();
    setViewVisibility();
    setPressed();
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav-target]");
      const action = event.target.closest("[data-action]");
      const preset = event.target.closest("[data-agent-preset]");

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
        state.agentConfigFeedback = "Choose a preset, then preview or apply the local mock configuration.";
        renderAll();
      } else if (kind === "close-agent-config") {
        state.agentConfigOpen = false;
        renderAll();
      } else if (kind === "preview-agent-config") {
        const preset = currentAgentPreset();
        state.agentConfigStatus = "Previewed";
        state.agentConfigFeedback = `${preset.name} preview generated locally with ${preset.permissionTemplate}.`;
        appendRecord("Agent configuration previewed", `${preset.name} uses ${preset.model}, ${preset.runtime}, ${preset.ttl}.`);
        renderAll();
      } else if (kind === "apply-agent-config") {
        const preset = currentAgentPreset();
        state.agentConfigStatus = "Applied locally";
        state.agentConfigFeedback = `${preset.name} mock configuration applied to the page. No external state changed.`;
        mockData.agent = preset.name;
        mockData.runtime = preset.runtime;
        const matchingTemplate = mockData.templates.find((template) => template.name === preset.permissionTemplate);
        if (matchingTemplate) {
          state.templateId = matchingTemplate.id;
          state.ttl = matchingTemplate.ttl;
        }
        appendRecord("Agent mock configuration applied", `${preset.name} was applied locally with ${preset.permissionTemplate}.`);
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

  function init() {
    const shell = qs("#app-shell");
    if (shell) shell.setAttribute("data-prototype", "visual-mock");
    bindEvents();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
