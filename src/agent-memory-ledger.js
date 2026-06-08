const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SENSITIVITY_SAFETY = {
  public: 100,
  team: 90,
  internal: 75,
  private: 45,
  secret: 20,
};

const STATUS_LABELS = {
  usable: "可用于回答",
  "needs-review": "需要人工确认",
  rejected: "禁止使用",
};

const REASON_LABELS = {
  "permission-blocked": "权限不足",
  expired: "已过期",
  conflict: "存在冲突",
  "low-confidence": "低置信度",
  "privacy-risk": "隐私风险",
  "not-relevant": "任务相关性不足",
  clear: "可追溯且可用",
};

export function scoreMemoryRecord(record) {
  const today = parseDate(record.today ?? new Date().toISOString());
  const updatedAt = parseDate(record.updatedAt);
  const expiresAt = record.expiresAt ? parseDate(record.expiresAt) : null;
  const ageDays = Math.max(0, Math.floor((today.getTime() - updatedAt.getTime()) / MS_PER_DAY));
  const expired = expiresAt ? expiresAt.getTime() < today.getTime() : false;
  const freshness = expired ? 0 : Math.max(35, 100 - Math.max(0, ageDays - 1) * 2);
  const sourceTrust = toPercent(record.sourceTrust ?? 0.5);
  const taskRelevance = toPercent(record.taskRelevance ?? 0.5);
  const confidence = toPercent(record.confidence ?? 0.5);
  const privacySafety = SENSITIVITY_SAFETY[record.sensitivity] ?? 60;
  const overall = Math.round(
    sourceTrust * 0.3
      + freshness * 0.22
      + privacySafety * 0.18
      + taskRelevance * 0.2
      + confidence * 0.1,
  );

  return {
    overall,
    grade: gradeScore(overall),
    expired,
    dimensions: {
      sourceTrust,
      freshness: Math.round(freshness),
      privacySafety,
      taskRelevance,
    },
  };
}

export function buildAgentMemoryLedger({ today = new Date().toISOString(), records }) {
  const conflicts = detectConflicts(records);
  const conflictRecordIds = new Set(conflicts.flatMap((conflict) => conflict.recordIds));
  const normalizedRecords = records.map((record) => {
    const score = scoreMemoryRecord({ ...record, today });
    const decision = decidePolicy(record, score, conflictRecordIds.has(record.id));
    return {
      ...record,
      score,
      status: decision.status,
      statusLabel: STATUS_LABELS[decision.status],
      policyReason: decision.reason,
      reasonLabel: REASON_LABELS[decision.reason],
    };
  });
  const summary = summarize(normalizedRecords);
  const answer = buildExplainableAnswer(normalizedRecords);

  return {
    generatedAt: today,
    records: normalizedRecords,
    conflicts,
    summary,
    answer,
  };
}

export function createSparkJamScenario() {
  const today = "2026-06-02";
  const records = [
    {
      id: "brief-current",
      title: "Spark Jam 当日 brief",
      content: "主题围绕高质量数据、数据生成、数据标注和 agent 数据治理。",
      source: "活动主持人口头说明",
      sourceTrust: 0.94,
      updatedAt: "2026-06-02",
      expiresAt: "2026-06-04",
      sensitivity: "team",
      taskRelevance: 0.98,
      confidence: 0.92,
      permission: "allowed",
      usedByAgent: true,
    },
    {
      id: "target-team",
      title: "目标用户访谈",
      content: "AI-heavy 团队最担心 agent 记住过时结论或使用未授权资料。",
      source: "3 条用户访谈摘要",
      sourceTrust: 0.88,
      updatedAt: "2026-06-01",
      sensitivity: "team",
      taskRelevance: 0.93,
      confidence: 0.87,
      permission: "allowed",
      conflictKey: "target-user",
      claim: "AI-heavy teams",
      usedByAgent: true,
    },
    {
      id: "target-personal",
      title: "个人创作者方向",
      content: "个人创作者希望把私域资料安全交给 agent 帮忙整理。",
      source: "头脑风暴白板",
      sourceTrust: 0.64,
      updatedAt: "2026-06-02",
      sensitivity: "team",
      taskRelevance: 0.75,
      confidence: 0.67,
      permission: "allowed",
      conflictKey: "target-user",
      claim: "personal creators",
      usedByAgent: true,
    },
    {
      id: "old-market",
      title: "旧版市场定位",
      content: "去年方案聚焦 enterprise data catalog，不适合今天快速 demo。",
      source: "2025 GTM 文档",
      sourceTrust: 0.78,
      updatedAt: "2025-10-18",
      expiresAt: "2026-01-31",
      sensitivity: "internal",
      taskRelevance: 0.66,
      confidence: 0.8,
      permission: "allowed",
      usedByAgent: true,
    },
    {
      id: "private-budget",
      title: "私人预算表",
      content: "包含个人薪资、预算和未公开采购价格。",
      source: "个人 Drive",
      sourceTrust: 0.96,
      updatedAt: "2026-05-29",
      sensitivity: "private",
      taskRelevance: 0.52,
      confidence: 0.9,
      permission: "blocked",
      usedByAgent: true,
    },
    {
      id: "demo-flow",
      title: "Demo 主流程",
      content: "导入资料、agent 使用资料、账本记录、用户撤销或修正记忆。",
      source: "产品草图",
      sourceTrust: 0.82,
      updatedAt: "2026-06-02",
      sensitivity: "team",
      taskRelevance: 0.95,
      confidence: 0.86,
      permission: "allowed",
      usedByAgent: true,
    },
    {
      id: "quality-metrics",
      title: "四个数据质量指标",
      content: "来源可信度、时效性、隐私风险、任务相关性。",
      source: "评审准备笔记",
      sourceTrust: 0.84,
      updatedAt: "2026-06-02",
      sensitivity: "team",
      taskRelevance: 0.91,
      confidence: 0.9,
      permission: "allowed",
      usedByAgent: true,
    },
    {
      id: "slack-rumor",
      title: "Slack 未确认想法",
      content: "也许应该做数据营养标签，但没有明确评审需求支持。",
      source: "Slack #jam",
      sourceTrust: 0.44,
      updatedAt: "2026-06-01",
      sensitivity: "team",
      taskRelevance: 0.59,
      confidence: 0.48,
      permission: "allowed",
      usedByAgent: true,
    },
    {
      id: "sensitive-customer",
      title: "客户截图",
      content: "含真实客户名称和合同编号，只能用于内部判断，不能出现在 demo。",
      source: "销售同步",
      sourceTrust: 0.9,
      updatedAt: "2026-05-31",
      sensitivity: "secret",
      taskRelevance: 0.71,
      confidence: 0.78,
      permission: "review",
      usedByAgent: true,
    },
    {
      id: "pitch-order",
      title: "Pitch 叙事顺序",
      content: "问题痛点、为什么现在重要、产品流程、demo、数据价值、商业化。",
      source: "Jam 计划",
      sourceTrust: 0.87,
      updatedAt: "2026-06-02",
      sensitivity: "public",
      taskRelevance: 0.88,
      confidence: 0.89,
      permission: "allowed",
      usedByAgent: true,
    },
    {
      id: "privacy-rule",
      title: "记忆撤销规则",
      content: "用户可以撤销 agent 记忆，撤销后相同结论必须重新请求授权。",
      source: "隐私设计原则",
      sourceTrust: 0.83,
      updatedAt: "2026-06-01",
      sensitivity: "internal",
      taskRelevance: 0.86,
      confidence: 0.82,
      permission: "allowed",
      usedByAgent: true,
    },
    {
      id: "sample-output",
      title: "最终回答样例",
      content: "推荐 Agent Memory Ledger，因为它同时解决记忆污染、来源追踪和权限审计。",
      source: "Agent 中间结论",
      sourceTrust: 0.76,
      updatedAt: "2026-06-02",
      sensitivity: "team",
      taskRelevance: 0.96,
      confidence: 0.81,
      permission: "allowed",
      usedByAgent: true,
    },
  ];
  const ledger = buildAgentMemoryLedger({ today, records });

  return {
    title: "Agent Memory Ledger",
    problem: "Agent 越来越会记东西，但用户不知道它记了什么、为什么记、还能不能删。",
    oneLiner: "给每条 agent 记忆加上来源、置信度、过期时间、权限和冲突记录。",
    audience: "AI-heavy 创业团队、研究小组、个人创作者",
    today,
    records,
    ledger,
    shortlist: [
      "Agent Memory Ledger",
      "Data Nutrition Label",
      "Synthetic Data Forge",
      "Human-AI Labeling Queue",
      "Personal Data Vault",
      "Team Data Contract Copilot",
      "Meeting-to-Dataset",
      "Agent Data Firewall",
    ],
    pitchFlow: [
      "问题痛点",
      "为什么现在重要",
      "产品流程",
      "现场 demo",
      "数据价值",
      "未来商业化",
    ],
  };
}

function decidePolicy(record, score, hasConflict) {
  if (record.permission === "blocked") {
    return { status: "rejected", reason: "permission-blocked" };
  }
  if (score.expired) {
    return { status: "rejected", reason: "expired" };
  }
  if (hasConflict) {
    return { status: "needs-review", reason: "conflict" };
  }
  if (record.permission === "review") {
    return { status: "needs-review", reason: "privacy-risk" };
  }
  if ((record.confidence ?? 0) < 0.7 || (record.sourceTrust ?? 0) < 0.55) {
    return { status: "needs-review", reason: "low-confidence" };
  }
  if ((record.taskRelevance ?? 0) < 0.55) {
    return { status: "needs-review", reason: "not-relevant" };
  }
  if (record.sensitivity === "secret") {
    return { status: "needs-review", reason: "privacy-risk" };
  }
  return { status: "usable", reason: "clear" };
}

function detectConflicts(records) {
  const byKey = new Map();
  for (const record of records) {
    if (!record.conflictKey || !record.claim) {
      continue;
    }
    const group = byKey.get(record.conflictKey) ?? [];
    group.push(record);
    byKey.set(record.conflictKey, group);
  }

  return [...byKey.entries()]
    .filter(([, group]) => new Set(group.map((record) => record.claim)).size > 1)
    .map(([key, group]) => ({
      key,
      label: key.replaceAll("-", " "),
      claims: [...new Set(group.map((record) => record.claim))],
      recordIds: group.map((record) => record.id),
    }));
}

function summarize(records) {
  return {
    total: records.length,
    usable: records.filter((record) => record.status === "usable").length,
    needsReview: records.filter((record) => record.status === "needs-review").length,
    rejected: records.filter((record) => record.status === "rejected").length,
    averageScore: Math.round(records.reduce((sum, record) => sum + record.score.overall, 0) / records.length),
  };
}

function buildExplainableAnswer(records) {
  const usedRecords = records
    .filter((record) => record.status === "usable" && record.usedByAgent)
    .sort((a, b) => b.score.overall - a.score.overall);
  const reviewRecords = records.filter((record) => record.status === "needs-review");
  const rejectedRecords = records.filter((record) => record.status === "rejected");

  return {
    recommendation: "推荐做 Agent Memory Ledger：它把 agent 的每一次读取、记忆和拒绝都变成可检查的数据资产。",
    usedRecordIds: usedRecords.map((record) => record.id),
    caveats: [
      `${reviewRecords.length} 条资料需要人工确认后才能进入最终叙事。`,
      `${rejectedRecords.length} 条资料因为过期或权限不足被排除。`,
    ],
  };
}

function gradeScore(score) {
  if (score >= 85) {
    return "strong";
  }
  if (score >= 70) {
    return "usable";
  }
  if (score >= 55) {
    return "review";
  }
  return "risky";
}

function toPercent(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function parseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid date: ${value}`);
  }
  return date;
}
