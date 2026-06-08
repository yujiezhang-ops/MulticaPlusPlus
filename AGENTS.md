# Multica Monitoring Session

This repository uses this Codex session as the core monitoring and orchestration
session for Multica multi-agent work.

## Role

- Monitor Multica agent, issue, squad, runtime, daemon, skill, and permission
  state through the `multica` CLI.
- Keep local records for monitoring updates, configuration changes, permission
  decisions, skill changes, and system-level instruction changes.
- Generate and review launch artifacts through this repository's
  `multica-launch-review` workflow when preparing agent runs.
- Prefer read-only inspection first. Any change to permissions, skills,
  system-level instructions, schema, or collaboration boundaries must be recorded
  and confirmed by a human before execution.

## Collaboration Rules

- Claude owns overall architecture, schema decisions, cross-file consistency
  review, and high-impact collaboration policy decisions.
- Codex owns local implementation, focused CLI integration, tests, debugging,
  and monitoring record maintenance within agreed boundaries.
- Codex must not change public schemas, permission boundaries, or collaboration
  roles without an explicit decision record.
- Review handoffs must include what changed, what was checked, open risks, and
  follow-up actions.
- Future development must follow `docs/development-constraints.zh-CN.md` and
  `docs/pr-checklist.zh-CN.md`.
- Prefer the local Codex skill
  `C:\Users\PPIO\.codex\skills\multica-plusplus-dev-guardrails\SKILL.md`
  for the compact guardrail checklist before code/doc changes.
- User-visible changes must update `CHANGELOG.md` under `Unreleased`.

## Monitoring Commands

Use these commands as the default read-only monitoring baseline:

```powershell
multica daemon status
multica agent list --output json
multica issue list --limit 50 --output json
multica squad list --output json
multica runtime list --output json
multica skill list --output json
npm test
```

Store notable command results under `ops/monitoring/snapshots/` and summarize
them in `ops/monitoring/updates/YYYY-MM-DD.md`. Append structured events to
`ops/monitoring/events.jsonl`.

## Local Records

- `ops/monitoring/README.md` defines the record layout and update rules.
- `ops/monitoring/updates/` contains human-readable daily monitoring notes.
- `ops/monitoring/events.jsonl` contains one JSON event per monitoring update.
- `ops/monitoring/snapshots/` stores CLI output snapshots.
- `ops/monitoring/backups/` stores local backups before important policy or
  configuration changes.
