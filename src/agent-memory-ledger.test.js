import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentMemoryLedger,
  createSparkJamScenario,
  scoreMemoryRecord,
} from "./agent-memory-ledger.js";

test("scores memory records across trust, freshness, privacy, and relevance", () => {
  const score = scoreMemoryRecord({
    sourceTrust: 0.92,
    updatedAt: "2026-06-01",
    expiresAt: "2026-07-01",
    sensitivity: "internal",
    taskRelevance: 0.88,
    confidence: 0.91,
    today: "2026-06-02",
  });

  assert.deepEqual(score.dimensions, {
    sourceTrust: 92,
    freshness: 100,
    privacySafety: 75,
    taskRelevance: 88,
  });
  assert.equal(score.overall, 90);
  assert.equal(score.grade, "strong");
});

test("marks expired and restricted data as rejected even when it is relevant", () => {
  const ledger = buildAgentMemoryLedger({
    today: "2026-06-02",
    records: [
      {
        id: "old-plan",
        title: "Old go-to-market plan",
        content: "Launch audience was students.",
        source: "Notion",
        sourceTrust: 0.82,
        updatedAt: "2025-11-01",
        expiresAt: "2026-01-01",
        sensitivity: "internal",
        taskRelevance: 0.9,
        confidence: 0.86,
        permission: "allowed",
        usedByAgent: true,
      },
      {
        id: "private-budget",
        title: "Personal budget",
        content: "Contains private salary numbers.",
        source: "Drive",
        sourceTrust: 0.95,
        updatedAt: "2026-05-30",
        sensitivity: "private",
        taskRelevance: 0.84,
        confidence: 0.9,
        permission: "blocked",
        usedByAgent: true,
      },
    ],
  });

  assert.deepEqual(
    ledger.records.map((record) => [record.id, record.status, record.policyReason]),
    [
      ["old-plan", "rejected", "expired"],
      ["private-budget", "rejected", "permission-blocked"],
    ],
  );
  assert.equal(ledger.summary.rejected, 2);
  assert.equal(ledger.answer.usedRecordIds.length, 0);
});

test("detects factual conflicts and sends low-confidence records to review", () => {
  const ledger = buildAgentMemoryLedger({
    today: "2026-06-02",
    records: [
      {
        id: "audience-1",
        title: "Kickoff brief",
        content: "Primary audience is indie hackers.",
        source: "Meeting notes",
        sourceTrust: 0.86,
        updatedAt: "2026-05-31",
        sensitivity: "team",
        taskRelevance: 0.89,
        confidence: 0.84,
        permission: "allowed",
        conflictKey: "target-audience",
        claim: "indie hackers",
        usedByAgent: true,
      },
      {
        id: "audience-2",
        title: "Old research memo",
        content: "Primary audience is enterprise admins.",
        source: "Research memo",
        sourceTrust: 0.73,
        updatedAt: "2026-05-20",
        sensitivity: "team",
        taskRelevance: 0.8,
        confidence: 0.77,
        permission: "allowed",
        conflictKey: "target-audience",
        claim: "enterprise admins",
        usedByAgent: true,
      },
      {
        id: "weak-signal",
        title: "Unverified Slack idea",
        content: "Maybe users want a nutrition label instead.",
        source: "Slack",
        sourceTrust: 0.45,
        updatedAt: "2026-06-01",
        sensitivity: "team",
        taskRelevance: 0.63,
        confidence: 0.52,
        permission: "allowed",
        usedByAgent: true,
      },
    ],
  });

  assert.deepEqual(
    ledger.records.map((record) => [record.id, record.status, record.policyReason]),
    [
      ["audience-1", "needs-review", "conflict"],
      ["audience-2", "needs-review", "conflict"],
      ["weak-signal", "needs-review", "low-confidence"],
    ],
  );
  assert.equal(ledger.conflicts.length, 1);
  assert.deepEqual(ledger.conflicts[0].recordIds, ["audience-1", "audience-2"]);
  assert.equal(ledger.summary.needsReview, 3);
});

test("builds the Spark Jam demo scenario with enough staged data and pitch sections", () => {
  const scenario = createSparkJamScenario();

  assert.equal(scenario.title, "Agent Memory Ledger");
  assert.ok(scenario.problem.includes("用户不知道它记了什么"));
  assert.ok(scenario.records.length >= 10);
  assert.deepEqual(scenario.pitchFlow, [
    "问题痛点",
    "为什么现在重要",
    "产品流程",
    "现场 demo",
    "数据价值",
    "未来商业化",
  ]);
  assert.ok(scenario.ledger.summary.usable > 0);
  assert.ok(scenario.ledger.summary.needsReview > 0);
  assert.ok(scenario.ledger.summary.rejected > 0);
});
