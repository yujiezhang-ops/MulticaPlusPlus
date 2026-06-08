# Contributing

中文开发约束见 [docs/development-constraints.zh-CN.md](docs/development-constraints.zh-CN.md)。
PR 前检查清单见 [docs/pr-checklist.zh-CN.md](docs/pr-checklist.zh-CN.md)。

## Required Workflow

1. Read the Chinese development constraints before changing code.
2. Keep Multica++ as an external governance/control layer; do not replace
   native Multica issue, agent, runtime, skills, MCP, or daemon behavior.
3. Write or update tests for behavior changes.
4. Run `npm test` before opening or updating a PR.
5. Update documentation and `CHANGELOG.md` for user-visible changes.

## Commit Messages

Use Conventional Commits:

```text
feat(goal-plan): add issue split preview
fix(gui): prevent permission panel overflow
docs(prd): clarify GUI-first boundary
test(cli): cover dry-run issue apply
```

Use `!` or `BREAKING CHANGE:` for incompatible public behavior changes.

## Safety Defaults

- CLI writes must default to dry-run.
- Real Multica writes must require `--execute` and a command-specific
  confirmation token.
- Secrets must never be written to logs, audit records, snapshots, comments, or
  PR descriptions.
- Schema, permission, skill, metadata, and system-instruction changes require a
  documented decision and human confirmation.
