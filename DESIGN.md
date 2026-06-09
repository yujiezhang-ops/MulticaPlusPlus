# Multica++ Desktop Console Design System

## 1. Visual Theme & Atmosphere

Multica++ is a desktop-first operations console for Goal, Plan, Agent assist,
Issue preview, and subscription review. The atmosphere is calm, high-trust, and
control-room dense: structured enough for repeated review work, but with a
small amount of atmospheric depth so the interface does not feel like a raw
debug panel.

The default product language is Simplified Chinese. English product terms such
as Goal, Plan, Issue, Agent, CLI, and Multica remain untranslated where they are
part of the workflow vocabulary.

## 2. Color Palette & Roles

- **Console Graphite** (#07080A) - Primary app background.
- **Deep Workbench** (#0B0D10) - Sidebar, topbar, and fixed navigation surfaces.
- **Raised Panel** (#111418) - Main panels and repeated management cards.
- **Glass Panel** (rgba(20, 25, 30, 0.84)) - Transitional cards and grouped
  workflow areas.
- **Structural Line** (#252A31) - Default borders and separators.
- **Bright Line** (#3B424C) - Hover borders, focused panels, and selected rows.
- **Primary Ink** (#F5F7F8) - Main text.
- **Secondary Ink** (#C7CCD3) - Body copy and descriptions.
- **Muted Telemetry** (#87909B) - Metadata, timestamps, helper text.
- **Operational Sage** (#AAB8A2) - Single low-saturation accent for primary
  action states, progress, and successful completion.
- **Risk Clay** (#D79A8B) - Destructive and blocked states.
- **Notice Amber** (#D3B579) - Warnings, pending work, and confirmation prompts.

Gradients are allowed only as low-opacity surface transitions or soft status
lighting. No neon glow, purple-blue AI gradients, decorative orbs, or marketing
hero treatment.

## 3. Typography Rules

- **UI Sans:** system desktop stack first: `Segoe UI`, `Microsoft YaHei`,
  `PingFang SC`, `Helvetica Neue`, sans-serif.
- **Data Mono:** `Cascadia Mono`, `JetBrains Mono`, `SFMono-Regular`,
  monospace for timestamps, identifiers, CLI commands, and dense metrics.
- **Hierarchy:** compact dashboard scale. Use weight, color, and spacing before
  large type. Page titles should stay operational, not editorial.
- **Numbers:** tabular figures for metrics, counts, progress, and subscription
  summaries.
- **Spacing:** no negative letter spacing. Chinese UI text must not wrap into
  single-character action labels on desktop.

## 4. Component Styling

- **Buttons:** 6px radius, tactile hover and pressed states, clear focus rings.
  Primary buttons use Operational Sage on a dark console surface; destructive
  buttons use Risk Clay borders and text.
- **Panels:** 6px radius, 1px structural border, subtle inset highlight, and a
  low-opacity gradient only when it clarifies hierarchy.
- **Transitional cards:** used for Goal draft follow-up, PlanSet preview, Issue
  preview, Records dashboard groups, and subscription lanes. They may use a
  soft gradient edge but must remain readable and data-focused.
- **Status badges:** compact, non-pill-heavy badges with tabular numbers and
  short labels.
- **Inputs:** dark fill, visible border, label above input, inline helper/error
  text below. Confirmation token fields should be visually distinct but not
  alarming until the user invokes a destructive action.

## 5. Layout Principles

- Desktop is the primary target. Optimize for 1280px to 1600px wide browser
  windows.
- Keep the primary navigation fixed to: Control, Permissions, Activity,
  Records, Settings.
- `Control` is the execution surface only: Goal -> Plan -> Issue, PlanSet
  preview, and confirmed Issue creation.
- `Records` is the management surface: workflow snapshots, Assist Issue
  subscriptions, Business Issue subscriptions, hidden/paused/closed state.
- `Records` subscription tracking should use an attention-first workbench:
  compact overview metrics, type/status filters, one scrollable issue list, and
  a selected-detail panel for destructive or secondary actions. Avoid multiple
  side-by-side scrolling lanes of full issue cards.
- Use CSS Grid for page shells and dashboard boards. Avoid deeply nested cards
  inside decorative cards.
- Mobile and narrow widths only need a reliable single-column fallback with no
  horizontal overflow; they are not the target experience for this refactor.

## 6. Control Page Information Load

`Control` should read as a guided execution desk, not a debug transcript. The
primary journey is always:

1. 输入/澄清 Goal
2. 锁定 Goal
3. 生成 Plan
4. 预览并创建 Issue

Default visible content should answer only the current decision: what is ready,
what is blocked, and what the next action is. Put long success criteria, Goal
history, Plan step tables, metadata, CLI commands, full Issue descriptions, and
Assist run details behind progressive disclosure controls such as `展开目标详情`,
`查看步骤详情`, `查看写入详情`, or `查看 Assist 详情`.

Key rules:

- Show one next-action banner in the Plan panel. Avoid multiple competing
  helper paragraphs.
- Goal summaries show title, status, owner, progress, and at most the first
  three success criteria by default.
- Draft clarification questions are visible only while they block locking.
- Issue preview cards show title, priority/created state, summary, and the main
  action first. CLI commands and metadata are secondary details.
- Helper copy can be 13px, but key decisions and button labels should stay
  14-16px and readable on desktop.

## 7. Motion & Interaction

- Motion is restrained: 160-220ms transitions for border, background, opacity,
  and transform.
- Hover states may lift cards by 1px or brighten a border. Do not animate
  layout properties.
- Loading, blocked, pending, and empty states should be inline and recoverable,
  not modal-first.

## 8. Anti-Patterns

- No marketing hero, decorative illustration, mascot, emoji, or fake landing
  copy.
- No full migration to React, Vite, Tailwind, or another build chain in this
  refactor.
- No new Multica write behavior from visual changes.
- No direct secret display, prompt logging, raw Agent output logging, or schema
  boundary changes.
- No single long Records page where workflow records, subscriptions, and events
  are indistinguishable.
