# Multica Monitoring Records

This directory is the local record store for the core Multica monitoring
session. Use it to preserve monitoring updates, configuration decisions,
permission reviews, skill changes, system-level instruction changes, and
important CLI snapshots.

## Directory Layout

```text
ops/monitoring/
├── README.md
├── events.jsonl
├── updates/
│   └── YYYY-MM-DD.md
├── snapshots/
│   └── .gitkeep
└── backups/
    └── .gitkeep
```

## Update Rules

1. Add a Markdown entry to `updates/YYYY-MM-DD.md` for every meaningful
   monitoring or orchestration update.
2. Append one JSON object line to `events.jsonl` for the same update.
3. Save raw CLI output under `snapshots/` when the exact state may be needed for
   review or replay.
4. Save a copy under `backups/` before changing permissions, skills,
   system-level instructions, schemas, or collaboration policy.
5. Keep secret values out of records. Record secret key names only when needed.

## Markdown Entry Format

Use this structure for daily notes:

```markdown
## HH:mm - Short title

- Operator/session:
- Monitoring target:
- Commands:
- Findings:
- Result summary:
- Follow-up:
```

## JSONL Event Format

Each line in `events.jsonl` must be a complete JSON object with these fields:

```json
{"timestamp":"2026-06-02T00:00:00+08:00","source":"codex-monitoring-session","event_type":"monitoring_update","target":"multica","command":"multica issue list --limit 50 --output json","summary":"Summarize the observed state.","status":"recorded","snapshot_path":null,"notes":"No secrets recorded."}
```

Use `snapshot_path` as a repository-relative path when a raw snapshot exists;
otherwise use `null`.
