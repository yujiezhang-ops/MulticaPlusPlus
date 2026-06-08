import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  parseLlmGoalClarificationResponse,
  parseLlmPlanSetResponse,
  sanitizeProvider,
} from "./llm-assist.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
const DEFAULT_RUN_TIMEOUT_MS = 300000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_DISCOVERY_RETRIES = 1;
const DEFAULT_DISCOVERY_RETRY_DELAY_MS = 500;
const SECRET_KEY_PATTERN = /token|secret|password|api[_-]?key|cookie|credential/i;

export async function discoverAssistAgents({
  cliPath = "multica",
  exec,
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  discoveryRetries = DEFAULT_DISCOVERY_RETRIES,
  retryDelayMs = DEFAULT_DISCOVERY_RETRY_DELAY_MS,
  sleep = defaultSleep,
} = {}) {
  const run = exec ?? createMulticaExec({ cliPath, timeoutMs: commandTimeoutMs });
  const diagnostics = {};
  const warnings = [];

  const daemon = await runTextCommand(run, ["daemon", "status"]);
  diagnostics.daemon = summarizeCommandResult(daemon);
  const daemonStatus = daemon.code === 0 ? parseDaemonStatus(daemon.stdout) : { status: "unknown" };
  if (daemon.code !== 0) warnings.push("daemon_status_unavailable");

  const runtimeResult = await runRetriedJsonCommand(run, ["runtime", "list", "--output", "json"], {
    retries: discoveryRetries,
    retryDelayMs,
    sleep,
  });
  diagnostics.runtimeList = summarizeCommandResult(runtimeResult);
  const runtimes = runtimeResult.ok
    ? extractCollection(runtimeResult.data, ["runtimes", "items", "data"]).map(sanitizeRuntime)
    : [];
  if (!runtimeResult.ok) warnings.push("runtime_list_unavailable");
  const runtimeById = new Map(runtimes.map((runtime) => [runtime.id, runtime]));

  const agentResult = await runRetriedJsonCommand(run, ["agent", "list", "--output", "json"], {
    retries: discoveryRetries,
    retryDelayMs,
    sleep,
  });
  diagnostics.agentList = summarizeCommandResult(agentResult);
  if (!agentResult.ok) {
    return {
      ok: false,
      blocked: true,
      status: "blocked",
      reason: classifyMulticaCommandFailure(agentResult),
      agents: [],
      selectedAgent: null,
      runtimes,
      daemon: daemonStatus,
      warnings,
      diagnostic: diagnostics,
    };
  }

  const rawAgents = extractCollection(agentResult.data, ["agents", "items", "data"]);
  const agents = rawAgents
    .filter((agent) => !agent?.archived_at && !agent?.archivedAt)
    .map((agent) => sanitizeAssistAgent(agent, runtimeById.get(String(agent?.runtime_id ?? agent?.runtimeId ?? ""))));
  const selection = selectAssistAgent({ agents, mode: "auto" });

  return {
    ok: Boolean(selection.ok),
    status: selection.ok ? "available" : "blocked",
    blocked: selection.ok ? undefined : true,
    reason: selection.ok ? undefined : selection.reason,
    agents,
    selectedAgent: selection.selectedAgent ?? null,
    runtimes,
    daemon: daemonStatus,
    warnings,
    diagnostic: diagnostics,
  };
}

export function selectAssistAgent({ agents = [], preferredAgentId = "", mode = "auto" } = {}) {
  const candidates = agents.filter((agent) => agent && agent.id && agent.status !== "archived");
  if (!candidates.length) {
    return { ok: false, blocked: true, reason: "no_assist_agent", selectedAgent: null, agents: [] };
  }

  if (preferredAgentId) {
    const selected = candidates.find((agent) => agent.id === preferredAgentId || agent.name === preferredAgentId);
    if (!selected) {
      return {
        ok: false,
        blocked: true,
        reason: "assist_agent_not_found",
        selectedAgent: null,
        agents: rankAssistAgents(candidates),
      };
    }
    return { ok: true, status: "available", selectedAgent: selected, agents: rankAssistAgents(candidates) };
  }

  if (mode === "manual") {
    return {
      ok: false,
      blocked: true,
      reason: "assist_agent_required",
      selectedAgent: null,
      agents: rankAssistAgents(candidates),
    };
  }

  const ranked = rankAssistAgents(candidates);
  return { ok: true, status: "available", selectedAgent: ranked[0], agents: ranked };
}

export async function diagnoseAssistAgents(options = {}) {
  const discovery = await discoverAssistAgents(options);
  return {
    ok: discovery.ok,
    status: discovery.status,
    blocked: discovery.blocked,
    reason: discovery.reason,
    selectedAgent: discovery.selectedAgent,
    agents: discovery.agents,
    daemon: discovery.daemon,
    runtimes: discovery.runtimes,
    diagnostic: discovery.diagnostic,
    warnings: discovery.warnings,
  };
}

export async function invokeMulticaAgentForGoalClarification({
  agent,
  request = "",
  context = {},
  language = context?.language,
  cliPath = "multica",
  exec,
  timeoutMs = DEFAULT_RUN_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  sleep = defaultSleep,
} = {}) {
  const result = await invokeMulticaAgent({
    agent,
    cliPath,
    exec,
    timeoutMs,
    pollIntervalMs,
    sleep,
    title: "Multica++ Assist · Goal clarification",
    prompt: buildGoalClarificationPrompt({ request, context, language }),
    parseResponse(rawText) {
      return { goalDraft: parseLlmGoalClarificationResponse(JSON.stringify(parseAgentJsonResponse(rawText))) };
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    provider: providerFromAssistAgent(agent),
    goalDraft: result.goalDraft,
    assist: result.assist,
    warnings: result.warnings ?? [],
  };
}

export async function invokeMulticaAgentForPlanSplit({
  agent,
  goal,
  constraints = [],
  availableAgents = [],
  language = goal?.language,
  cliPath = "multica",
  exec,
  timeoutMs = DEFAULT_RUN_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  sleep = defaultSleep,
} = {}) {
  const result = await invokeMulticaAgent({
    agent,
    cliPath,
    exec,
    timeoutMs,
    pollIntervalMs,
    sleep,
    title: "Multica++ Assist · Goal to Plan split",
    prompt: buildGoalPlanSplitPrompt({ goal, constraints, availableAgents, language }),
    parseResponse(rawText) {
      return { planSetDraft: parseLlmPlanSetResponse(JSON.stringify(parseAgentJsonResponse(rawText))) };
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    provider: providerFromAssistAgent(agent),
    planSetDraft: result.planSetDraft,
    assist: result.assist,
    warnings: result.warnings ?? [],
  };
}

export async function startMulticaAgentForGoalClarification({
  agent,
  request = "",
  context = {},
  language = context?.language,
  assistChainId = "",
  assistRequestId = "",
  cliPath = "multica",
  exec,
} = {}) {
  return startMulticaAgentAssist({
    agent,
    cliPath,
    exec,
    title: buildAssistIssueTitle({ kind: "goal", assistChainId }),
    prompt: buildGoalClarificationPrompt({ request, context, language, assistChainId, assistRequestId }),
    assistChainId,
    assistRequestId,
  });
}

export async function startMulticaAgentForPlanSplit({
  agent,
  goal,
  constraints = [],
  availableAgents = [],
  language = goal?.language,
  assistChainId = "",
  assistRequestId = "",
  cliPath = "multica",
  exec,
} = {}) {
  return startMulticaAgentAssist({
    agent,
    cliPath,
    exec,
    title: buildAssistIssueTitle({ kind: "planSet", assistChainId }),
    prompt: buildGoalPlanSplitPrompt({ goal, constraints, availableAgents, language, assistChainId, assistRequestId }),
    assistChainId,
    assistRequestId,
  });
}

export function parseAgentJsonResponse(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    const error = new Error("Multica agent output was empty.");
    error.code = "agent_output_missing";
    throw error;
  }

  const direct = parseJsonOrNull(text);
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = parseJsonOrNull(fenced[1].trim());
    if (parsed) return parsed;
  }

  const objectText = extractFirstJsonObject(text);
  if (objectText) {
    const parsed = parseJsonOrNull(objectText);
    if (parsed) return parsed;
  }

  const error = new Error("Multica agent output did not contain parseable JSON.");
  error.code = "agent_non_json_output";
  throw error;
}

export function providerFromAssistAgent(agent = {}) {
  return sanitizeProvider({
    id: `provider_multica_agent_${agent.id || "auto"}`,
    kind: "multica-agent",
    command: "multica",
    model: agent.model || "",
    source: "multica-agent",
    status: "available",
  });
}

export async function checkMulticaAgentAssistResult({
  kind = "goal",
  issueId = "",
  assistRequestId = "",
  agent,
  cliPath = "multica",
  exec,
} = {}) {
  if (!issueId) {
    return { ok: false, blocked: true, reason: "multica_assist_issue_missing", diagnostic: {} };
  }
  const run = exec ?? createMulticaExec({ cliPath, timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS });
  const runsResult = await runJsonCommand(run, ["issue", "runs", issueId, "--output", "json"]);
  const diagnostic = { issue: { id: String(issueId) }, outputSource: "" };
  if (!runsResult.ok) {
    return blockedResult(classifyMulticaCommandFailure(runsResult), {
      ...diagnostic,
      runs: summarizeCommandResult(runsResult),
    });
  }

  const runs = extractCollection(runsResult.data, ["runs", "items", "data"]).map(sanitizeRun);
  const latest = selectLatestRun(runs);
  diagnostic.runCount = runs.length;
  if (!latest || !["completed", "done", "failed", "error", "cancelled", "canceled"].includes(latest.status)) {
    return {
      ok: true,
      pending: true,
      status: "pending",
      assist: stripEmpty({
        agent: agent ? sanitizeAssistAgent(agent) : undefined,
        issue: { id: String(issueId) },
        run: sanitizeRunForSummary(latest),
      }),
      diagnostic: redactObject(diagnostic),
    };
  }
  diagnostic.run = sanitizeRunForSummary(latest);

  if (["failed", "error"].includes(latest.status)) {
    return blockedResult("multica_agent_run_failed", diagnostic);
  }
  if (["cancelled", "canceled"].includes(latest.status)) {
    return blockedResult("multica_agent_run_cancelled", diagnostic);
  }

  const candidate = await findAgentJsonOutput({ run, issueId, latest, kind, assistRequestId });
  diagnostic.outputSource = candidate.source;
  if (!candidate.ok) {
    return blockedResult("multica_agent_json_not_found", diagnostic);
  }

  try {
    const parsed = kind === "planSet"
      ? { planSetDraft: parseLlmPlanSetResponse(JSON.stringify(candidate.data)) }
      : { goalDraft: parseLlmGoalClarificationResponse(JSON.stringify(candidate.data)) };
    return {
      ok: true,
      status: "completed",
      ...parsed,
      assist: stripEmpty({
        agent: agent ? sanitizeAssistAgent(agent) : undefined,
        issue: { id: String(issueId) },
        run: sanitizeRunForSummary(latest),
      }),
      diagnostic: redactObject(diagnostic),
    };
  } catch (error) {
    return blockedResult(error.code === "agent_non_json_output" ? "multica_agent_non_json_output" : "multica_agent_invalid_json", {
      ...diagnostic,
      parseError: error.message,
    });
  }
}

async function startMulticaAgentAssist({
  agent,
  cliPath,
  exec,
  title,
  prompt,
  assistChainId = "",
  assistRequestId = "",
}) {
  if (!agent?.id) {
    return { ok: false, blocked: true, reason: "assist_agent_required", diagnostic: {} };
  }

  const run = exec ?? createMulticaExec({ cliPath, timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS });
  const tempDir = await mkdtemp(join(tmpdir(), "multica-agent-assist-"));
  const promptFile = join(tempDir, "prompt.md");
  const diagnostic = {
    agent: sanitizeAssistAgent(agent),
    issue: null,
  };

  try {
    await writeFile(promptFile, prompt, "utf8");
    const issueResult = assistChainId
      ? await upsertAssistInboxIssue({ run, title, promptFile, agent })
      : await createAssistIssue({ run, title, promptFile, agent });
    Object.assign(diagnostic, issueResult.diagnostic);
    if (!issueResult.ok) {
      return blockedResult(issueResult.reason, diagnostic);
    }

    const issue = issueResult.issue;
    diagnostic.issue = issue;
    if (!issue.id) {
      return blockedResult("multica_assist_issue_missing", diagnostic);
    }
    const subscriberResult = await runJsonCommand(run, ["issue", "subscriber", "add", issue.id, "--output", "json"]);
    diagnostic.subscriber = summarizeCommandResult(subscriberResult);

    return {
      ok: true,
      pending: true,
      status: "pending",
      provider: providerFromAssistAgent(agent),
      assist: {
        agent: sanitizeAssistAgent(agent),
        issue,
      },
      assistChainId,
      assistRequestId,
      diagnostic: redactObject(diagnostic),
      warnings: subscriberResult.ok ? [] : ["assist_issue_subscribe_unavailable"],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function createAssistIssue({ run, title, promptFile, agent }) {
  const createArgs = [
    "issue",
    "create",
    "--title",
    title,
    "--description-file",
    promptFile,
    "--assignee-id",
    agent.id,
    "--allow-duplicate",
    "--priority",
    "low",
    "--output",
    "json",
  ];
  const createResult = await runJsonCommand(run, createArgs);
  const diagnostic = { create: summarizeCommandResult(createResult) };
  if (!createResult.ok) {
    return { ok: false, reason: classifyMulticaCommandFailure(createResult), diagnostic };
  }
  return { ok: true, issue: sanitizeIssue(createResult.data), diagnostic };
}

async function upsertAssistInboxIssue({ run, title, promptFile, agent }) {
  const found = await findAssistInboxIssue({ run, title });
  if (!found.ok) {
    return createAssistIssue({ run, title, promptFile, agent });
  }

  const updateResult = await runJsonCommand(run, [
    "issue",
    "update",
    found.issue.id,
    "--title",
    title,
    "--description-file",
    promptFile,
    "--assignee-id",
    agent.id,
    "--priority",
    "low",
    "--output",
    "json",
  ]);
  const rerunResult = updateResult.ok
    ? await runJsonCommand(run, ["issue", "rerun", found.issue.id, "--output", "json"])
    : null;
  const diagnostic = {
    search: found.diagnostic?.search,
    update: summarizeCommandResult(updateResult),
    rerun: rerunResult ? summarizeCommandResult(rerunResult) : undefined,
  };
  if (!updateResult.ok) {
    return { ok: false, reason: classifyMulticaCommandFailure(updateResult), diagnostic };
  }
  if (!rerunResult?.ok) {
    return { ok: false, reason: classifyMulticaCommandFailure(rerunResult ?? {}), diagnostic };
  }
  return {
    ok: true,
    issue: sanitizeIssue({ ...found.issue, ...updateResult.data }),
    diagnostic,
  };
}

async function findAssistInboxIssue({ run, title }) {
  const result = await runJsonCommand(run, ["issue", "search", title, "--limit", "5", "--include-closed", "--output", "json"]);
  const diagnostic = { search: summarizeCommandResult(result) };
  if (!result.ok) return { ok: false, diagnostic };
  const issues = extractCollection(result.data, ["issues", "items", "data"]).map(sanitizeIssue);
  const issue = issues.find((item) => item.title === title) || null;
  return issue?.id ? { ok: true, issue, diagnostic } : { ok: false, diagnostic };
}

async function invokeMulticaAgent({
  agent,
  cliPath,
  exec,
  timeoutMs,
  pollIntervalMs,
  sleep,
  title,
  prompt,
  parseResponse,
}) {
  if (!agent?.id) {
    return { ok: false, blocked: true, reason: "assist_agent_required", diagnostic: {} };
  }

  const run = exec ?? createMulticaExec({ cliPath, timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS });
  const tempDir = await mkdtemp(join(tmpdir(), "multica-agent-assist-"));
  const promptFile = join(tempDir, "prompt.md");
  const diagnostic = {
    agent: sanitizeAssistAgent(agent),
    issue: null,
    run: null,
  };

  try {
    await writeFile(promptFile, prompt, "utf8");
    const createArgs = [
      "issue",
      "create",
      "--title",
      title,
      "--description-file",
      promptFile,
      "--assignee-id",
      agent.id,
      "--allow-duplicate",
      "--priority",
      "low",
      "--output",
      "json",
    ];
    const createResult = await runJsonCommand(run, createArgs);
    diagnostic.create = summarizeCommandResult(createResult);
    if (!createResult.ok) {
      return blockedResult(classifyMulticaCommandFailure(createResult), diagnostic);
    }

    const issue = sanitizeIssue(createResult.data);
    diagnostic.issue = issue;
    if (!issue.id) {
      return blockedResult("multica_assist_issue_missing", diagnostic);
    }

    const runResult = await waitForAssistRun({
      run,
      issueId: issue.id,
      timeoutMs,
      pollIntervalMs,
      sleep,
    });
    diagnostic.run = runResult.run ?? null;
    diagnostic.poll = runResult.diagnostic;
    if (!runResult.ok) {
      return blockedResult(runResult.reason, diagnostic);
    }

    let parsed;
    try {
      parsed = parseResponse(runResult.output);
    } catch (error) {
      return blockedResult(error.code === "agent_non_json_output" ? "multica_agent_non_json_output" : "multica_agent_invalid_json", {
        ...diagnostic,
        parseError: error.message,
      });
    }

    return {
      ok: true,
      ...parsed,
      assist: {
        agent: sanitizeAssistAgent(agent),
        issue,
        run: runResult.run,
      },
      warnings: [],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function waitForAssistRun({ run, issueId, timeoutMs, pollIntervalMs, sleep }) {
  const startedAt = Date.now();
  let lastRunsResult = null;
  while (Date.now() - startedAt <= timeoutMs) {
    const runsResult = await runJsonCommand(run, ["issue", "runs", issueId, "--output", "json"]);
    lastRunsResult = runsResult;
    if (!runsResult.ok) {
      return {
        ok: false,
        reason: classifyMulticaCommandFailure(runsResult),
        diagnostic: summarizeCommandResult(runsResult),
      };
    }
    const runs = extractCollection(runsResult.data, ["runs", "items", "data"]).map(sanitizeRun);
    const latest = selectLatestRun(runs);
    if (!latest) {
      await sleep(pollIntervalMs);
      continue;
    }
    if (["failed", "error"].includes(latest.status)) {
      return { ok: false, reason: "multica_agent_run_failed", run: latest, diagnostic: { attempts: runs.length } };
    }
    if (["cancelled", "canceled"].includes(latest.status)) {
      return { ok: false, reason: "multica_agent_run_cancelled", run: latest, diagnostic: { attempts: runs.length } };
    }
    if (latest.status === "completed" || latest.status === "done") {
      let output = latest.output;
      if (!output) {
        output = await readRunMessagesOutput({ run, issueId, taskId: latest.id });
      }
      if (!String(output || "").trim()) {
        return { ok: false, reason: "multica_agent_output_missing", run: latest, diagnostic: { attempts: runs.length } };
      }
      return { ok: true, output, run: latest, diagnostic: { attempts: runs.length } };
    }
    await sleep(pollIntervalMs);
  }

  return {
    ok: false,
    reason: "multica_agent_timeout",
    diagnostic: {
      timeoutMs,
      lastRunsResult: summarizeCommandResult(lastRunsResult ?? {}),
    },
  };
}

async function readRunMessagesOutput({ run, issueId, taskId }) {
  if (!taskId) return "";
  const result = await runJsonCommand(run, ["issue", "run-messages", taskId, "--issue", issueId, "--output", "json"]);
  if (!result.ok) return "";
  const messages = extractCollection(result.data, ["messages", "items", "data"]);
  return messages.map((message) => (
    message?.text
    ?? message?.content
    ?? message?.message
    ?? message?.delta
    ?? message?.payload?.text
    ?? ""
  )).filter(Boolean).join("\n");
}

async function findAgentJsonOutput({ run, issueId, latest, assistRequestId = "" }) {
  const direct = parseAgentJsonCandidate(latest.output, assistRequestId);
  if (direct.ok) return { ...direct, source: "output" };
  const directFallback = parseAgentJsonCandidate(latest.output);
  if (directFallback.ok && !assistRequestId) return { ...directFallback, source: "output" };

  const messagesText = await readRunMessagesOutput({ run, issueId, taskId: latest.id });
  const messages = parseAgentJsonCandidate(messagesText, assistRequestId);
  if (messages.ok) return { ...messages, source: "messages" };
  const messagesFallback = parseAgentJsonCandidate(messagesText);
  if (messagesFallback.ok && !assistRequestId) return { ...messagesFallback, source: "messages" };

  const commentsPayload = await readIssueCommentsOutput({ run, issueId, since: latest.startedAt || latest.createdAt });
  const comments = parseAgentJsonCandidate(commentsPayload.text, assistRequestId);
  if (comments.ok) return { ...comments, source: "comments" };
  const commentsFallback = parseAgentJsonCandidate(commentsPayload.text);
  if (commentsFallback.ok && (!assistRequestId || commentsPayload.scoped)) {
    return { ...commentsFallback, source: "comments" };
  }

  return { ok: false, source: "" };
}

async function readIssueCommentsOutput({ run, issueId, since = "" }) {
  const args = ["issue", "comment", "list", issueId, "--output", "json"];
  if (since) args.push("--since", since);
  let result = await runJsonCommand(run, args);
  let scoped = Boolean(since);
  if (!result.ok && since) {
    result = await runJsonCommand(run, ["issue", "comment", "list", issueId, "--output", "json"]);
    scoped = false;
  }
  if (!result.ok) return { text: "", scoped: false };
  const comments = extractCollection(result.data, ["comments", "items", "data"]);
  return {
    text: comments.map((comment) => (
      comment?.content
      ?? comment?.text
      ?? comment?.message
      ?? ""
    )).filter(Boolean).join("\n"),
    scoped,
  };
}

function parseAgentJsonCandidate(rawText, assistRequestId = "") {
  try {
    const data = parseAgentJsonResponse(rawText);
    if (assistRequestId && data?.assistRequestId && data.assistRequestId !== assistRequestId) {
      return { ok: false };
    }
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

function rankAssistAgents(agents) {
  return agents
    .map((agent) => ({ ...agent, score: scoreAssistAgent(agent) }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map(({ score, ...agent }) => agent);
}

function scoreAssistAgent(agent) {
  const text = `${agent.name} ${agent.description} ${agent.role} ${agent.model}`.toLowerCase();
  let score = 0;
  if (agent.status === "idle") score += 100;
  if (agent.status === "running") score += 20;
  if (agent.runtimeMode === "local") score += 25;
  if (agent.runtimeStatus === "online") score += 25;
  if (/lead|leader|planner|architect|claude|计划|架构/.test(text)) score += 60;
  if (/review|reviewer|审查/.test(text)) score += 20;
  if (/full access|danger-full-access|worker|执行|implementation|codex full/.test(text)) score -= 80;
  if (agent.hasCustomEnv) score -= 5;
  return score;
}

function sanitizeAssistAgent(agent = {}, runtime = {}) {
  const runtimeId = String(agent.runtimeId ?? agent.runtime_id ?? runtime.id ?? "");
  return stripEmpty({
    id: String(agent.id ?? ""),
    name: redactText(agent.name ?? ""),
    description: truncate(redactText(agent.description ?? ""), 220),
    model: redactText(agent.model ?? runtime.model ?? ""),
    status: String(agent.status ?? ""),
    runtimeId,
    runtimeMode: String(agent.runtimeMode ?? agent.runtime_mode ?? runtime.runtimeMode ?? runtime.runtime_mode ?? ""),
    runtimeStatus: String(runtime.status ?? ""),
    runtimeProvider: String(runtime.provider ?? ""),
    runtimeName: redactText(runtime.name ?? ""),
    hasCustomEnv: Boolean(agent.has_custom_env ?? agent.hasCustomEnv),
    customEnvKeyCount: Number(agent.custom_env_key_count ?? agent.customEnvKeyCount ?? 0),
    visibility: String(agent.visibility ?? ""),
    source: "multica",
  });
}

function sanitizeRuntime(runtime = {}) {
  return stripEmpty({
    id: String(runtime.id ?? runtime.runtime_id ?? runtime.runtimeId ?? ""),
    name: redactText(runtime.name ?? ""),
    provider: String(runtime.provider ?? ""),
    model: redactText(runtime.model ?? ""),
    status: String(runtime.status ?? ""),
    runtimeMode: String(runtime.runtime_mode ?? runtime.runtimeMode ?? ""),
    deviceInfo: truncate(redactText(runtime.device_info ?? runtime.deviceInfo ?? ""), 160),
    version: redactText(runtime.metadata?.version ?? ""),
  });
}

function sanitizeIssue(issue = {}) {
  return stripEmpty({
    id: String(issue.id ?? ""),
    identifier: String(issue.identifier ?? issue.key ?? ""),
    number: issue.number ?? "",
    title: truncate(redactText(issue.title ?? ""), 220),
    status: String(issue.status ?? ""),
    assigneeId: String(issue.assignee_id ?? issue.assigneeId ?? ""),
    assigneeType: String(issue.assignee_type ?? issue.assigneeType ?? ""),
  });
}

function sanitizeRun(run = {}) {
  return stripEmpty({
    id: String(run.id ?? run.task_id ?? run.taskId ?? ""),
    status: String(run.status ?? ""),
    agentId: String(run.agent_id ?? run.agentId ?? ""),
    runtimeId: String(run.runtime_id ?? run.runtimeId ?? ""),
    kind: String(run.kind ?? ""),
    attempt: run.attempt ?? "",
    createdAt: String(run.created_at ?? run.createdAt ?? ""),
    startedAt: String(run.started_at ?? run.startedAt ?? ""),
    completedAt: String(run.completed_at ?? run.completedAt ?? ""),
    error: truncate(redactText(run.error ?? ""), 280),
    output: run.result?.output ? String(run.result.output) : "",
  });
}

function sanitizeRunForSummary(run = {}) {
  return stripEmpty({
    id: String(run.id ?? ""),
    status: String(run.status ?? ""),
    agentId: String(run.agentId ?? run.agent_id ?? ""),
    runtimeId: String(run.runtimeId ?? run.runtime_id ?? ""),
    kind: String(run.kind ?? ""),
    attempt: run.attempt ?? "",
    createdAt: String(run.createdAt ?? run.created_at ?? ""),
    startedAt: String(run.startedAt ?? run.started_at ?? ""),
    completedAt: String(run.completedAt ?? run.completed_at ?? ""),
    error: truncate(redactText(run.error ?? ""), 280),
  });
}

function selectLatestRun(runs) {
  if (!runs.length) return null;
  return runs.slice().sort((left, right) => {
    const leftTime = Date.parse(left.completedAt || left.startedAt || left.createdAt || 0) || 0;
    const rightTime = Date.parse(right.completedAt || right.startedAt || right.createdAt || 0) || 0;
    return rightTime - leftTime;
  })[0];
}

async function runTextCommand(exec, args) {
  try {
    const result = await exec(args);
    return {
      ok: result.code === 0,
      code: result.code,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      args,
    };
  } catch (error) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: error.message || String(error),
      args,
    };
  }
}

async function runJsonCommand(exec, args) {
  const result = await runTextCommand(exec, args);
  if (!result.ok) return result;
  try {
    return { ...result, data: JSON.parse(result.stdout || "null") };
  } catch (error) {
    return {
      ...result,
      ok: false,
      stderr: `invalid json: ${error.message}`,
    };
  }
}

async function runRetriedJsonCommand(exec, args, { retries, retryDelayMs, sleep }) {
  const attempts = [];
  const maxAttempts = Math.max(1, Number(retries ?? 0) + 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runJsonCommand(exec, args);
    attempts.push(result);
    if (result.ok || !isRetryableMulticaResult(result) || attempt >= maxAttempts) {
      if (attempts.length <= 1) return result;
      return {
        ...result,
        attempts: attempts.map(summarizeCommandResult),
      };
    }
    await sleep(Math.max(0, Number(retryDelayMs ?? 0)));
  }
  return attempts.at(-1) ?? { ok: false, code: 1, stdout: "", stderr: "retry failed", args };
}

function isRetryableMulticaResult(result) {
  return classifyMulticaCommandFailure(result) === "multica_api_network_failed";
}

function createMulticaExec({ cliPath = "multica", timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
  return (args) => new Promise((resolve, reject) => {
    const command = cliPath.endsWith(".js") || cliPath.endsWith(".mjs") ? process.execPath : cliPath;
    const commandArgs = command === cliPath ? args : [cliPath, ...args];
    const child = spawn(command, commandArgs, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut ? `command timed out after ${timeoutMs}ms` : stderr,
        code: timedOut ? 124 : code,
      });
    });
  });
}

function buildGoalClarificationPrompt({ request, context, language, assistChainId = "", assistRequestId = "" }) {
  const normalizedLanguage = normalizeLanguage(language);
  return [
    "You are a Multica Agent assisting Multica++ with Goal clarification.",
    "This assist issue is a real Multica task, but your output must be analysis only.",
    "Do not modify files, run write commands, create issues, update metadata, or change permissions.",
    "Return JSON only; no Markdown or prose outside JSON.",
    "Final JSON must be written directly to the final output; if you also use an issue comment, that comment must contain only the same JSON object.",
    "",
    ...buildLanguageContract(normalizedLanguage),
    "",
    "Raw user request:",
    String(request ?? ""),
    "",
    "Assist inbox identifiers:",
    JSON.stringify(stripEmpty({ assistChainId, assistRequestId }), null, 2),
    "",
    "Context JSON:",
    JSON.stringify(context ?? {}, null, 2),
    "",
    "Guardrails:",
    "- Produce a Goal draft only; do not generate Plan steps here.",
    "- If ambiguous, set status to draft and ask concrete clarification questions.",
    "- If actionable, set status to clarified and provide success criteria, scope, constraints, risks, and any remaining questions.",
    "- Do not expose, request, infer, copy, or log secrets.",
    "- Do not change public schema, permission boundaries, skills, metadata, or collaboration roles.",
    "- Include the exact assistRequestId value in the top-level JSON when provided; this lets Multica++ ignore stale inbox comments.",
    "",
    "Output JSON shape:",
    JSON.stringify({
      status: "clarified",
      title: "string",
      objective: "string",
      successCriteria: ["string"],
      scope: { in: ["string"], out: ["string"] },
      constraints: ["string"],
      risks: ["string"],
      clarificationQuestions: ["string"],
      confidence: "medium",
      assistRequestId: assistRequestId || "string",
    }, null, 2),
  ].join("\n");
}

function buildGoalPlanSplitPrompt({ goal, constraints, availableAgents, language, assistChainId = "", assistRequestId = "" }) {
  const normalizedLanguage = normalizeLanguage(language);
  return [
    "You are a Multica Agent assisting Multica++ with splitting one locked Goal into multiple parallel Plan drafts.",
    "This assist issue is a real Multica task, but your output must be analysis only.",
    "Do not modify files, run write commands, create issues, update metadata, or change permissions.",
    "Return JSON only; no Markdown or prose outside JSON.",
    "Final JSON must be written directly to the final output; if you also use an issue comment, that comment must contain only the same JSON object.",
    "",
    ...buildLanguageContract(normalizedLanguage),
    "",
    "Locked Goal JSON:",
    JSON.stringify(goal ?? {}, null, 2),
    "",
    "Assist inbox identifiers:",
    JSON.stringify(stripEmpty({ assistChainId, assistRequestId }), null, 2),
    "",
    "Available agents JSON:",
    JSON.stringify(availableAgents ?? [], null, 2),
    "",
    "Guardrails:",
    "- preview-first: produce draft plans and issue candidates only.",
    "- never silently write Multica state or call Multica CLI.",
    "- do not change public schema, permission boundaries, skills, metadata, or collaboration roles.",
    "- do not expose, request, infer, copy, or log secrets.",
    "- split into independent workstreams suitable for parallel review.",
    "- Include the exact assistRequestId value in the top-level JSON when provided; this lets Multica++ ignore stale inbox comments.",
    ...(Array.isArray(constraints) ? constraints.map((item) => `- ${item}`) : []),
    "",
    "Output JSON shape:",
    JSON.stringify({
      plans: [
        {
          title: "string",
          objective: "string",
          workstream: { id: "string", label: "string", reason: "string" },
          suggestedAgent: "string",
          dependencies: [],
          steps: [
            {
              title: "string",
              description: "string",
              dependencies: [],
              acceptanceEvidence: "string",
            },
          ],
          acceptanceEvidence: "string",
        },
      ],
      risks: ["string"],
      questions: ["string"],
      assistRequestId: assistRequestId || "string",
    }, null, 2),
  ].join("\n");
}

function buildAssistIssueTitle({ kind, assistChainId }) {
  const stable = String(assistChainId || "").trim();
  if (!stable) {
    return kind === "planSet"
      ? "Multica++ Assist · Goal to Plan split"
      : "Multica++ Assist · Goal clarification";
  }
  const suffix = stable.replace(/[^\w.-]+/g, "-").slice(0, 64);
  return kind === "planSet"
    ? `Multica++ Assist Inbox · PlanSet · ${suffix}`
    : `Multica++ Assist Inbox · Goal · ${suffix}`;
}

function normalizeLanguage(language) {
  return String(language || "zh-CN").toLowerCase() === "en-us" ? "en-US" : "zh-CN";
}

function buildLanguageContract(language) {
  if (language === "en-US") {
    return [
      "Output language: en-US",
      "All user-visible JSON values must be written in English.",
      "Keep JSON keys exactly as requested in the output shape; translate only values that humans will read.",
    ];
  }
  return [
    "Output language: zh-CN",
    "所有用户可见字段必须使用简体中文，包括 title、objective、successCriteria、scope、constraints、risks、clarificationQuestions、Plan steps、Issue candidate 文案。",
    "JSON key 必须保持输出格式中的英文 key；只翻译用户会看到的 value。",
  ];
}

function parseDaemonStatus(stdout) {
  const text = String(stdout ?? "");
  const status = /Daemon:\s+running/i.test(text) ? "running" : /Daemon:\s+stopped/i.test(text) ? "stopped" : "unknown";
  const version = text.match(/Version:\s+([^\r\n]+)/i)?.[1]?.trim() ?? "";
  return stripEmpty({ status, version });
}

function extractCollection(raw, keys) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}

function classifyMulticaCommandFailure(result = {}) {
  const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.toLowerCase();
  if (result.code === 124 || text.includes("timed out") || text.includes("timeout")) return "multica_agent_timeout";
  if (text.includes("not recognized") || text.includes("not found") || text.includes("enoent")) return "multica_cli_not_found";
  if (text.includes("duplicate") || text.includes("already exists")) return "multica_issue_duplicate_blocked";
  if (text.includes("auth") || text.includes("login") || text.includes("unauthorized") || text.includes("forbidden")) return "multica_auth_required";
  if (text.includes("daemon") && (text.includes("not running") || text.includes("unavailable"))) return "multica_daemon_unavailable";
  if (
    text.includes("api.multica.ai")
    || text.includes("eof")
    || text.includes("connection reset")
    || text.includes("tls handshake")
    || text.includes("dns")
    || text.includes("no such host")
    || text.includes("proxyconnect")
    || text.includes("i/o timeout")
  ) return "multica_api_network_failed";
  return "multica_cli_failed";
}

function blockedResult(reason, diagnostic) {
  return {
    ok: false,
    blocked: true,
    reason,
    diagnostic: redactObject(diagnostic),
  };
}

function summarizeCommandResult(result = {}) {
  const isJsonList = Array.isArray(result.args)
    && ((result.args[0] === "agent" && result.args[1] === "list")
      || (result.args[0] === "runtime" && result.args[1] === "list"));
  return stripEmpty({
    ok: Boolean(result.ok),
    code: result.code ?? "",
    stdoutExcerpt: isJsonList ? "__json_output_omitted__" : truncate(redactText(result.stdout ?? ""), 220),
    stderrExcerpt: truncate(redactText(result.stderr ?? ""), 220),
    argvSummary: Array.isArray(result.args) ? result.args.map((arg) => (String(arg).includes("\\") ? "__PATH__" : String(arg))) : undefined,
    attempts: Array.isArray(result.attempts) ? result.attempts : undefined,
  });
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function redactObject(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactObject);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
    } else if (item && typeof item === "object") {
      out[key] = redactObject(item);
    } else if (typeof item === "string") {
      out[key] = redactText(item);
    } else {
      out[key] = item;
    }
  }
  return out;
}

function redactText(value) {
  return String(value ?? "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(token|api[_-]?key|secret|password|cookie|credential)\s*[:=]\s*["']?[^"',\s)]+/gi, "$1=[redacted]");
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function stripEmpty(value) {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== null && item !== "") {
      out[key] = item;
    }
  }
  return out;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
