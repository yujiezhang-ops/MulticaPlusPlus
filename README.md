# Multica++

Multica++ 是 Multica 的本地控制层，用来把一次模糊需求整理成可确认的
`Goal -> Plan -> Issue` 流程，并在真实写入 Multica 前提供预览、确认 token、
审计记录和本地订阅跟踪。

它不替代 Multica 原生的 issue board、agent、runtime、skills、MCP、daemon 或
autopilot。Multica++ 只负责在这些原生能力外层提供更清晰的目标、计划、权限和
Issue 创建控制。

## 最快开始

```powershell
npm install
npm run gui
```

打开：

```text
http://127.0.0.1:8787/
```

推荐先从 GUI 跑完整 MVP 流程：

1. 在 `Control` 页输入需求，点击 `澄清目标`。
2. 等待 Multica Agent assist issue 返回 Goal 草案。
3. 点击 `锁定目标`。
4. 点击 `Agent 辅助拆分为多个 Plan`，生成并行 PlanSet。
5. 点击 `预览业务 Issue`，查看每个 subPlan 对应的业务 Issue 候选。
6. 输入 `APPLY-MULTICA-ISSUE-SPLIT`。
7. 按需点击单张卡片的 `创建此 Issue`，或点击 `创建全部 Multica Issue`。
8. 在 `Issue 执行跟踪` 中查看 Assist Goal、Assist Plan 和 Business Issues 的订阅状态。

预览不会写 Multica。只有输入确认 token 并点击创建按钮后，本地 GUI server 才会
调用 `multica issue create` 创建真实业务 Issue。

## 一眼看懂当前产品

### Control

`Control` 是默认主流程页：

- `Goal`：澄清模糊需求、显示目标详情、锁定 Goal。
- `Plan`：生成单 Plan 或 Agent 辅助拆分 PlanSet。
- `Issue`：预览业务 Issue 候选，确认后创建真实 Multica Issue。

页面顶部会展示紧凑路径：

```text
Goal -> Plan -> Issue
```

这条路径表示业务交付链路。Agent assist issue 只是辅助生成 Goal/Plan 的任务，不等同
于业务 Issue。

### Permissions

`Permissions` 独立展示一键权限配置。这里仍保持 preview-first：权限、技能、schema、
metadata 等高风险边界不会被静默修改。

### Settings

`Settings` 里可以检测 Multica Agent、选择自动/手动 agent、设置 assist 超时，并保留
高级本地 LLM CLI 直连入口。默认 Goal/Plan 辅助走 Multica Agent assist。

## Goal -> Plan -> Issue 的真实行为

### Goal 澄清

GUI 点击 `澄清目标` 后会：

- 通过本机 `multica` CLI 发现可用 Agent。
- 创建或复用固定的 Goal assist inbox issue。
- 订阅该 issue 的 run/message/comment 结果。
- 从 Agent 返回的 JSON 生成本地可信 Goal 草案。

刷新页面后，浏览器会继续读取同一个 assist issue，不会重复创建任务。

### Plan 拆分

锁定 Goal 后，可以：

- 生成确定性单 Plan。
- 或点击 `Agent 辅助拆分为多个 Plan`，通过 Multica Agent 生成 PlanSet。

中文 UI 下，Agent prompt 会要求 Plan、Issue title、description、steps、summary 等用户
可见字段使用简体中文。JSON key 保持英文，避免破坏解析。

### Issue 预览与创建

Plan 或 PlanSet 完成后，点击 `预览业务 Issue`：

- 单 Plan 会按复杂度生成 0/1/多个候选。
- PlanSet 会按每个 subPlan 生成一个业务 Issue 候选。
- 每个候选包含 Goal、成功标准、约束、风险、subPlan、workstream、建议 Agent、步骤、
  验收证据和固定安全边界。

每张卡片支持：

- `创建此 Issue`
- `复制命令`
- 创建后显示 `打开 Issue` 和 `复制 Issue ID`

批量创建会跳过已经创建过的候选，避免重复创建。

## Issue 订阅表

Multica++ 维护一个本地订阅表，默认路径：

```text
out/issue-subscriptions.json
```

该文件在 `out/` 下，不提交仓库。订阅类型严格区分：

- `assist_goal`：Goal 澄清 assist issue。
- `assist_plan_split`：Plan 拆分 assist issue。
- `business_issue`：Plan/PlanSet 创建出的真实业务 Issue。

订阅同步只读，只会调用：

```powershell
multica issue list --output json
multica issue runs <issueId> --output json
multica issue comment list <issueId> --output json
```

前端只维护一个 60 秒聚合轮询 loop，每次最多同步 30 个 active subscriptions。订阅过多
时会显示限流提示，不会静默丢事件。

## 常用 CLI

### 运行测试

```powershell
npm test
```

### 启动 GUI

```powershell
npm run gui
```

### 探测 Multica Agent

```powershell
node src/cli.js assist agents --output json
node src/cli.js assist diagnose --output json
```

### Goal 草案

```powershell
node src/cli.js goal normalize `
  --input examples/goal-request.json `
  --goal-out out/goal.json `
  --output json
```

### 锁定 Goal

```powershell
node src/cli.js goal lock `
  --input out/goal.json `
  --goal-out out/locked-goal.json `
  --approved-by ppio `
  --output json
```

### 生成 Plan

```powershell
node src/cli.js plan generate `
  --input out/locked-goal.json `
  --complexity complex `
  --plan-out out/plan.json `
  --output json
```

### Agent 辅助拆分 PlanSet

```powershell
node src/cli.js plan split `
  --input out/locked-goal.json `
  --agent `
  --plan-set-out out/plan-set.json `
  --output json
```

兼容别名 `--llm` 仍可用，但默认也会走 Multica Agent assist backend。

### 预览 Issue

单 Plan：

```powershell
node src/cli.js plan preview-issues `
  --goal out/locked-goal.json `
  --plan out/plan.json `
  --issue-split-out out/issue-split.json `
  --output json
```

PlanSet：

```powershell
node src/cli.js plan preview-issues `
  --goal out/locked-goal.json `
  --plan-set out/plan-set.json `
  --issue-split-out out/issue-split.json `
  --output json
```

### Dry-run 创建 Issue

```powershell
node src/cli.js plan apply-issues `
  --issue-split out/issue-split.json `
  --audit-path out/issue-split-events.jsonl `
  --output json
```

### 真实创建 Issue

```powershell
node src/cli.js plan apply-issues `
  --issue-split out/issue-split.json `
  --audit-path out/issue-split-events.jsonl `
  --execute `
  --confirm APPLY-MULTICA-ISSUE-SPLIT `
  --output json
```

## Launch Review 旧入口

本仓库最早的 launch review 能力仍保留，用于从输入 JSON 生成 Runtime Agent Spec 和
审阅 Markdown：

```powershell
node src/cli.js `
  --input examples/issue-assignment.json `
  --spec-out out/spec.json `
  --review-out out/review.md `
  --ledger out/ledger.jsonl
```

从只读 Multica 数据生成 spec：

```powershell
node src/cli.js from-multica `
  --issue-id MUL-123 `
  --agent-id agent-uuid `
  --workspace-name Core `
  --repo https://github.com/acme/shop `
  --spec-out out/spec.json `
  --review-out out/review.md
```

## 真实写入边界

默认行为：

- preview 不写 Multica。
- dry-run 不写 Multica。
- 真实写入必须显式传 `--execute` 和对应确认 token。
- 不读取、不输出、不保存 raw secret。
- 不静默修改权限、技能、schema、metadata、协作角色或 Multica 原生运行边界。

常见确认 token：

```text
APPLY-MULTICA-ISSUE-SPLIT
APPLY-MULTICA-AGENT-CONFIG
CREATE-MULTICA-IMAGE2-CODEX-AGENT
CREATE-MULTICA-AGENT-FROM-PRESET
READ-LOCAL-LLM-SECRET-METADATA
```

`READ-LOCAL-LLM-SECRET-METADATA` 只允许读取脱敏摘要，不会返回明文 key。

## 目录速查

- `gui/`：静态 GUI 和本地使用说明。
- `src/gui-server.js`：本地 GUI server，负责受控调用 Multica CLI。
- `src/goal-plan.js`：Goal、Plan、PlanSet、Issue preview/apply 核心逻辑。
- `src/multica-agent-assist.js`：Multica Agent assist 发现、创建、轮询和结果解析。
- `src/issue-subscriptions.js`：本地 Issue 订阅表和只读批量同步。
- `src/agent-config.js`：一键配置 Agent 的 dry-run/execute 计划。
- `src/spec/`：Runtime Agent Spec 和 launch review markdown。
- `ops/monitoring/`：本地监控记录和快照。

## 开发与提交

后续开发请先阅读：

- [开发约束](docs/development-constraints.zh-CN.md)
- [PR 检查清单](docs/pr-checklist.zh-CN.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CHANGELOG.md](CHANGELOG.md)

本机 Codex guardrails skill：

```text
C:\Users\PPIO\.codex\skills\multica-plusplus-dev-guardrails\SKILL.md
```

用户可见变更必须更新 `CHANGELOG.md` 的 `Unreleased`。
