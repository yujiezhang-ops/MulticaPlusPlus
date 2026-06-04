(function () {
  "use strict";

  const mockData = {
    project: "MulticaPlusPlus",
    agent: "Codex GUI Worker",
    runtime: "Static Browser",
    runStatus: "Mock Active",
    goal: {
      title: "Validate a GUI-first Multica++ control console before connecting real runtime data.",
      owner: "Codex",
      status: "running",
      progress: 62,
      lastUpdate: "Three-panel control view is ready for local review.",
      resumeAvailable: true
    },
    planItems: [
      { id: "P-01", title: "Define GUI-first PRD and information architecture", status: "done", dependencies: [] },
      { id: "P-02", title: "Create static HTML shell and control panels", status: "done", dependencies: ["P-01"] },
      { id: "P-03", title: "Apply dark Multica-like layout and responsive rules", status: "running", dependencies: ["P-02"] },
      { id: "P-04", title: "Wire mock plan and permission interactions", status: "running", dependencies: ["P-02"] },
      {
        id: "P-05",
        title: "Connect real Multica data after prototype review",
        status: "blocked",
        dependencies: ["P-03", "P-04"],
        blockedReason: "Real CLI integration is intentionally out of scope for this static prototype."
      },
      { id: "P-06", title: "Prepare PR update and local verification notes", status: "pending", dependencies: ["P-03"] }
    ],
    permissionTemplates: [
      {
        id: "review-only",
        name: "Review Only",
        summary: "Read-only inspection for launch review and GUI validation.",
        ttls: ["15m", "30m", "60m"],
        defaultTtl: "30m",
        approvalRequired: true,
        risk: "Low risk. No write operation is represented by this mock template.",
        scopes: [
          { group: "Monitoring", items: ["Read local monitoring records", "Read launch review summaries"] },
          { group: "Workspace", items: ["Read GUI prototype files", "Preview run context"] }
        ]
      },
      {
        id: "balanced",
        name: "Balanced Setup",
        summary: "Short-lived setup for a prepared agent run with approval gates.",
        ttls: ["30m", "60m", "120m"],
        defaultTtl: "60m",
        approvalRequired: true,
        risk: "Medium risk in real usage. This page records only local mock events.",
        scopes: [
          { group: "Workspace", items: ["Read project context", "Draft permission summary"] },
          { group: "Guardrails", items: ["Require approval before permission changes", "Require approval before policy changes"] },
          { group: "Records", items: ["Append local mock preview record"] }
        ]
      },
      {
        id: "incident-read",
        name: "Incident Read Window",
        summary: "Narrow read window for blocked work and recent coordination events.",
        ttls: ["10m", "15m", "30m"],
        defaultTtl: "15m",
        approvalRequired: true,
        risk: "Low to medium risk. Time boxed for inspection and local triage.",
        scopes: [
          { group: "Activity", items: ["Read current goal events", "Read blocked plan reasons"] },
          { group: "Records", items: ["Read permission decisions", "Read recovery notes"] }
        ]
      }
    ],
    activity: [
      "Mock goal loaded for local GUI review.",
      "Plan filter and permission template interactions are local only.",
      "No Multica CLI calls are made by this page."
    ],
    records: [
      {
        time: "2026-06-04 15:00",
        title: "Static GUI session initialized",
        detail: "Built-in data is used for this stage. No real Multica operation is performed."
      }
    ]
  };

  const state = {
    activeView: "control",
    planFilter: "all",
    templateId: "balanced",
    ttl: "60m",
    records: mockData.records.slice()
  };

  const viewIds = {
    control: "view-control",
    activity: "activity-view",
    records: "records-view",
    settings: "settings-view"
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

  function button(text, attributes = {}) {
    const node = el("button", attributes.className || "", text);
    node.type = "button";
    Object.entries(attributes).forEach(([key, value]) => {
      if (key !== "className") node.setAttribute(key, value);
    });
    return node;
  }

  function currentTemplate() {
    return mockData.permissionTemplates.find((template) => template.id === state.templateId) || mockData.permissionTemplates[0];
  }

  function setPressed(selector, activeValue, attribute) {
    qsa(selector).forEach((node) => {
      const active = node.getAttribute(attribute) === activeValue;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", active ? "true" : "false");
      if (attribute === "data-nav-target") {
        node.setAttribute("aria-current", active ? "page" : "false");
      }
    });
  }

  function metric(label, value) {
    const node = el("div", "metric");
    node.appendChild(el("span", "metric-label", label));
    node.appendChild(el("strong", "metric-value", value));
    return node;
  }

  function renderTopbar() {
    const agent = qs("#agent-value");
    const runtime = qs("#runtime-value");
    const status = qs("#run-status-value");
    if (agent) agent.textContent = mockData.agent;
    if (runtime) runtime.textContent = mockData.runtime;
    if (status) status.textContent = mockData.runStatus;
  }

  function renderGoal() {
    const target = qs("#goal-summary");
    if (!target) return;
    clear(target);

    const heading = el("h2", "panel-title", mockData.goal.title);
    const metrics = el("div", "metric-grid");
    metrics.appendChild(metric("Owner", mockData.goal.owner));
    metrics.appendChild(metric("Status", mockData.goal.status));
    metrics.appendChild(metric("Progress", `${mockData.goal.progress}%`));
    metrics.appendChild(metric("Resume", mockData.goal.resumeAvailable ? "Available" : "Unavailable"));

    const progress = el("div", "progress-bar");
    progress.setAttribute("aria-label", `Goal progress ${mockData.goal.progress}%`);
    const fill = el("span", "progress-fill");
    fill.style.width = `${mockData.goal.progress}%`;
    progress.appendChild(fill);

    target.appendChild(heading);
    target.appendChild(metrics);
    target.appendChild(progress);
    target.appendChild(el("p", "panel-note", mockData.goal.lastUpdate));
  }

  function renderPlan() {
    const list = qs("#plan-list");
    if (!list) return;
    clear(list);

    const items = mockData.planItems.filter((item) => state.planFilter === "all" || item.status === state.planFilter);
    if (!items.length) {
      list.appendChild(el("li", "empty-state", "No plan items match this filter."));
      return;
    }

    items.forEach((item) => {
      const row = el("li", `plan-item status-${item.status}`);
      row.setAttribute("data-plan-state", item.status);

      const head = el("div", "plan-item-head");
      head.appendChild(el("span", "plan-id", item.id));
      head.appendChild(el("strong", "plan-title", item.title));
      head.appendChild(el("span", "status-pill", item.status));
      row.appendChild(head);

      const deps = item.dependencies.length ? item.dependencies.join(", ") : "None";
      row.appendChild(el("p", "plan-meta", `Dependencies: ${deps}`));
      if (item.blockedReason) row.appendChild(el("p", "blocked-reason", item.blockedReason));

      list.appendChild(row);
    });
  }

  function renderPermissionTemplates() {
    const bar = qs("#permission-template-bar");
    if (!bar) return;
    clear(bar);

    mockData.permissionTemplates.forEach((template) => {
      bar.appendChild(button(template.name, {
        "data-permission-template": template.id,
        className: "template-button"
      }));
    });
  }

  function renderTtl(template) {
    const select = qs("#permission-ttl");
    if (!select) return;
    clear(select);

    if (!template.ttls.includes(state.ttl)) state.ttl = template.defaultTtl;
    template.ttls.forEach((ttl) => {
      const option = el("option", "", ttl);
      option.value = ttl;
      option.selected = ttl === state.ttl;
      select.appendChild(option);
    });
  }

  function renderPermissions() {
    const template = currentTemplate();
    renderPermissionTemplates();
    renderTtl(template);

    const approval = qs("#permission-approval-required");
    if (approval) approval.checked = template.approvalRequired;

    const summary = qs("#permission-summary");
    if (summary) {
      clear(summary);
      summary.appendChild(el("h2", "panel-title", template.name));
      summary.appendChild(el("p", "panel-note", template.summary));
      const metrics = el("div", "metric-grid");
      metrics.appendChild(metric("TTL", state.ttl));
      metrics.appendChild(metric("Approval", template.approvalRequired ? "Required" : "Not required"));
      metrics.appendChild(metric("Scopes", String(template.scopes.length)));
      summary.appendChild(metrics);
    }

    const scopes = qs("#permission-scopes");
    if (scopes) {
      clear(scopes);
      template.scopes.forEach((scope, index) => {
        const details = el("details", "scope-group");
        details.open = index === 0;
        details.appendChild(el("summary", "", scope.group));
        const items = el("ul", "scope-list");
        scope.items.forEach((item) => items.appendChild(el("li", "", item)));
        details.appendChild(items);
        scopes.appendChild(details);
      });
    }

    const risk = qs("#permission-risk");
    if (risk) {
      clear(risk);
      risk.appendChild(el("p", "risk-note", template.risk));
    }
  }

  function renderActivity() {
    const feed = qs("#activity-feed");
    if (!feed) return;
    clear(feed);
    feed.appendChild(el("p", "panel-note", "Activity is a local placeholder. Runtime and daemon streams are not connected."));
    const list = el("ul", "simple-list");
    mockData.activity.forEach((item) => list.appendChild(el("li", "", item)));
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
    const list = el("ul", "simple-list");
    [
      "Default template: Balanced Setup",
      "Default TTL: 60m",
      "External integrations: disabled",
      "Metadata writes: disabled"
    ].forEach((item) => list.appendChild(el("li", "", item)));
    panel.appendChild(list);
  }

  function setViewVisibility() {
    const goalPanel = qs("#goal-panel");
    const planPanel = qs("#plan-panel");
    const permissionPanel = qs("#permission-panel");

    Object.entries(viewIds).forEach(([view, id]) => {
      const node = qs(`#${id}`);
      if (node) {
        if (view === "control") {
          node.hidden = !(state.activeView === "control" || state.activeView === "permissions");
        } else {
          node.hidden = state.activeView !== view;
        }
      }
    });

    if (goalPanel) {
      goalPanel.hidden = state.activeView !== "control";
    }

    if (planPanel) {
      planPanel.hidden = state.activeView !== "control";
    }

    if (permissionPanel) {
      permissionPanel.hidden = !(state.activeView === "control" || state.activeView === "permissions");
    }
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
    setViewVisibility();
    setPressed("[data-nav-target]", state.activeView, "data-nav-target");
    setPressed("[data-plan-filter]", state.planFilter, "data-plan-filter");
    setPressed("[data-permission-template]", state.templateId, "data-permission-template");
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav-target]");
      const plan = event.target.closest("[data-plan-filter]");
      const template = event.target.closest("[data-permission-template]");
      const action = event.target.closest("[data-action]");

      if (nav) {
        state.activeView = nav.getAttribute("data-nav-target") || "control";
        renderAll();
        return;
      }

      if (plan) {
        state.planFilter = plan.getAttribute("data-plan-filter") || "all";
        renderAll();
        return;
      }

      if (template) {
        state.templateId = template.getAttribute("data-permission-template") || state.templateId;
        state.ttl = currentTemplate().defaultTtl;
        renderAll();
        return;
      }

      if (action) {
        const current = currentTemplate();
        const kind = action.getAttribute("data-action");
        if (kind === "open-permissions") {
          state.activeView = "permissions";
          renderAll();
          return;
        }
        if (kind === "preview-permission") {
          appendRecord("Permission preview generated", `${current.name} with TTL ${state.ttl} was previewed locally.`);
        }
        if (kind === "apply-permission") {
          appendRecord("Mock apply recorded", `${current.name} was recorded locally. No permission boundary changed.`);
        }
      }
    });

    document.addEventListener("change", (event) => {
      if (event.target.matches("[data-permission-ttl]")) {
        state.ttl = event.target.value;
        renderAll();
      }
    });
  }

  function init() {
    const shell = qs("#app-shell");
    if (shell) shell.setAttribute("data-prototype", "mock");
    bindEvents();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
