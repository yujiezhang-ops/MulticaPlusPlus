# Changelog

All notable changes to this project are recorded here.

The format follows Keep a Changelog, and this project uses Semantic Versioning
once public releases are cut.

## [Unreleased]

### Added

- Added Chinese development constraints for future Multica++ work.
- Added a PR checklist covering scope, security, tests, docs, and review notes.
- Added contributor guidance for Conventional Commits, dry-run defaults, and
  secret handling.
- Added local Codex skill guidance for compact Multica++ development guardrails.
- Added a reserved GUI language setting for Chinese-first UI with an English
  entry held for a future copy pack.
- Added LLM-assisted `locked Goal -> multiple Plan` splitting through local
  Codex / Claude Agent CLI providers, with blocked behavior when no provider is
  available.
- Added GUI and CLI provider discovery for LLM-assisted splitting without
  reading or logging secrets.
- Added real local Agent CLI invocation for LLM-assisted splitting, including
  Codex read-only ephemeral `--output-schema` plus `--output-last-message`
  final-response parsing and Claude no-session `--json-schema` structured
  result parsing with tools disabled.
- Added LLM provider readiness diagnostics for CLI and GUI, including sanitized
  command failure classification without logging prompts or secrets.
- Added LLM-assisted Goal clarification through the same local Codex / Claude
  Agent CLI bridge used by Plan splitting, with blocked responses instead of
  silent deterministic fallback when the provider is unavailable or invalid.
- Added explicit, token-gated local LLM secret metadata reading for Codex /
  Claude settings. The API, CLI, GUI, and audit log return only redacted
  provider/path/key/fingerprint summaries and never raw keys.
- Added Multica Agent assist as the default Goal clarification and Goal to
  multi-Plan backend, with CLI discovery through `assist agents`, GUI
  `/api/assist/agents`, and audit records for assist issue/run ids.
- Added language-aware Goal/Plan/Issue generation defaults. GUI and CLI now
  pass `zh-CN` by default into Multica Agent assist prompts and local issue
  previews so visible Plan and Issue text matches the current UI language.
- Added browser-local GUI workflow draft persistence so clarified Goals,
  locked Goals, generated Plans, Agent-assisted PlanSets, and Issue previews
  survive a page refresh without storing secrets or confirmation tokens.
- Added fixed Multica Agent assist inbox issues for Goal and PlanSet chains.
  GUI starts now subscribe to the same assist issue via a local SSE bridge,
  recover pending work after refresh, and read final JSON from run output,
  run messages, or agent comments without creating a duplicate assist task.
- Added the GUI business `Plan/PlanSet -> Issue preview -> confirmed Issue
  create` flow, including `/api/plan/apply-issues`, confirmation token gating,
  created issue result display, and browser-local recovery of the preview.
- Added a local Issue subscription table for Goal assist issues, Plan split
  assist issues, and created business issues. The GUI server stores it under
  `out/issue-subscriptions.json`, exposes aggregate sync APIs, and syncs only
  through read-only Multica issue/list/runs/comment commands.
- Added per-candidate business Issue creation from the GUI preview cards,
  including `创建此 Issue`, copy-command, open/copy-created-id controls, and
  batch creation that skips candidates already created in the current preview.
- Rewrote the root `README.md` as a Chinese-first quick-start user manual for
  the GUI Goal -> Plan -> Issue workflow, subscription tracking, CLI commands,
  and write-safety boundaries.
- Added a GUI topbar `隐藏内容` control that temporarily hides the current
  workspace panels without deleting browser-local Goal, Plan, Issue, or
  subscription draft state.
- Added browser-local workflow records in the GUI `记录` page, with view,
  new-flow, and delete-record actions that do not modify Multica.
- Added per-subscription GUI actions for pause/resume, temporary hide, local
  removal, and token-gated real Issue closing via
  `multica issue status <id> cancelled --output json`.
- Added a GUI follow-up clarification loop for draft Goals, with visible
  clarification questions, a supplemental answer field, and resubmission through
  `context.clarification`.
- Added `/api/assist/reply` so draft Goal follow-up answers are posted to the
  existing Assist Issue inbox and re-subscribed instead of creating a second
  Goal clarification issue.
- Added browser-local multi-workflow pending Assist tracking. Multiple Goal or
  Plan assist issues can now run concurrently, and completed results are written
  back to their owning workflow record instead of overwriting the current flow.
- Added `DESIGN.md` as the desktop-first Multica++ GUI design system, documenting
  Chinese-first copy, desktop workspace constraints, low-saturation gradients,
  transitional cards, and Multica write-safety boundaries.

### Changed

- Switched the static GUI shell and core interaction copy to Chinese-first
  labels while preserving CLI commands, product terms, and write boundaries.
- Changed the GUI `记录` page from a single long vertical stack into a compact
  dashboard with overview metrics, workflow-record cards, subscription lanes,
  and a secondary page-event panel.
- Refined the `记录` page using the installed Stitch `design-md` guidance:
  subscription lanes now keep readable text width, avoid single-character
  wrapping, and move row actions below the subscription summary on narrow cards.
- Started the first desktop-first GUI refactor: the console now uses a wider
  workbench canvas, low-saturation status gradients, transitional management
  cards, and a clearer Records dashboard hierarchy while keeping mobile as a
  no-overflow fallback rather than the primary target.
- Changed the Control page into a journey-driven execution surface with a
  four-step `输入/澄清 Goal -> 锁定 Goal -> 生成 Plan -> 预览并创建 Issue`
  rail, a single current-action banner, compact Goal summaries, and folded
  Goal/Plan/Issue write details to reduce small-text overload.
- Redesigned the Records page `Issue 执行跟踪` section from three scrolling
  subscription lanes into an attention-first workbench with compact metrics,
  type/status filters, local search, a single subscription list, and a selected
  Issue detail panel for secondary and dangerous actions.
- Removed visible pause/resume controls from the Records subscription workbench
  so narrow external-browser layouts keep only the current high-value issue
  actions: view, hide, local remove, and token-gated close.
- Extended Plan issue preview to support `planSet` inputs with one issue
  candidate per parallel sub-plan.
- Split the GUI `Permissions` page from the `Control` page so Goal/Plan and
  one-click Agent permission configuration are no longer stacked together.
- Clarified the GUI Goal flow as `Goal -> Plan -> Issue`, with Issue shown as a
  Plan preview candidate rather than a direct Goal child.
- Changed the GUI `澄清目标` action to request LLM mode by default and surface
  provider/auth/model diagnostics when clarification is blocked.
- Changed Codex LLM bridge invocation to preserve non-secret `model_provider`,
  `model`, `base_url`, `wire_api`, and auth-mode settings while running
  `codex exec` with isolated user config, avoiding unrelated remote plugin
  catalog authentication failures during Goal/Plan LLM calls.
- Changed GUI and CLI `--llm` Goal/Plan assist defaults to route through
  Multica CLI Agent assist. Clicking Agent assist now creates a real Multica
  assist issue/task, while business Issue creation remains preview-first.
- Changed GUI Agent assist start to return pending immediately. The browser
  stores the assist issue id and request id, subscribes to that issue's inbox
  results, and finalizes the local Goal/PlanSet only after JSON is readable.
- Changed PlanSet handling so `预览业务 Issue` maps each parallel sub-plan to
  one business Issue candidate before any Multica write is allowed.
- Changed PlanSet business Issue descriptions to carry the locked Goal context,
  subPlan objective/workstream/agent/dependencies/steps/acceptance evidence, and
  fixed safety boundaries instead of a generic Goal/Plan template.
- Changed deterministic Plan, issue preview summaries/descriptions, and
  Goal/Plan review Markdown to render in the requested language while keeping
  JSON keys and schemas stable.
- Increased the GUI Multica Agent assist default run timeout to 300000ms so
  real Goal clarification and Plan splitting runs do not time out before the
  core assist backend default.
- Moved GUI `Issue 执行跟踪` subscription management from the Plan page into
  the `记录` page, where it now sits with browser-local workflow records. The
  Plan page keeps only the Goal -> Plan -> Issue execution path and a compact
  Records-page entry.
- Kept draft Goals un-lockable while making the blocked state actionable:
  users now answer clarification questions and rerun Goal normalization instead
  of being left with only a disabled `锁定目标` button.
- Changed GUI draft Goal follow-up submission to use the current Assist Issue
  reply/comment path before falling back to a fresh normalization only when no
  assist inbox issue exists.

### Fixed

- Fixed the GUI `新建流程` action so the Control page Goal summary switches to
  an empty `尚未澄清 Goal` state and clears the request input instead of falling
  back to the built-in demo Goal.
- Added `--allow-duplicate` to Multica Agent assist issue creation for the
  compatibility path, while the GUI now prefers fixed inbox issues for each
  Goal/PlanSet chain and surfaces issue-create/update/rerun diagnostics.
- Recovered Agent assist results when Multica run output is only a prose
  summary but the agent wrote the required JSON into an issue comment.
- Classified Multica CLI API `EOF` / network failures separately from generic
  CLI failures, added a short discovery retry for transient `api.multica.ai`
  errors, and surfaced a more actionable GUI message.
- Wrapped the mobile plugin navigation to avoid an obvious horizontal scrollbar.
