import { createSparkJamScenario } from "../src/agent-memory-ledger.js";

const scenario = createSparkJamScenario();
let currentFilter = "all";

const problemText = document.querySelector("#problemText");
const scenarioTitle = document.querySelector("#scenarioTitle");
const oneLiner = document.querySelector("#oneLiner");
const summaryMetrics = document.querySelector("#summaryMetrics");
const ledgerRows = document.querySelector("#ledgerRows");
const answerText = document.querySelector("#answerText");
const answerCaveats = document.querySelector("#answerCaveats");
const conflictList = document.querySelector("#conflictList");
const pitchTrack = document.querySelector("#pitchTrack");

problemText.textContent = scenario.problem;
scenarioTitle.textContent = scenario.title;
oneLiner.textContent = scenario.oneLiner;
answerText.textContent = scenario.ledger.answer.recommendation;

renderSummary();
renderRows();
renderAnswerCaveats();
renderConflicts();
renderPitchFlow();

for (const button of document.querySelectorAll(".filter-button")) {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    renderRows();
  });
}

function renderSummary() {
  const summary = scenario.ledger.summary;
  const metrics = [
    ["总资料", summary.total],
    ["可用于回答", summary.usable],
    ["需要复核", summary.needsReview],
    ["被拒绝", summary.rejected],
  ];
  summaryMetrics.replaceChildren(
    ...metrics.map(([label, value]) => {
      const card = document.createElement("article");
      card.className = "metric-card";
      card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      return card;
    }),
  );
}

function renderRows() {
  const rows = scenario.ledger.records
    .filter((record) => currentFilter === "all" || record.status === currentFilter)
    .map((record) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>
          <span class="record-title">${record.title}</span>
          <span class="record-content">${record.content}</span>
        </td>
        <td>${record.source}<br><span class="record-content">更新 ${record.updatedAt}</span></td>
        <td><span class="score-pill">${record.score.overall} / ${record.score.grade}</span></td>
        <td><span class="status-pill status-${record.status}">${record.statusLabel}</span></td>
        <td>${record.reasonLabel}</td>
      `;
      return row;
    });
  ledgerRows.replaceChildren(...rows);
}

function renderAnswerCaveats() {
  answerCaveats.replaceChildren(
    ...scenario.ledger.answer.caveats.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}

function renderConflicts() {
  const cards = scenario.ledger.conflicts.map((conflict) => {
    const card = document.createElement("article");
    card.className = "conflict-card";
    card.innerHTML = `
      <strong>${conflict.label}</strong>
      <p>冲突 claim：${conflict.claims.join(" vs ")}。相关记录：${conflict.recordIds.join(", ")}。</p>
    `;
    return card;
  });

  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "当前没有冲突资料。";
    conflictList.replaceChildren(empty);
    return;
  }
  conflictList.replaceChildren(...cards);
}

function renderPitchFlow() {
  pitchTrack.replaceChildren(
    ...scenario.pitchFlow.map((step, index) => {
      const card = document.createElement("article");
      card.className = "pitch-step";
      card.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><strong>${step}</strong>`;
      return card;
    }),
  );
}
