# Multica++ GUI Static Prototype

## 如何打开

当前 GUI 可以作为静态原型直接用浏览器打开：

```text
gui/index.html
```

如果浏览器或本地安全策略限制静态资源，也可以在仓库根目录或 `gui/`
目录下使用任意静态服务器打开，例如：

```powershell
python -m http.server 8080
```

如果要让按钮真实创建 Multica Agent，请从仓库根目录启动本地 GUI server：

```powershell
npm run gui
```

然后打开：

```text
http://127.0.0.1:8787/
```

## 当前范围

- 纯 HTML/CSS/JS 实现。
- 直接打开静态页面时，浏览器页面只使用本地预览数据。
- 通过 `npm run gui` 打开时，Image2 按钮会调用本地 API 执行真实 Multica CLI。
- 首屏为 `Control`，采用三栏工作区。
- 左侧提供 `一键配置 Agent` 按钮，以及 `Plugin Presets` / `Team Presets`
  预制体列表。
- 点击预制体后可以查看并修改默认 Agent 配置，再 Preview 或 Create Agent。
- 用于验证插件控制台的信息结构、视觉密度和本地交互，不是正式集成版。

## 首屏三栏

`Control` 首屏包含三栏：

- `Goal`：展示当前目标、负责人或触发来源、状态、完成度、最近更新，以及
  Restore / Resume 入口。
- `Plan`：展示有序步骤、pending/running/done/blocked 状态、依赖关系、
  当前执行项高亮和阻塞原因。
- `Agent Permission Setup`：展示权限模板、scope/resource groups、TTL lease、
  approval required、风险摘要，以及 Preview Configuration / Apply Permissions。

## 左侧导航

当前视觉版采用 Multica-like 深色风格，但左侧入口收敛为插件导航：

- `Control`
- `Permissions`
- `Activity`
- `Records`
- `Settings`

其中 `Control` 是默认视图，展示 `Goal`、`Plan` 和
`One-click Agent Permission Setup` 三栏。`Permissions`、`Activity`、`Records`
和 `Settings` 可以先作为轻量占位或后续接入面。

`Project`、`Issues`、`Agents`、`Runs`、`Environments`、`Data`、`Skills`、`MCP`
和 runtime settings 留在 Multica 原生侧。GUI 中的 `Native Multica` 只用于说明
边界，不提供完整管理页面。

左侧 workspace 卡片下方还有 `一键配置 Agent` 主按钮。该按钮打开本地弹层，
用于选择 Agent preset、预览模型/runtime/权限模板/scope/guardrail，并展示
真实 Multica CLI 的 discover、dry-run、保存计划和显式执行命令。`Image2
Codex Agent` preset 还提供 `Create Image2 Codex Agent`，通过本地 GUI server
真实注册 skill、创建或更新 agent、绑定 skill，并写入审计记录。

左侧还显示两组可点击预制体：

- `Plugin Presets`：Multica++ 内置的 Planner、Executor、Review、Image2、
  Incident 等通用预制体。
- `Team Presets`：团队成员从共同工作环境沉淀的预制体，例如 GUI Builder。

预制体包含 skills、MCP、instructions、runtime hint、权限、TTL、审批策略和
环境配置路径提示。MCP 和 secret env 目前只展示和记录阻断项，不直接写入。

## 本地交互

- 点击左侧导航切换三栏视图或占位页。
- 点击 `一键配置 Agent` 打开本地配置弹层。
- 默认选择 `Image2 Codex Agent` preset，也可以切换 Planner / Review /
  Incident 等 preset。
- 左侧预制体点击后会打开编辑器，支持修改 Agent Name 和 Instructions。
- `Preview Plan` 会调用 `/api/agent-presets/:id/plan`，生成 dry-run 计划。
- `Create Agent` 会调用 `/api/agent-presets/:id/create`，带确认 token 后真实
  创建或更新 Multica Agent。
- Preview / Apply Browser Preview 只更新页面状态和 mock record。
- 弹层里的 `Real Multica CLI Plan` 展示可在仓库根目录运行的真实命令。
- `Create Image2 Codex Agent` 会 POST 到 `/api/agent-config/image2/create`。
- Plan 当前步骤高亮。
- 权限模板、TTL 和审批开关改变本地预览。
- Preview / Apply 按钮只写入页面内 mock record。

## 真实 CLI 一键配置

GUI 页面不直接执行本机命令。真实配置由仓库 CLI 桥完成：

```powershell
node src\cli.js agent-config discover --output json
node src\cli.js agent-config plan --preset planner --plan-out out\agent-config-plan.json --review-out out\agent-config-plan.md
node src\cli.js agent-config apply --preset planner --output json
node src\cli.js agent-config apply --preset planner --execute --confirm APPLY-MULTICA-AGENT-CONFIG --output json
node src\cli.js agent-config apply --preset image2 --execute --confirm CREATE-MULTICA-IMAGE2-CODEX-AGENT --output json
```

`apply` 默认是 dry-run，不写 Multica。真实执行必须同时提供 `--execute` 和确认
token。CLI 会按当前本地环境选择 `SparkProject` workspace、`MulticaPlusPlus`
project、`Codex Full Access Worker` 源 agent 和在线 Codex runtime。

Image2 流程会：

- 用 `C:\Users\PPIO\.codex\skills\paigod-imagegen\SKILL.md` 创建或更新
  `paigod-imagegen` skill。
- 创建或更新 `Multica++ Image2 Codex Agent`。
- 将 `paigod-imagegen` skill 绑定到该 agent。
- 使用 Codex 自动审核配置继承当前本机 Codex Full Access Worker 的安全
  custom args。
- 把审计事件追加到 `out/agent-config-events.jsonl`。

## 明确边界

- 静态浏览器页面不直接调用真实 Multica CLI；只有 `npm run gui` 启动的本地
  server 会执行真实 CLI。
- 浏览器页面不写 Multica metadata。
- 一键配置 Agent 的真实创建、更新和 skill 分配只通过 `src/cli.js agent-config`
  执行。
- 预制体创建的真实写入范围是 Multica Agent 和 skill assignment。
- MCP 配置因为当前 CLI 没有直接写入参数，保留为可见配置和 blocked operation。
- Squad 预制体第一版只做预览，不真实创建 Squad。
- `custom_env` 写入被 CLI 计划阻断，必须单独使用 `--custom-env-file` 或
  `--custom-env-stdin` 并经过人工确认。
- 不替代 Multica 原生项目、issue、agent、runtime、skills 或 MCP 管理。
- 不声明自动接管所有权限。
- 不把 GUI 扩展成新的 Multica 工作台；它只是外接插件控制台原型。

## 视觉约束

- 黑、近黑、白和中性灰为主。
- 状态色如必须使用，应非常克制。
- 面板圆角不超过 8px。
- 不使用彩色渐变、装饰插画或营销 hero。
- 页面信息密度适中，避免复杂审计栏、capability diff、instruction diff 抢占首屏。

## 验收清单

- 桌面视口下 `Control` 首屏显示三栏：`Goal`、`Plan`、
  `Agent Permission Setup`。
- 移动视口下三栏按顺序堆叠。
- 视觉以黑、白、灰为主。
- 左侧导航采用插件入口：`Control`、`Permissions`、`Activity`、`Records`、
  `Settings`。
- 左侧 `一键配置 Agent` 按钮可打开配置弹层。
- 左侧显示 `Plugin Presets` 和 `Team Presets`。
- 点击预制体后可修改 Agent Name 和 Instructions。
- 预制体 Preview/Create 走本地 API，并展示计划或创建结果。
- 弹层可选择 preset，Preview / Apply 可写入页面内记录反馈。
- 弹层展示真实 `node src/cli.js agent-config ...` 命令。
- `Image2 Codex Agent` preset 的创建按钮可调用本地 API 并展示 agent/skill id。
- `agent-config apply` 不带 `--execute` 时只返回 dry-run 计划。
- `Control` 首屏显示三栏，插件导航最多保留 5 项。
- 运行 `npm test`。
