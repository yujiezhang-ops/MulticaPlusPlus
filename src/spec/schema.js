import { z } from "zod";

export const schemaVersion = "multica.launch_review.v1";

const defaultSpec = {
  schemaVersion,
  specId: "",
  status: "draft",
  createdAt: "",
  goal: "",
  workspace: {
    id: "",
    name: "",
    repos: [],
  },
  task: {
    kind: "issue_assignment",
    taskId: "",
    issueId: "",
    triggerCommentId: "",
    triggerComment: "",
    prompt: "",
    autopilotId: "",
    autopilotRunId: "",
    autopilotSource: "",
    triggerPayload: null,
  },
  agent: {
    id: "",
    name: "",
  },
  runtime: {
    runtimeId: "",
    provider: "",
    model: "",
  },
  skills: [],
  instructionOverlay: {
    reviewStatus: "pending",
    layers: [],
    diff: "",
  },
  capabilityReview: {
    repos: [],
    envKeys: [],
    secretEnvKeys: [],
    mcpServers: [],
    riskFlags: [],
  },
  permissions: {
    tokenType: "mat_task_scoped",
    ttlMinutes: 1440,
    scopes: [],
  },
  initialPlan: [],
};

export const RuntimeAgentSpecSchema = createRuntimeAgentSpecSchema();

export function validateRuntimeAgentSpec(spec) {
  const issues = [];
  const schema = createRuntimeAgentSpecSchema(issues);
  return {
    spec: schema.parse(spec),
    issues,
  };
}

function createRuntimeAgentSpecSchema(issues = []) {
  const defaultValue = (value) => (Array.isArray(value) || isPlainObject(value) ? () => structuredClone(value) : value);
  const cloneFallback = (value) => (Array.isArray(value) || isPlainObject(value) ? structuredClone(value) : value);
  const fallback = (schema, value) => schema.default(defaultValue(value)).catch((context) => {
    issues.push(...context.error.issues);
    return cloneFallback(value);
  });
  const fallbackArray = (schema, value = []) => schema.default(() => value.slice()).catch((context) => {
    issues.push(...context.error.issues);
    return value.slice();
  });

  const stringField = fallback(z.string(), "");
  const stringArray = fallbackArray(z.array(z.string()));
  const repo = z.object({
    url: stringField,
  }).strip();
  const repoArray = fallbackArray(z.array(repo));
  const skill = z.object({
    name: stringField,
    version: stringField,
    description: stringField,
    permissions: stringArray,
    riskLevel: fallback(z.enum(["unknown", "low", "medium", "high", "critical"]), "unknown"),
  }).strip();
  const overlayLayer = z.object({
    name: stringField,
    content: stringField,
  }).strip();

  return z.object({
    schemaVersion: fallback(z.literal(schemaVersion), schemaVersion),
    specId: stringField,
    status: fallback(z.enum(["draft", "approved", "rejected"]), "draft"),
    createdAt: stringField,
    goal: stringField,
    workspace: fallback(z.object({
      id: stringField,
      name: stringField,
      repos: repoArray,
    }).strip(), defaultSpec.workspace),
    task: fallback(z.object({
      kind: fallback(z.enum(["issue_assignment", "comment_mention", "autopilot"]), "issue_assignment"),
      taskId: stringField,
      issueId: stringField,
      triggerCommentId: stringField,
      triggerComment: stringField,
      prompt: stringField,
      autopilotId: stringField,
      autopilotRunId: stringField,
      autopilotSource: stringField,
      triggerPayload: z.unknown().nullable().default(null),
    }).strip(), defaultSpec.task),
    agent: fallback(z.object({
      id: stringField,
      name: stringField,
    }).strip(), defaultSpec.agent),
    runtime: fallback(z.object({
      runtimeId: stringField,
      provider: stringField,
      model: stringField,
    }).strip(), defaultSpec.runtime),
    skills: fallbackArray(z.array(skill)),
    instructionOverlay: fallback(z.object({
      reviewStatus: fallback(z.enum(["pending", "approved", "rejected"]), "pending"),
      layers: fallbackArray(z.array(overlayLayer)),
      diff: stringField,
    }).strip(), defaultSpec.instructionOverlay),
    capabilityReview: fallback(z.object({
      repos: repoArray,
      envKeys: stringArray,
      secretEnvKeys: stringArray,
      mcpServers: stringArray,
      riskFlags: stringArray,
    }).strip(), defaultSpec.capabilityReview),
    permissions: fallback(z.object({
      tokenType: fallback(z.string(), "mat_task_scoped"),
      ttlMinutes: fallback(z.number().nonnegative(), 1440),
      scopes: stringArray,
    }).strip(), defaultSpec.permissions),
    initialPlan: stringArray,
  }).strip().default(defaultValue(defaultSpec)).catch((context) => {
    issues.push(...context.error.issues);
    return structuredClone(defaultSpec);
  });
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
