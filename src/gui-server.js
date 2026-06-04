import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import {
  applyAgentConfigPlan,
  buildImage2AgentConfigPlan,
  discoverMulticaEnvironment,
} from "./agent-config.js";

const DEFAULT_AUDIT_PATH = "out/agent-config-events.jsonl";
const IMAGE2_CONFIRMATION_TOKEN = "CREATE-MULTICA-IMAGE2-CODEX-AGENT";

export async function createGuiServer({
  host = "127.0.0.1",
  port = 8787,
  guiDir = "gui",
  auditPath = DEFAULT_AUDIT_PATH,
  cliPath = "multica",
  exec,
} = {}) {
  const root = resolve(guiDir);
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/api/agent-config/image2/create") {
        await handleImage2Create({ request, response, auditPath, cliPath, exec });
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

async function handleImage2Create({ request, response, auditPath, cliPath, exec }) {
  const body = await readJsonBody(request);
  if (body.confirm !== IMAGE2_CONFIRMATION_TOKEN) {
    sendJson(response, 403, {
      ok: false,
      error: `confirmation token required: ${IMAGE2_CONFIRMATION_TOKEN}`,
    });
    return;
  }

  const environment = await discoverMulticaEnvironment({ cliPath, exec });
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
