import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

import {
  applyAgentConfigPlan,
  buildImage2AgentConfigPlan,
  discoverMulticaEnvironment,
} from "./agent-config.js";
import {
  buildAgentConfigPlanFromPreset,
  buildTeamPresetFromEnvironment,
  listAgentPresets,
  mergePresetOverrides,
} from "./agent-preset.js";
import {
  applyIssueSplit,
  generatePlanFromGoal,
  lockGoalDraft,
  normalizeGoal,
  normalizeGoalWithAgent,
  normalizeGoalWithLlm,
  previewIssueSplit,
  previewIssueSplitFromPlanSet,
  splitGoalIntoPlansWithAgent,
  splitGoalIntoPlansWithLlm,
} from "./goal-plan.js";
import { diagnoseLlmProvider, discoverLlmProviders, readLlmSecretMetadata } from "./llm-assist.js";
import {
  checkMulticaAgentAssistResult,
  diagnoseAssistAgents,
  discoverAssistAgents,
  selectAssistAgent,
  providerFromAssistAgent,
  startMulticaAgentForGoalClarification,
  startMulticaAgentForPlanSplit,
} from "./multica-agent-assist.js";

const DEFAULT_AUDIT_PATH = "out/agent-config-events.jsonl";
const IMAGE2_CONFIRMATION_TOKEN = "CREATE-MULTICA-IMAGE2-CODEX-AGENT";
const PRESET_CONFIRMATION_TOKEN = "CREATE-MULTICA-AGENT-FROM-PRESET";
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;
const DEFAULT_DISCOVERY_RETRIES = 0;

export async function createGuiServer({
  host = "127.0.0.1",
  port = 8787,
  guiDir = "gui",
  auditPath = DEFAULT_AUDIT_PATH,
  cliPath = "multica",
  discoveryTimeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  discoveryRetries = DEFAULT_DISCOVERY_RETRIES,
  exec,
  llmProviderConfig = {},
  llmEnv = process.env,
  llmHomeDir,
  llmCommandExists,
  llmPathExists,
  llmExec,
  assistExec,
} = {}) {
  const root = resolve(guiDir);
  const sessionTeamPresets = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/api/agent-config/image2/create") {
        await handleImage2Create({
          request,
          response,
          auditPath,
          cliPath,
          discoveryTimeoutMs,
          discoveryRetries,
          exec,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/goal/normalize") {
        await handleGoalNormalize({
          request,
          response,
          auditPath,
          cliPath,
          assistExec: assistExec ?? exec,
          llmProviderConfig,
          llmEnv,
          llmHomeDir,
          llmCommandExists,
          llmPathExists,
          llmExec,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/goal/lock") {
        await handleGoalLock({ request, response, auditPath });
        return;
      }
      if (request.method === "POST" && request.url === "/api/plan/generate") {
        await handlePlanGenerate({ request, response, auditPath });
        return;
      }
      if (request.method === "POST" && request.url === "/api/plan/preview-issues") {
        await handleIssueSplitPreview({ request, response, auditPath });
        return;
      }
      if (request.method === "POST" && request.url === "/api/plan/apply-issues") {
        await handleIssueSplitApply({
          request,
          response,
          auditPath,
          cliPath,
          exec,
        });
        return;
      }
      if (request.method === "GET" && requestPathname(request) === "/api/llm/providers") {
        await handleLlmProviders({
          request,
          response,
          auditPath,
          llmProviderConfig,
          llmEnv,
          llmHomeDir,
          llmCommandExists,
          llmPathExists,
        });
        return;
      }
      if (request.method === "GET" && requestPathname(request) === "/api/assist/agents") {
        await handleAssistAgents({
          response,
          auditPath,
          cliPath,
          assistExec: assistExec ?? exec,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/assist/diagnose") {
        await handleAssistDiagnose({
          response,
          auditPath,
          cliPath,
          assistExec: assistExec ?? exec,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/assist/result") {
        await handleAssistResult({
          request,
          response,
          auditPath,
          cliPath,
          assistExec: assistExec ?? exec,
        });
        return;
      }
      if (request.method === "GET" && requestPathname(request) === "/api/assist/subscribe") {
        await handleAssistSubscribe({
          request,
          response,
          auditPath,
          cliPath,
          assistExec: assistExec ?? exec,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/llm/diagnose") {
        await handleLlmDiagnose({
          request,
          response,
          auditPath,
          llmProviderConfig,
          llmEnv,
          llmHomeDir,
          llmCommandExists,
          llmPathExists,
          llmExec,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/llm/secret-metadata") {
        await handleLlmSecretMetadata({
          request,
          response,
          auditPath,
          llmProviderConfig,
          llmEnv,
          llmHomeDir,
          llmPathExists,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/plan/split") {
        await handlePlanSplit({
          request,
          response,
          auditPath,
          cliPath,
          assistExec: assistExec ?? exec,
          llmProviderConfig,
          llmEnv,
          llmHomeDir,
          llmCommandExists,
          llmPathExists,
          llmExec,
        });
        return;
      }
      if (request.method === "GET" && request.url === "/api/agent-presets") {
        sendJson(response, 200, { ok: true, presets: listSessionPresets(sessionTeamPresets) });
        return;
      }
      if (request.method === "POST" && request.url === "/api/agent-presets") {
        await handleTeamPresetCreate({ request, response, sessionTeamPresets });
        return;
      }
      const presetMatch = request.url?.match(/^\/api\/agent-presets\/([^/]+)\/(plan|create)$/);
      if (request.method === "POST" && presetMatch) {
        await handlePresetAction({
          request,
          response,
          auditPath,
          cliPath,
          discoveryTimeoutMs,
          discoveryRetries,
          exec,
          sessionTeamPresets,
          presetId: decodeURIComponent(presetMatch[1]),
          action: presetMatch[2],
        });
        return;
      }
      if (request.method === "GET" || request.method === "HEAD") {
        await serveStatic({ request, response, root });
        return;
      }
      sendJson(response, 405, { ok: false, error: "method not allowed" });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message || String(error) });
    }
  });

  await new Promise((resolveListen) => server.listen(port, host, resolveListen));
  const address = server.address();
  return {
    host,
    port: typeof address === "object" && address ? address.port : port,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

async function handleImage2Create({
  request,
  response,
  auditPath,
  cliPath,
  discoveryTimeoutMs,
  discoveryRetries,
  exec,
}) {
  const body = await readJsonBody(request);
  if (body.confirm !== IMAGE2_CONFIRMATION_TOKEN) {
    sendJson(response, 403, {
      ok: false,
      error: `confirmation token required: ${IMAGE2_CONFIRMATION_TOKEN}`,
    });
    return;
  }

  const environment = await discoverMulticaEnvironment({
    cliPath,
    exec,
    timeoutMs: discoveryTimeoutMs,
    retries: discoveryRetries,
  });
  const plan = buildImage2AgentConfigPlan({
    environment,
    skillPath: body.skillPath,
  });
  const result = await applyAgentConfigPlan({
    plan,
    cliPath,
    exec,
    execute: true,
    confirm: IMAGE2_CONFIRMATION_TOKEN,
  });

  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "image2_agent_create",
    status: result.ok ? "success" : "failed",
    target: plan.target?.name ?? "Multica++ Image2 Codex Agent",
    target_agent_id: result.targetAgentId ?? "",
    skill_id: result.skillIds?.paigodImagegen ?? "",
    summary: result.ok
      ? "Created or updated Image2 Codex Agent and bound paigod-imagegen skill."
      : result.error ?? "Image2 agent creation failed.",
    operation_types: plan.operations?.map((operation) => operation.type) ?? [],
    warnings: result.warnings ?? [],
  });

  sendJson(response, result.ok ? 200 : 500, {
    ok: result.ok,
    plan: summarizePlan(plan),
    result,
  });
}

async function handleGoalNormalize({
  request,
  response,
  auditPath,
  cliPath,
  assistExec,
  llmProviderConfig,
  llmEnv,
  llmHomeDir,
  llmCommandExists,
  llmPathExists,
  llmExec,
}) {
  const body = await readJsonBody(request);
  const language = normalizeRequestLanguage(body);
  if (body.mode === "agent") {
    const discovery = await discoverAssistAgents({ cliPath, exec: assistExec });
    const selection = selectAssistAgent({
      agents: discovery.agents ?? [],
      preferredAgentId: body.assist?.agentId,
      mode: body.assist?.selectionMode || (body.assist?.agentId ? "manual" : "auto"),
    });
    if (!discovery.ok || !selection.ok) {
      const reason = discovery.ok ? (selection.reason || "no_assist_agent") : (discovery.reason || "multica_cli_failed");
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "goal_normalization_blocked",
        mode: "agent",
        status: "blocked",
        blocked_reason: reason,
        agent_count: discovery.agents?.length ?? 0,
        language,
      });
      sendJson(response, 200, {
        ok: false,
        blocked: true,
        reason,
        agents: discovery.agents ?? [],
        daemon: discovery.daemon,
        diagnostic: discovery.diagnostic,
      });
      return;
    }

    if (body.async === true) {
      const assistIds = normalizeAssistIds({
        kind: "goal",
        body,
        seed: body.request,
      });
      const start = await startMulticaAgentForGoalClarification({
        request: body.request,
        context: { ...(body.context ?? {}), language },
        agent: selection.selectedAgent,
        language,
        assistChainId: assistIds.chainId,
        assistRequestId: assistIds.requestId,
        cliPath,
        exec: assistExec,
      });
      if (!start?.ok) {
        await appendAuditEvent(auditPath, {
          timestamp: new Date().toISOString(),
          source: "gui-server",
          event_type: "goal_normalization_blocked",
          mode: "agent",
          status: "blocked",
          blocked_reason: start.reason ?? "multica_agent_goal_clarification_failed",
          agent_id: selection.selectedAgent?.id ?? "",
          agent_name: selection.selectedAgent?.name ?? "",
          issue_id: start.diagnostic?.issue?.id ?? "",
          assist_chain_id: assistIds.chainId,
          assist_request_id: assistIds.requestId,
          language,
        });
        sendJson(response, 200, start);
        return;
      }
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "goal_normalization_assist_started",
        mode: "agent",
        status: "pending",
        agent_id: start.assist?.agent?.id ?? selection.selectedAgent?.id ?? "",
        agent_name: start.assist?.agent?.name ?? selection.selectedAgent?.name ?? "",
        issue_id: start.assist?.issue?.id ?? "",
        issue_identifier: start.assist?.issue?.identifier ?? "",
        assist_chain_id: assistIds.chainId,
        assist_request_id: assistIds.requestId,
        language,
      });
      sendJson(response, 200, start);
      return;
    }

    const goal = await normalizeGoalWithAgent({
      request: body.request,
      context: { ...(body.context ?? {}), language },
      agent: selection.selectedAgent,
      language,
      cliPath,
      exec: assistExec,
      timeoutMs: body.assist?.timeoutMs,
    });
    if (goal?.blocked) {
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "goal_normalization_blocked",
        mode: "agent",
        status: "blocked",
        blocked_reason: goal.reason ?? "multica_agent_goal_clarification_failed",
        agent_id: selection.selectedAgent?.id ?? "",
        agent_name: selection.selectedAgent?.name ?? "",
        issue_id: goal.diagnostic?.issue?.id ?? "",
        run_id: goal.diagnostic?.run?.id ?? "",
        language,
      });
      sendJson(response, 200, goal);
      return;
    }

    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "goal_normalized",
      mode: "agent",
      status: goal.status,
      target: goal.id,
      summary: goal.title,
      agent_id: goal.assist?.agent?.id ?? selection.selectedAgent?.id ?? "",
      agent_name: goal.assist?.agent?.name ?? selection.selectedAgent?.name ?? "",
      issue_id: goal.assist?.issue?.id ?? "",
      issue_identifier: goal.assist?.issue?.identifier ?? "",
      run_id: goal.assist?.run?.id ?? "",
      clarification_question_count: goal.clarificationQuestions?.length ?? 0,
      language,
    });
    sendJson(response, 200, { ok: true, goal, assist: goal.assist });
    return;
  }

  if (body.mode === "llm") {
    const discovery = await discoverLlmProviders({
      userConfig: { ...llmProviderConfig, ...(body.llm ?? body.llmConfig ?? {}) },
      env: llmEnv,
      homeDir: llmHomeDir,
      commandExists: llmCommandExists,
      pathExists: llmPathExists,
    });
    if (!discovery.selectedProvider) {
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "goal_normalization_blocked",
        status: "blocked",
        blocked_reason: "no_llm_provider",
        candidate_count: discovery.candidates?.length ?? 0,
        language,
      });
      sendJson(response, 200, {
        ok: false,
        blocked: true,
        reason: "no_llm_provider",
        candidates: discovery.candidates ?? [],
      });
      return;
    }

    const goal = await normalizeGoalWithLlm({
      request: body.request,
      context: body.context,
      language,
      provider: discovery.selectedProvider,
      invokeLlm: llmExec
        ? ({ provider, request, context }) => import("./llm-assist.js").then(({ invokeLlmForGoalClarification }) => invokeLlmForGoalClarification({
          provider,
          request,
          context: { ...(context ?? {}), language },
          language,
          exec: llmExec,
        }))
        : undefined,
    });
    if (goal?.blocked) {
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "goal_normalization_blocked",
        status: "blocked",
        provider_source: discovery.selectedProvider?.source ?? "",
        provider_kind: discovery.selectedProvider?.kind ?? "",
        provider_version: discovery.selectedProvider?.version ?? "",
        model: discovery.selectedProvider?.model ?? "",
        blocked_reason: goal.reason ?? "llm_goal_clarification_failed",
        exit_code: goal.diagnostic?.result?.code ?? "",
        stderr_excerpt: goal.diagnostic?.result?.stderrExcerpt ?? "",
        language,
      });
      sendJson(response, 200, goal);
      return;
    }

    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "goal_normalized",
      mode: "llm",
      status: goal.status,
      target: goal.id,
      summary: goal.title,
      provider_source: discovery.selectedProvider?.source ?? "",
      provider_kind: discovery.selectedProvider?.kind ?? "",
      provider_version: discovery.selectedProvider?.version ?? "",
      model: discovery.selectedProvider?.model ?? "",
      clarification_question_count: goal.clarificationQuestions?.length ?? 0,
      language,
    });
    sendJson(response, 200, { ok: true, goal });
    return;
  }

  const goal = normalizeGoal({
    request: body.request,
    context: { ...(body.context ?? {}), language },
    language,
  });
  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "goal_normalized",
    mode: "deterministic",
    status: goal.status,
    target: goal.id,
    summary: goal.title,
    clarification_questions: goal.clarificationQuestions,
    language,
  });
  sendJson(response, 200, { ok: true, goal });
}

async function handleAssistAgents({
  response,
  auditPath,
  cliPath,
  assistExec,
}) {
  const discovery = await discoverAssistAgents({ cliPath, exec: assistExec });
  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "assist_agents_discovered",
    status: discovery.status,
    selected_agent_id: discovery.selectedAgent?.id ?? "",
    selected_agent_name: discovery.selectedAgent?.name ?? "",
    agent_count: discovery.agents?.length ?? 0,
    daemon_status: discovery.daemon?.status ?? "",
  });
  sendJson(response, 200, { ok: true, ...discovery });
}

async function handleAssistDiagnose({
  response,
  auditPath,
  cliPath,
  assistExec,
}) {
  const diagnosis = await diagnoseAssistAgents({ cliPath, exec: assistExec });
  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "assist_agents_diagnosed",
    status: diagnosis.ok ? "ready" : "blocked",
    selected_agent_id: diagnosis.selectedAgent?.id ?? "",
    selected_agent_name: diagnosis.selectedAgent?.name ?? "",
    blocked_reason: diagnosis.reason ?? "",
    agent_count: diagnosis.agents?.length ?? 0,
    daemon_status: diagnosis.daemon?.status ?? "",
  });
  sendJson(response, 200, diagnosis);
}

async function handleAssistResult({
  request,
  response,
  auditPath,
  cliPath,
  assistExec,
}) {
  const body = await readJsonBody(request);
  const language = normalizeRequestLanguage(body);
  const kind = body.kind === "planSet" ? "planSet" : "goal";
  const issueId = body.issueId || body.assist?.issue?.id || "";
  const checked = await checkMulticaAgentAssistResult({
    kind,
    issueId,
    assistRequestId: body.assistRequestId || body.assist?.requestId || "",
    agent: body.agent || body.assist?.agent,
    cliPath,
    exec: assistExec,
  });

  if (checked?.pending) {
    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "assist_result_polled",
      status: "pending",
      kind,
      issue_id: issueId,
      run_id: checked.assist?.run?.id ?? "",
      poll_count: body.pollCount ?? "",
      assist_request_id: body.assistRequestId || body.assist?.requestId || "",
      language,
    });
    sendJson(response, 200, checked);
    return;
  }

  if (!checked?.ok) {
    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "assist_result_polled",
      status: "blocked",
      kind,
      issue_id: issueId,
      run_id: checked?.diagnostic?.run?.id ?? "",
      blocked_reason: checked?.reason ?? "multica_agent_result_failed",
      output_source: checked?.diagnostic?.outputSource ?? "",
      poll_count: body.pollCount ?? "",
      assist_request_id: body.assistRequestId || body.assist?.requestId || "",
      language,
    });
    sendJson(response, 200, checked);
    return;
  }

  if (kind === "goal") {
    const goal = await normalizeGoalWithLlm({
      request: body.request,
      context: { ...(body.context ?? {}), language },
      language,
      provider: providerFromAssistAgent(body.agent || checked.assist?.agent || {}),
      invokeLlm: async () => ({
        ok: true,
        goalDraft: checked.goalDraft,
        assist: checked.assist,
        warnings: [],
        diagnostic: checked.diagnostic,
      }),
    });
    if (goal?.blocked) {
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "assist_result_polled",
        status: "blocked",
        kind,
        issue_id: issueId,
        run_id: checked.assist?.run?.id ?? "",
        blocked_reason: goal.reason ?? "multica_agent_invalid_json",
        output_source: checked.diagnostic?.outputSource ?? "",
        language,
      });
      sendJson(response, 200, goal);
      return;
    }
    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "assist_result_completed",
      status: goal.status,
      kind,
      target: goal.id,
      summary: goal.title,
      issue_id: checked.assist?.issue?.id ?? issueId,
      issue_identifier: checked.assist?.issue?.identifier ?? "",
      run_id: checked.assist?.run?.id ?? "",
      agent_id: checked.assist?.agent?.id ?? "",
      agent_name: checked.assist?.agent?.name ?? "",
      output_source: checked.diagnostic?.outputSource ?? "",
      assist_request_id: body.assistRequestId || body.assist?.requestId || "",
      clarification_question_count: goal.clarificationQuestions?.length ?? 0,
      language,
    });
    sendJson(response, 200, {
      ok: true,
      status: "completed",
      goal,
      assist: checked.assist,
      diagnostic: checked.diagnostic,
    });
    return;
  }

  const planSet = await splitGoalIntoPlansWithLlm({
    goal: body.lockedGoal || body.goal,
    provider: providerFromAssistAgent(body.agent || checked.assist?.agent || {}),
    availableAgents: body.availableAgents ?? [],
    language,
    invokeLlm: async () => ({
      ok: true,
      planSetDraft: checked.planSetDraft,
      assist: checked.assist,
      warnings: [],
      diagnostic: checked.diagnostic,
    }),
  });
  if (planSet?.blocked) {
    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "assist_result_polled",
      status: "blocked",
      kind,
      issue_id: issueId,
      run_id: checked.assist?.run?.id ?? "",
      blocked_reason: planSet.reason ?? "multica_agent_invalid_json",
      output_source: checked.diagnostic?.outputSource ?? "",
      language,
    });
    sendJson(response, 200, planSet);
    return;
  }

  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "assist_result_completed",
    status: planSet.status,
    kind,
    target: planSet.id,
    goal_id: planSet.goalId,
    issue_id: checked.assist?.issue?.id ?? issueId,
    issue_identifier: checked.assist?.issue?.identifier ?? "",
    run_id: checked.assist?.run?.id ?? "",
    agent_id: checked.assist?.agent?.id ?? "",
    agent_name: checked.assist?.agent?.name ?? "",
      output_source: checked.diagnostic?.outputSource ?? "",
      assist_request_id: body.assistRequestId || body.assist?.requestId || "",
      plan_count: planSet.plans?.length ?? 0,
      language,
  });

  sendJson(response, 200, {
    ok: true,
    status: "completed",
    planSet,
    assist: checked.assist,
    diagnostic: checked.diagnostic,
  });
}

async function handleAssistSubscribe({
  request,
  response,
  auditPath,
  cliPath,
  assistExec,
}) {
  const url = new URL(request.url, "http://localhost");
  const kind = url.searchParams.get("kind") === "planSet" ? "planSet" : "goal";
  const issueId = url.searchParams.get("issueId") || "";
  const assistRequestId = url.searchParams.get("assistRequestId") || "";
  const language = normalizeRequestLanguage({ language: url.searchParams.get("language") || "zh-CN" });
  const intervalMs = boundedNumber(url.searchParams.get("intervalMs"), 5000, 1000, 60000);
  const timeoutMs = boundedNumber(url.searchParams.get("timeoutMs"), 600000, 30000, 1800000);
  const startedAt = Date.now();
  let closed = false;
  let pollCount = 0;

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const writeEvent = (event, data) => {
    if (closed || response.destroyed) return;
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  request.on("close", () => {
    closed = true;
  });

  writeEvent("ready", {
    ok: true,
    status: "subscribed",
    kind,
    issueId,
    assistRequestId,
    intervalMs,
  });

  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "assist_issue_subscribed",
    status: "subscribed",
    kind,
    issue_id: issueId,
    assist_request_id: assistRequestId,
    interval_ms: intervalMs,
    language,
  });

  while (!closed && Date.now() - startedAt <= timeoutMs) {
    pollCount += 1;
    const checked = await checkMulticaAgentAssistResult({
      kind,
      issueId,
      assistRequestId,
      cliPath,
      exec: assistExec,
    });
    if (checked?.pending) {
      writeEvent("pending", {
        ok: true,
        pending: true,
        status: "pending",
        kind,
        issueId,
        assist: checked.assist,
        diagnostic: checked.diagnostic,
        pollCount,
      });
    } else if (!checked?.ok) {
      writeEvent("blocked", {
        ...checked,
        kind,
        issueId,
        pollCount,
      });
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "assist_issue_subscription_finished",
        status: "blocked",
        kind,
        issue_id: issueId,
        run_id: checked?.diagnostic?.run?.id ?? "",
        blocked_reason: checked?.reason ?? "multica_agent_result_failed",
        output_source: checked?.diagnostic?.outputSource ?? "",
        poll_count: pollCount,
        language,
      });
      response.end();
      return;
    } else {
      writeEvent("completed", {
        ...checked,
        kind,
        issueId,
        pollCount,
      });
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "assist_issue_subscription_finished",
        status: "completed",
        kind,
        issue_id: issueId,
        run_id: checked.assist?.run?.id ?? "",
        output_source: checked.diagnostic?.outputSource ?? "",
        poll_count: pollCount,
        language,
      });
      response.end();
      return;
    }
    await delay(intervalMs);
  }

  if (!closed) {
    writeEvent("blocked", {
      ok: false,
      blocked: true,
      reason: "multica_agent_timeout",
      kind,
      issueId,
      pollCount,
      diagnostic: { timeoutMs },
    });
    response.end();
  }
}

async function handleGoalLock({ request, response, auditPath }) {
  const body = await readJsonBody(request);
  const goal = lockGoalDraft(body.goal, { approvedBy: body.approvedBy });
  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "goal_locked",
    status: goal.status,
    target: goal.id,
    summary: goal.title,
    approved_by: goal.approvedBy,
  });
  sendJson(response, 200, { ok: true, goal });
}

async function handlePlanGenerate({ request, response, auditPath }) {
  const body = await readJsonBody(request);
  const language = normalizeRequestLanguage(body);
  const plan = generatePlanFromGoal({
    goal: body.goal,
    complexity: body.complexity,
    availableAgents: body.availableAgents,
    language,
  });
  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "plan_generated",
    status: plan.status,
    target: plan.id,
    goal_id: plan.goalId,
    summary: `Generated ${plan.complexity} plan with ${plan.steps.length} steps.`,
    issue_split_recommendation: plan.issueSplitRecommendation,
    language,
  });
  sendJson(response, 200, { ok: true, plan });
}

async function handleIssueSplitPreview({ request, response, auditPath }) {
  const body = await readJsonBody(request);
  const language = normalizeRequestLanguage(body);
  const hasPlan = Boolean(body.plan);
  const hasPlanSet = Boolean(body.planSet);
  if (hasPlan === hasPlanSet) {
    sendJson(response, 400, { ok: false, error: "provide exactly one of plan or planSet" });
    return;
  }
  const issueSplit = hasPlanSet
    ? previewIssueSplitFromPlanSet({
      goal: body.goal,
      planSet: body.planSet,
      projectId: body.projectId,
      priority: body.priority,
      language,
    })
    : previewIssueSplit({
      goal: body.goal,
      plan: body.plan,
      projectId: body.projectId,
      priority: body.priority,
      language,
    });
  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "issue_split_previewed",
    status: issueSplit.mode,
    target: issueSplit.id,
    goal_id: body.goal?.id ?? "",
    plan_id: body.plan?.id ?? "",
    plan_set_id: body.planSet?.id ?? "",
    summary: issueSplit.summary,
    issue_count: issueSplit.issues.length,
    language,
  });
  sendJson(response, 200, { ok: true, issueSplit });
}

async function handleIssueSplitApply({ request, response, auditPath, cliPath, exec }) {
  const body = await readJsonBody(request);
  const execute = body.execute === true;
  const issueSplit = body.issueSplit;

  try {
    const result = execute
      ? await applyIssueSplitWithGuiCli({
        issueSplit,
        cliPath,
        exec,
        confirm: body.confirm,
      })
      : await applyIssueSplit({
        issueSplit,
        execute: false,
      });

    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "issue_split_apply",
      status: result.ok ? (execute ? "success" : "planned") : "failed",
      mode: result.mode,
      issue_split_id: issueSplit?.id ?? "",
      issue_count: issueSplit?.issues?.length ?? 0,
      created_issue_ids: result.createdIssues?.map((issue) => issue.id || issue.identifier).filter(Boolean) ?? [],
      operation_count: result.operations?.length ?? 0,
      error: result.ok ? "" : result.error ?? "",
    });

    sendJson(response, result.ok ? 200 : 500, { ok: result.ok, result });
  } catch (error) {
    const message = error.message || String(error);
    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "issue_split_apply",
      status: "blocked",
      mode: execute ? "execute" : "dry-run",
      issue_split_id: issueSplit?.id ?? "",
      issue_count: issueSplit?.issues?.length ?? 0,
      error: message,
    });
    sendJson(response, message.includes("confirmation token required") ? 403 : 500, {
      ok: false,
      error: message,
    });
  }
}

async function applyIssueSplitWithGuiCli({ issueSplit, cliPath, exec, confirm }) {
  const tempDir = await mkdtemp(join(tmpdir(), "multica-gui-issue-split-"));
  try {
    return await applyIssueSplit({
      issueSplit,
      execute: true,
      confirm,
      exec: exec ?? createGuiCliExec({ cliPath }),
      writeDescriptionFile: async (issue, index) => {
        const path = join(tempDir, `issue-${index + 1}.md`);
        await writeFile(path, issue.description ?? "", "utf8");
        return path;
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function handleLlmProviders({
  request,
  response,
  auditPath,
  llmProviderConfig,
  llmEnv,
  llmHomeDir,
  llmCommandExists,
  llmPathExists,
}) {
  const requestConfig = readLlmConfigFromQuery(request);
  const discovery = await discoverLlmProviders({
    userConfig: { ...llmProviderConfig, ...requestConfig },
    env: llmEnv,
    homeDir: llmHomeDir,
    commandExists: llmCommandExists,
    pathExists: llmPathExists,
  });
  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "llm_providers_discovered",
    status: discovery.status,
    provider_source: discovery.selectedProvider?.source ?? "",
    provider_kind: discovery.selectedProvider?.kind ?? "",
    provider_version: discovery.selectedProvider?.version ?? "",
    model: discovery.selectedProvider?.model ?? "",
    candidate_count: discovery.candidates?.length ?? 0,
  });
  sendJson(response, 200, { ok: true, ...discovery });
}

async function handleLlmDiagnose({
  request,
  response,
  auditPath,
  llmProviderConfig,
  llmEnv,
  llmHomeDir,
  llmCommandExists,
  llmPathExists,
  llmExec,
}) {
  const body = await readJsonBody(request);
  const discovery = await discoverLlmProviders({
    userConfig: { ...llmProviderConfig, ...(body.llm ?? body.llmConfig ?? {}) },
    env: llmEnv,
    homeDir: llmHomeDir,
    commandExists: llmCommandExists,
    pathExists: llmPathExists,
  });
  if (!discovery.selectedProvider) {
    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "llm_provider_diagnosed",
      status: "blocked",
      blocked_reason: "no_llm_provider",
      candidate_count: discovery.candidates?.length ?? 0,
    });
    sendJson(response, 200, {
      ok: false,
      blocked: true,
      reason: "no_llm_provider",
      candidates: discovery.candidates ?? [],
    });
    return;
  }

  const diagnosis = await diagnoseLlmProvider({
    provider: discovery.selectedProvider,
    probe: Boolean(body.probe),
    exec: llmExec ?? undefined,
    env: llmEnv,
    pathExists: llmPathExists,
  });
  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "llm_provider_diagnosed",
    status: diagnosis.ok ? "ready" : "blocked",
    provider_source: discovery.selectedProvider?.source ?? "",
    provider_kind: discovery.selectedProvider?.kind ?? "",
    provider_version: discovery.selectedProvider?.version ?? "",
    model: discovery.selectedProvider?.model ?? "",
    blocked_reason: diagnosis.reason ?? "",
    exit_code: diagnosis.diagnostic?.help?.code ?? diagnosis.diagnostic?.invocation?.result?.code ?? "",
  });
  sendJson(response, 200, {
    ok: diagnosis.ok,
    status: diagnosis.status,
    blocked: diagnosis.blocked,
    reason: diagnosis.reason,
    provider: discovery.selectedProvider,
    diagnostic: diagnosis.diagnostic,
  });
}

async function handleLlmSecretMetadata({
  request,
  response,
  auditPath,
  llmProviderConfig,
  llmEnv,
  llmHomeDir,
  llmPathExists,
}) {
  const body = await readJsonBody(request);
  const providerConfig = { ...llmProviderConfig, ...(body.llm ?? body.llmConfig ?? {}) };
  const provider = providerConfig.provider || providerConfig.command
    ? {
      provider: providerConfig.provider,
      kind: providerConfig.provider,
      command: providerConfig.command,
      model: providerConfig.model,
      source: "user-config",
    }
    : { kind: "codex", provider: "codex", source: "default" };
  const result = await readLlmSecretMetadata({
    provider,
    confirm: body.confirm,
    env: llmEnv,
    homeDir: llmHomeDir,
    pathExists: llmPathExists,
  });

  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "llm_secret_metadata_read",
    status: result.ok ? "success" : "blocked",
    provider: result.provider ?? provider.kind ?? provider.provider ?? "",
    blocked_reason: result.reason ?? "",
    risk: "secret-metadata-redacted",
    entries: (result.metadata ?? []).map((item) => ({
      provider: item.provider,
      keyName: item.keyName,
      pathHint: item.sourcePathHint,
      present: item.present,
      fingerprint: item.fingerprint,
      status: item.present ? "present" : "missing",
    })),
  });

  sendJson(response, result.ok ? 200 : 403, result);
}

async function handlePlanSplit({
  request,
  response,
  auditPath,
  cliPath,
  assistExec,
  llmProviderConfig,
  llmEnv,
  llmHomeDir,
  llmCommandExists,
  llmPathExists,
  llmExec,
}) {
  const body = await readJsonBody(request);
  const language = normalizeRequestLanguage(body);
  if (body.mode === "agent") {
    const discovery = await discoverAssistAgents({ cliPath, exec: assistExec });
    const selection = selectAssistAgent({
      agents: discovery.agents ?? [],
      preferredAgentId: body.assist?.agentId,
      mode: body.assist?.selectionMode || (body.assist?.agentId ? "manual" : "auto"),
    });
    if (!discovery.ok || !selection.ok) {
      const reason = discovery.ok ? (selection.reason || "no_assist_agent") : (discovery.reason || "multica_cli_failed");
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "plan_set_generation_blocked",
        mode: "agent",
        status: "blocked",
        goal_id: body.goal?.id ?? "",
        blocked_reason: reason,
        agent_count: discovery.agents?.length ?? 0,
        language,
      });
      sendJson(response, 200, {
        ok: false,
        blocked: true,
        reason,
        agents: discovery.agents ?? [],
        daemon: discovery.daemon,
        diagnostic: discovery.diagnostic,
      });
      return;
    }

    if (body.async === true) {
      const assistIds = normalizeAssistIds({
        kind: "planSet",
        body,
        seed: body.goal?.id || body.goal?.objective || body.goal?.title,
      });
      const start = await startMulticaAgentForPlanSplit({
        goal: body.goal,
        agent: selection.selectedAgent,
        availableAgents: body.availableAgents ?? [],
        language,
        assistChainId: assistIds.chainId,
        assistRequestId: assistIds.requestId,
        cliPath,
        exec: assistExec,
      });
      if (!start?.ok) {
        await appendAuditEvent(auditPath, {
          timestamp: new Date().toISOString(),
          source: "gui-server",
          event_type: "plan_set_generation_blocked",
          mode: "agent",
          status: "blocked",
          goal_id: body.goal?.id ?? "",
          blocked_reason: start.reason ?? "multica_agent_plan_split_failed",
          agent_id: selection.selectedAgent?.id ?? "",
          agent_name: selection.selectedAgent?.name ?? "",
          issue_id: start.diagnostic?.issue?.id ?? "",
          assist_chain_id: assistIds.chainId,
          assist_request_id: assistIds.requestId,
          language,
        });
        sendJson(response, 200, start);
        return;
      }
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "plan_set_assist_started",
        mode: "agent",
        status: "pending",
        goal_id: body.goal?.id ?? "",
        agent_id: start.assist?.agent?.id ?? selection.selectedAgent?.id ?? "",
        agent_name: start.assist?.agent?.name ?? selection.selectedAgent?.name ?? "",
        issue_id: start.assist?.issue?.id ?? "",
        issue_identifier: start.assist?.issue?.identifier ?? "",
        assist_chain_id: assistIds.chainId,
        assist_request_id: assistIds.requestId,
        language,
      });
      sendJson(response, 200, start);
      return;
    }

    const planSet = await splitGoalIntoPlansWithAgent({
      goal: body.goal,
      agent: selection.selectedAgent,
      availableAgents: body.availableAgents ?? [],
      language,
      cliPath,
      exec: assistExec,
      timeoutMs: body.assist?.timeoutMs,
    });
    if (planSet?.blocked) {
      await appendAuditEvent(auditPath, {
        timestamp: new Date().toISOString(),
        source: "gui-server",
        event_type: "plan_set_generation_blocked",
        mode: "agent",
        status: "blocked",
        goal_id: body.goal?.id ?? "",
        blocked_reason: planSet.reason ?? "multica_agent_plan_split_failed",
        agent_id: selection.selectedAgent?.id ?? "",
        agent_name: selection.selectedAgent?.name ?? "",
        issue_id: planSet.diagnostic?.issue?.id ?? "",
        run_id: planSet.diagnostic?.run?.id ?? "",
        language,
      });
      sendJson(response, 200, planSet);
      return;
    }

    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "plan_set_generated",
      mode: "agent",
      status: planSet.status,
      target: planSet.id,
      goal_id: planSet.goalId,
      agent_id: planSet.assist?.agent?.id ?? selection.selectedAgent?.id ?? "",
      agent_name: planSet.assist?.agent?.name ?? selection.selectedAgent?.name ?? "",
      issue_id: planSet.assist?.issue?.id ?? "",
      issue_identifier: planSet.assist?.issue?.identifier ?? "",
      run_id: planSet.assist?.run?.id ?? "",
      plan_count: planSet.plans?.length ?? 0,
      summary: `Generated ${planSet.plans?.length ?? 0} Multica Agent assisted sub-plans.`,
      language,
    });

    sendJson(response, 200, { ok: true, planSet, assist: planSet.assist });
    return;
  }

  if (body.mode !== "llm") {
    sendJson(response, 400, { ok: false, error: "unsupported plan split mode" });
    return;
  }
  const discovery = await discoverLlmProviders({
    userConfig: { ...llmProviderConfig, ...(body.llm ?? body.llmConfig ?? {}) },
    env: llmEnv,
    homeDir: llmHomeDir,
    commandExists: llmCommandExists,
    pathExists: llmPathExists,
  });
  if (!discovery.selectedProvider) {
    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "plan_set_generation_blocked",
      status: "blocked",
      goal_id: body.goal?.id ?? "",
        blocked_reason: "no_llm_provider",
        candidate_count: discovery.candidates?.length ?? 0,
        language,
      });
    sendJson(response, 200, {
      ok: false,
      blocked: true,
      reason: "no_llm_provider",
      candidates: discovery.candidates ?? [],
    });
    return;
  }

  const planSet = await splitGoalIntoPlansWithLlm({
    goal: body.goal,
    provider: discovery.selectedProvider,
    availableAgents: body.availableAgents ?? [],
    language,
    invokeLlm: llmExec
      ? ({ provider, goal, constraints }) => import("./llm-assist.js").then(({ invokeLlmForGoalPlanSplit }) => invokeLlmForGoalPlanSplit({
        provider,
        goal,
        constraints,
        language,
        exec: llmExec,
      }))
      : undefined,
  });
  if (planSet?.blocked) {
    await appendAuditEvent(auditPath, {
      timestamp: new Date().toISOString(),
      source: "gui-server",
      event_type: "plan_set_generation_blocked",
      status: "blocked",
      goal_id: body.goal?.id ?? "",
      provider_source: discovery.selectedProvider?.source ?? "",
      provider_kind: discovery.selectedProvider?.kind ?? "",
      provider_version: discovery.selectedProvider?.version ?? "",
      model: discovery.selectedProvider?.model ?? "",
      blocked_reason: planSet.reason ?? "llm_plan_split_failed",
      exit_code: planSet.diagnostic?.result?.code ?? "",
      stderr_excerpt: planSet.diagnostic?.result?.stderrExcerpt ?? "",
      language,
    });
    sendJson(response, 200, planSet);
    return;
  }

  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "plan_set_generated",
    status: planSet.status,
    target: planSet.id,
    goal_id: planSet.goalId,
    provider_source: planSet.provider?.source ?? "",
    provider_kind: planSet.provider?.kind ?? "",
    provider_version: planSet.provider?.version ?? "",
    model: planSet.provider?.model ?? "",
    plan_count: planSet.plans?.length ?? 0,
    summary: `Generated ${planSet.plans?.length ?? 0} LLM-assisted sub-plans.`,
    language,
  });

  sendJson(response, 200, { ok: true, planSet });
}

async function handlePresetAction({
  request,
  response,
  auditPath,
  cliPath,
  discoveryTimeoutMs,
  discoveryRetries,
  exec,
  sessionTeamPresets,
  presetId,
  action,
}) {
  const body = await readJsonBody(request);
  if (action === "create" && body.confirm !== PRESET_CONFIRMATION_TOKEN) {
    sendJson(response, 403, {
      ok: false,
      error: `confirmation token required: ${PRESET_CONFIRMATION_TOKEN}`,
    });
    return;
  }

  const basePreset = listSessionPresets(sessionTeamPresets).find((preset) => preset.id === presetId);
  if (!basePreset) {
    sendJson(response, 404, { ok: false, error: `unknown preset: ${presetId}` });
    return;
  }

  const preset = mergePresetOverrides(basePreset, body.overrides ?? {});
  const environment = await discoverMulticaEnvironment({
    cliPath,
    exec,
    timeoutMs: discoveryTimeoutMs,
    retries: discoveryRetries,
  });
  const plan = buildAgentConfigPlanFromPreset({ environment, preset });
  if (action === "plan") {
    sendJson(response, plan.ok ? 200 : 500, {
      ok: plan.ok,
      error: plan.ok ? null : plan.error,
      preset,
      plan,
    });
    return;
  }

  const result = await applyAgentConfigPlan({
    plan,
    cliPath,
    exec,
    execute: true,
    confirm: plan.confirmationToken,
  });

  await appendAuditEvent(auditPath, {
    timestamp: new Date().toISOString(),
    source: "gui-server",
    event_type: "agent_preset_create",
    status: result.ok ? "success" : "failed",
    preset_id: preset.id,
    preset_source: preset.source,
    target: plan.target?.name ?? preset.agent?.name ?? preset.name,
    target_agent_id: result.targetAgentId ?? "",
    summary: result.ok
      ? "Created or updated Multica agent from preset."
      : result.error ?? "Preset agent creation failed.",
    operation_types: plan.operations?.map((operation) => operation.type) ?? [],
    warnings: result.warnings ?? [],
  });

  sendJson(response, result.ok ? 200 : 500, {
    ok: result.ok,
    preset,
    plan: summarizePlan(plan),
    result,
  });
}

async function handleTeamPresetCreate({ request, response, sessionTeamPresets }) {
  const body = await readJsonBody(request);
  const preset = buildTeamPresetFromEnvironment({
    ...body,
    source: "team",
    target: "agent",
  });
  sessionTeamPresets.push(preset);
  sendJson(response, 201, { ok: true, preset });
}

function listSessionPresets(sessionTeamPresets) {
  return [
    ...listAgentPresets(),
    ...sessionTeamPresets,
  ];
}

function requestPathname(request) {
  return new URL(request.url, "http://localhost").pathname;
}

function readLlmConfigFromQuery(request) {
  const url = new URL(request.url, "http://localhost");
  const command = url.searchParams.get("command") || "";
  const model = url.searchParams.get("model") || "";
  const timeoutMs = url.searchParams.get("timeoutMs") || "";
  const provider = url.searchParams.get("provider") || inferProviderFromCommand(command);
  return {
    provider,
    command,
    model,
    timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
  };
}

function inferProviderFromCommand(command) {
  const text = String(command || "").toLowerCase();
  if (text.includes("claude")) return "claude";
  if (text.includes("codex")) return "codex";
  return "";
}

async function serveStatic({ request, response, root }) {
  const url = new URL(request.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = resolve(root, normalize(pathname).replace(/^[/\\]+/, ""));
  if (!target.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": mimeType(target) });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function appendAuditEvent(path, event) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await appendFile(path, JSON.stringify(redact(event)) + "\n", "utf8");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function createGuiCliExec({ cliPath = "multica", timeoutMs = 30000 } = {}) {
  return (args) => new Promise((resolveExec, rejectExec) => {
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectExec);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveExec({
        stdout,
        stderr: timedOut ? `command timed out after ${timeoutMs}ms` : stderr,
        code: timedOut ? 124 : code,
      });
    });
  });
}

function summarizePlan(plan) {
  return {
    ok: plan.ok,
    mode: plan.mode,
    target: plan.target ? {
      id: plan.target.id,
      name: plan.target.name,
      runtimeId: plan.target.runtimeId,
      model: plan.target.model,
    } : null,
    skill: plan.skill,
    operations: plan.operations?.map((operation) => ({
      type: operation.type,
      summary: operation.summary,
    })) ?? [],
    warnings: plan.warnings ?? [],
  };
}

function redact(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api_key|cookie|credential/i.test(key)) {
      out[key] = "[redacted]";
    } else if (item && typeof item === "object") {
      out[key] = redact(item);
    } else {
      out[key] = item;
    }
  }
  return out;
}

function normalizeRequestLanguage(body = {}) {
  return String(body.language || body.context?.language || "zh-CN").toLowerCase() === "en-us" ? "en-US" : "zh-CN";
}

function normalizeAssistIds({ kind, body = {}, seed = "" }) {
  const chainId = body.assist?.chainId
    || body.assistChainId
    || `assist_${kind}_${stableHash(String(seed || kind))}`;
  const requestId = body.assist?.requestId
    || body.assistRequestId
    || `request_${Date.now().toString(36)}_${stableHash(`${chainId}:${JSON.stringify(body.goal ?? body.request ?? {})}:${Date.now()}`)}`;
  return { chainId, requestId };
}

function stableHash(value) {
  const input = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function mimeType(path) {
  const ext = extname(path).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  }[ext] ?? "application/octet-stream";
}

export async function main() {
  const args = parseServerArgs(process.argv.slice(2));
  const server = await createGuiServer(args);
  process.stdout.write(`Multica++ GUI server listening at http://${server.host}:${server.port}/\n`);
}

function parseServerArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      parsed.host = argv[++index];
    } else if (arg === "--port") {
      parsed.port = Number(argv[++index]);
    } else if (arg === "--audit-path") {
      parsed.auditPath = argv[++index];
    } else if (arg === "--cli-path") {
      parsed.cliPath = argv[++index];
    } else if (arg === "--gui-dir") {
      parsed.guiDir = argv[++index];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
