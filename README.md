# Multica Launch Review

中文版说明: [README.zh-CN.md](README.zh-CN.md)

External pre-run initialization layer for Multica agent tasks.

This project does not fork Multica or replace its issue board, runtime daemon,
skill registry, or autopilot system. It generates a reviewable Runtime Agent
Spec before a task is launched, so a user can inspect the goal, runtime, skills,
instruction overlays, capabilities, permission scopes, and initial plan.

## Local GUI Prototype

This branch also includes a static GUI-first prototype at `gui/index.html`.
It is a local mock control console for reviewing `Goal`, `Plan`, and
one-click agent permission setup before real integration work.

The prototype is intentionally limited:

- It uses mock data only.
- It does not call the `multica` CLI.
- It does not write Multica metadata or create issues.
- It does not add a frontend build chain or runtime dependency.

## What It Produces

- `Runtime Agent Spec`: a stable JSON snapshot for one agent run.
- `Instruction Overlay Diff`: workspace, agent, task, comment, and autopilot
  instruction layers rendered as a review diff.
- `Capability And Permission Review`: repos, env keys, secret-like env keys,
  MCP servers, task token type, scopes, and risk flags.
- `Goal/Plan Ledger Lite`: JSONL events for `draft -> locked -> running ->
  completed`.

## Usage

Create an input JSON file:

```json
{
  "goal": "Fix the checkout retry bug",
  "task": {
    "kind": "issue_assignment",
    "taskId": "task-1",
    "issueId": "MUL-123",
    "prompt": "Fix retry behavior and add tests."
  },
  "workspace": {
    "id": "ws-1",
    "name": "Core",
    "context": "Prefer small changes.",
    "repos": [{ "url": "https://github.com/acme/shop" }]
  },
  "agent": {
    "id": "agent-1",
    "name": "Fixer",
    "runtimeId": "runtime-1",
    "provider": "codex",
    "model": "gpt-5-codex",
    "instructions": "Use tests first.",
    "skills": [
      {
        "name": "bug-fixer",
        "version": "1.0.0",
        "permissions": ["repo:write", "shell:write"],
        "riskLevel": "high"
      }
    ],
    "customEnv": {
      "ANTHROPIC_API_KEY": "secret"
    },
    "mcpServers": ["filesystem"]
  },
  "permissions": {
    "tokenType": "mat_task_scoped",
    "ttlMinutes": 1440,
    "scopes": ["workspace:read", "issue:comment", "repo:write"]
  },
  "plan": ["Read issue and comments", "Patch retry code", "Run tests"]
}
```

Generate review artifacts:

```bash
node src/cli.js \
  --input examples/issue-assignment.json \
  --spec-out out/spec.json \
  --review-out out/review.md \
  --ledger out/ledger.jsonl
```

If no output files are supplied, the launch review markdown is printed to
stdout.

Generate a spec from read-only Multica data:

```bash
node src/cli.js from-multica \
  --issue-id MUL-123 \
  --agent-id agent-uuid \
  --workspace-name Core \
  --repo https://github.com/acme/shop \
  --spec-out out/spec.json \
  --review-out out/review.md
```

## Intended Integration

Use this as a pre-submit or pre-launch step around Multica:

1. Collect the task description, selected agent, runtime, workspace context,
   project repos, skills, env keys, MCP servers, and intended permission scopes.
2. Generate a draft Runtime Agent Spec and review markdown.
3. Have a human review instruction diffs and high-risk capability flags.
4. Lock the ledger entry.
5. Create or dispatch the Multica issue/task using the locked spec as the
   launch record.

The MVP is intentionally external. A deeper integration can later store this
spec near Multica's task claim flow, but that becomes an upstream PR or fork.

## Development

```bash
npm test
```
