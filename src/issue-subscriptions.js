import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_SYNC_LIMIT = 30;
const DEFAULT_INTERVAL_MS = 60000;
const ACTIVE_STATES = new Set(["active"]);
const COMPLETED_STATUSES = new Set(["done", "completed", "closed", "resolved"]);

export async function listIssueSubscriptions({ storePath } = {}) {
  const store = await readStore(storePath);
  return {
    ok: true,
    subscriptions: store.subscriptions.map(projectSubscription),
    updatedAt: store.updatedAt,
  };
}

export async function registerIssueSubscription({
  storePath,
  subscription,
  now = new Date().toISOString(),
} = {}) {
  if (!subscription?.issueId) {
    throw new Error("subscription.issueId is required");
  }
  const store = await readStore(storePath);
  const issueId = String(subscription.issueId);
  const existingIndex = store.subscriptions.findIndex((item) => item.issueId === issueId);
  const existing = existingIndex >= 0 ? store.subscriptions[existingIndex] : null;
  const next = normalizeSubscription({
    ...(existing ?? {}),
    ...subscription,
    id: existing?.id ?? stableId("issue_sub", issueId),
    issueId,
    state: subscription.state || existing?.state || "active",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSyncedAt: subscription.lastSyncedAt ?? existing?.lastSyncedAt ?? "",
    nextSyncAfter: subscription.nextSyncAfter ?? existing?.nextSyncAfter ?? now,
  });
  if (existingIndex >= 0) {
    store.subscriptions[existingIndex] = next;
  } else {
    store.subscriptions.push(next);
  }
  store.updatedAt = now;
  await writeStore(storePath, store);
  return { ok: true, subscription: projectSubscription(next) };
}

export async function setIssueSubscriptionState({
  storePath,
  id,
  state,
  now = new Date().toISOString(),
} = {}) {
  if (!["active", "paused", "completed", "deleted"].includes(state)) {
    throw new Error(`unsupported subscription state: ${state}`);
  }
  const store = await readStore(storePath);
  const index = store.subscriptions.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new Error(`unknown subscription: ${id}`);
  }
  store.subscriptions[index] = {
    ...store.subscriptions[index],
    state,
    updatedAt: now,
    nextSyncAfter: state === "active" ? now : store.subscriptions[index].nextSyncAfter,
  };
  store.updatedAt = now;
  await writeStore(storePath, store);
  return { ok: true, subscription: projectSubscription(store.subscriptions[index]) };
}

export async function deleteIssueSubscription({
  storePath,
  id,
  now = new Date().toISOString(),
} = {}) {
  const store = await readStore(storePath);
  const before = store.subscriptions.length;
  store.subscriptions = store.subscriptions.filter((item) => item.id !== id);
  store.updatedAt = now;
  await writeStore(storePath, store);
  return { ok: true, deleted: before !== store.subscriptions.length };
}

export async function syncIssueSubscriptions({
  storePath,
  exec,
  limit = DEFAULT_SYNC_LIMIT,
  preferredIssueIds = [],
  now = new Date().toISOString(),
} = {}) {
  if (typeof exec !== "function") {
    throw new Error("exec function is required for subscription sync");
  }
  const store = await readStore(storePath);
  const nowMs = Date.parse(now);
  const active = orderSubscriptionsForSync(store.subscriptions, preferredIssueIds, nowMs);
  const max = Math.max(1, Math.min(DEFAULT_SYNC_LIMIT, Number(limit) || DEFAULT_SYNC_LIMIT));
  const selected = active.slice(0, max);
  const skipped = active.slice(max).map(projectSubscription);
  const issueList = await readIssueList(exec);
  const issueById = new Map(issueList.map((issue) => [String(issue.id ?? issue.identifier ?? ""), issue]));
  const issueByIdentifier = new Map(issueList.map((issue) => [String(issue.identifier ?? ""), issue]));
  const synced = [];

  for (const subscription of selected) {
    const issue = issueById.get(subscription.issueId) || issueByIdentifier.get(subscription.issueIdentifier) || {};
    const runsResult = await exec(["issue", "runs", subscription.issueId, "--output", "json"]);
    const commentsResult = await exec(["issue", "comment", "list", subscription.issueId, "--output", "json"]);
    const runs = runsResult.code === 0 ? extractCollection(parseJsonOrNull(runsResult.stdout)) : [];
    const comments = commentsResult.code === 0 ? extractCollection(parseJsonOrNull(commentsResult.stdout)) : [];
    const latestRun = runs[0] ?? {};
    const latestComment = comments[0] ?? {};
    const status = String(issue.status ?? issue.state ?? subscription.lastKnownStatus ?? "");
    const runStatus = String(latestRun.status ?? subscription.lastRunStatus ?? "");
    const nextState = COMPLETED_STATUSES.has(status.toLowerCase()) || COMPLETED_STATUSES.has(runStatus.toLowerCase())
      ? "completed"
      : subscription.state;
    const syncedSubscription = normalizeSubscription({
      ...subscription,
      issueIdentifier: String(issue.identifier ?? subscription.issueIdentifier ?? ""),
      title: String(issue.title ?? subscription.title ?? ""),
      state: nextState,
      lastKnownStatus: status,
      lastRunStatus: runStatus,
      lastCommentExcerpt: excerpt(latestComment.content ?? latestComment.body ?? latestComment.text ?? ""),
      lastSyncedAt: now,
      nextSyncAfter: nextState === "completed"
        ? addMs(nowMs, DEFAULT_INTERVAL_MS * 10)
        : addMs(nowMs, DEFAULT_INTERVAL_MS),
      error: runsResult.code === 0 && commentsResult.code === 0
        ? ""
        : summarizeSyncError(runsResult, commentsResult),
      updatedAt: now,
    });
    replaceSubscription(store, syncedSubscription);
    synced.push(projectSubscription(syncedSubscription));
  }

  for (const subscription of skipped) {
    replaceSubscription(store, {
      ...subscription,
      nextSyncAfter: addMs(nowMs, DEFAULT_INTERVAL_MS * 5),
      updatedAt: now,
    });
  }

  store.updatedAt = now;
  await writeStore(storePath, store);
  return {
    ok: true,
    synced,
    skipped,
    warning: skipped.length ? "subscription_sync_limited" : "",
    limit: max,
  };
}

function orderSubscriptionsForSync(subscriptions, preferredIssueIds, nowMs) {
  const preferred = new Set((preferredIssueIds ?? []).map(String));
  return subscriptions
    .filter((item) => ACTIVE_STATES.has(item.state))
    .filter((item) => !item.nextSyncAfter || Date.parse(item.nextSyncAfter) <= nowMs || preferred.has(item.issueId))
    .sort((a, b) => {
      const preferredDelta = Number(preferred.has(b.issueId)) - Number(preferred.has(a.issueId));
      if (preferredDelta !== 0) return preferredDelta;
      return String(a.nextSyncAfter || "").localeCompare(String(b.nextSyncAfter || ""));
    });
}

async function readIssueList(exec) {
  const result = await exec(["issue", "list", "--output", "json"]);
  if (result.code !== 0) {
    throw new Error(summarizeResult(result) || "multica issue list failed");
  }
  return extractCollection(parseJsonOrNull(result.stdout));
}

function replaceSubscription(store, subscription) {
  const index = store.subscriptions.findIndex((item) => item.id === subscription.id);
  if (index >= 0) {
    store.subscriptions[index] = normalizeSubscription(subscription);
  }
}

function normalizeSubscription(subscription) {
  return {
    id: String(subscription.id || stableId("issue_sub", subscription.issueId)),
    kind: normalizeKind(subscription.kind),
    issueId: String(subscription.issueId || ""),
    issueIdentifier: String(subscription.issueIdentifier || ""),
    title: String(subscription.title || ""),
    goalId: String(subscription.goalId || ""),
    planSetId: String(subscription.planSetId || ""),
    subplanId: String(subscription.subplanId || ""),
    issueSplitId: String(subscription.issueSplitId || ""),
    source: normalizeSource(subscription.source),
    state: ["active", "paused", "completed", "deleted"].includes(subscription.state) ? subscription.state : "active",
    lastKnownStatus: String(subscription.lastKnownStatus || ""),
    lastRunStatus: String(subscription.lastRunStatus || ""),
    lastCommentExcerpt: excerpt(subscription.lastCommentExcerpt || ""),
    lastSyncedAt: String(subscription.lastSyncedAt || ""),
    nextSyncAfter: String(subscription.nextSyncAfter || ""),
    error: excerpt(subscription.error || ""),
    createdAt: String(subscription.createdAt || ""),
    updatedAt: String(subscription.updatedAt || ""),
  };
}

function projectSubscription(subscription) {
  return normalizeSubscription(subscription);
}

async function readStore(storePath) {
  if (!storePath) {
    return { version: 1, updatedAt: "", subscriptions: [] };
  }
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || ""),
      subscriptions: Array.isArray(parsed.subscriptions)
        ? parsed.subscriptions.map(normalizeSubscription)
        : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, updatedAt: "", subscriptions: [] };
  }
}

async function writeStore(storePath, store) {
  if (!storePath) return;
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify({
    version: 1,
    updatedAt: store.updatedAt || new Date().toISOString(),
    subscriptions: store.subscriptions.map(normalizeSubscription),
  }, null, 2)}\n`, "utf8");
}

function normalizeKind(value) {
  const kind = String(value || "");
  return ["assist_goal", "assist_plan_split", "business_issue"].includes(kind) ? kind : "business_issue";
}

function normalizeSource(value) {
  const source = String(value || "");
  return ["goal_clarification", "plan_split", "business_issue_apply"].includes(source) ? source : "business_issue_apply";
}

function extractCollection(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["issues", "runs", "comments", "items", "data"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function summarizeSyncError(runsResult, commentsResult) {
  return [runsResult, commentsResult]
    .filter((result) => result.code !== 0)
    .map(summarizeResult)
    .filter(Boolean)
    .join(" | ");
}

function summarizeResult(result) {
  return excerpt(result?.stderr || result?.stdout || `multica exited with code ${result?.code ?? ""}`);
}

function excerpt(value, maxLength = 220) {
  const clean = redactText(value).replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function redactText(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(?:api[_-]?key|token|secret|password|credential|cookie)(\s*[:=]\s*)[^\s"'`,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]");
}

function addMs(timestampMs, ms) {
  return new Date(timestampMs + ms).toISOString();
}

function stableId(prefix, input) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
