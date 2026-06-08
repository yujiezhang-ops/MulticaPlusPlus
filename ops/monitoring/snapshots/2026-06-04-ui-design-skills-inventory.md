# Local UI Design Skills Inventory

- Timestamp: 2026-06-04T11:05:00+08:00
- Operator/session: Codex monitoring session
- Scope: local-first skill discovery for high-quality UI design work
- Mutations to skills/plugins/permissions: none

## Discovery Commands

```powershell
multica skill list --output json
Get-ChildItem -Path 'C:\Users\PPIO\.codex\skills' -Recurse -Filter SKILL.md -File
Get-ChildItem -Path 'C:\Users\PPIO\.codex\plugins\cache' -Recurse -Filter SKILL.md -File
```

## Source Summary

- `multica skill list --output json` returned `[]`.
- User/system Codex skills found under `C:\Users\PPIO\.codex\skills`.
- Plugin skills found under `C:\Users\PPIO\.codex\plugins\cache`.
- No external marketplace, install, permission, schema, or role changes were performed.
- Raw discovery snapshots:
  - `ops/monitoring/snapshots/2026-06-04-multica-skill-list.json`
  - `ops/monitoring/snapshots/2026-06-04-codex-skill-paths.txt`
  - `ops/monitoring/snapshots/2026-06-04-plugin-skill-paths.txt`

## Classification Rubric

- `Primary`: directly supports production-quality UI design workflows.
- `Support`: supports visual QA, browser inspection, or bitmap asset generation.
- `Contextual`: useful for polished visual artifacts in a narrower document/deck/sheet context.
- `Not UI-focused`: discovered locally but not recommended for UI design work.

## Recommended Skills

| Tier | Skill | Evidence | Recommended use |
| --- | --- | --- | --- |
| Primary | `figma-generate-design` | Builds or updates composed screens/views in Figma by reusing design system components, variables, and styles. | Use for full-page screens, modals, drawers, panels, and code-to-Figma UI translation. |
| Primary | `figma-generate-library` | Builds professional-grade design systems with variables, tokens, component variants, theming, and mandatory checkpoints. | Use when a UI task needs a reusable Figma design system or component library. |
| Primary | `figma-use` | Mandatory prerequisite for Figma Plugin API reads/writes and enforces incremental validation, font loading, variable scopes, and node return rules. | Load with any Figma execution skill; treat as the execution guardrail. |
| Primary | `figma-code-connect` | Creates Figma Code Connect mappings between published Figma components and code snippets. | Use when UI quality depends on keeping design components and implementation aligned. |
| Support | `control-in-app-browser` | Opens, inspects, tests, screenshots, and verifies local web targets in the Codex in-app browser. | Use for local app visual inspection and user-flow verification. |
| Support | `playwright` | Automates real browser navigation, snapshots, screenshots, data extraction, and UI-flow debugging from the terminal. | Use for repeatable browser checks when the in-app browser is not the right surface. |
| Support | `playwright-interactive` | Keeps persistent Playwright handles for fast functional and visual QA with screenshots and viewport checks. | Use for iterative frontend debugging and visual regression-style review. |
| Support | `imagegen` | Generates or edits raster visuals, including UI mockups, product mockups, website assets, and transparent cutouts. | Use only for bitmap assets or visual concepts, not deterministic UI structure. |
| Support | `paigod-imagegen` | Personal Paigod proxy skill for `gpt-image-2-text-to-image` generation through `apiproxy.paigod.work`. | Use when the custom Paigod image proxy is explicitly needed for visual assets. |
| Contextual | `Presentations` | Requires high-polish deck work, visual systems, contact-sheet review, and artifact-tool PPTX output. | Use as a quality reference for presentation-style visual artifacts, not app UI. |
| Contextual | `documents` | Requires render-to-PNG visual QA for DOCX layout and iteration until layout is clean. | Use for document layout quality patterns and render verification discipline. |
| Contextual | `Spreadsheets` | Requires polished workbook/dashboard layout, chart guidance, rendering, and verification. | Use for dashboard-like spreadsheet artifacts, not general app UI. |

## Not UI-Focused For This Search

- `openai-docs`, `plugin-creator`, `skill-creator`, `skill-installer`
- Feishu/Lark document creation, parsing, auth, verifier, and logger skills
- `markdown-formatter`, `markdown-to-html`, `md-to-office`, `pdf`
- Browser-adjacent but non-UI-specific tools such as `control-chrome` and `computer-use`
- GitHub and Superpowers process skills

## Recommended Local Workflow

For a task like "generate or optimize UI from a local web page":

1. Use `control-in-app-browser` or `playwright-interactive` to inspect the running local UI, capture screenshots, and check desktop/mobile viewports.
2. Use `figma-generate-design` with `figma-use` when translating the view into Figma while preserving design system components, variables, and styles.
3. Use `figma-generate-library` with `figma-use` if missing foundations, tokens, variants, or component library structure must be created first.
4. Use `figma-code-connect` if published Figma components need durable links back to code.
5. Use `imagegen` or `paigod-imagegen` only when the UI needs raster imagery, mockup backgrounds, product shots, or other bitmap assets.

## Follow-Up

- If future work installs, edits, or removes skills, create a backup under `ops/monitoring/backups/` first.
- Record any permission, schema, or collaboration-boundary change as a separate human-confirmed decision before execution.
