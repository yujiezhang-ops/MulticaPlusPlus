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
- 首屏为 `控制台`，采用 `目标` + `计划` 两栏工作区。
- 左侧提供 `一键配置 Agent` 按钮，以及 `插件预制体` / `团队预制体`
  列表。
- 点击预制体后可以查看并修改默认 Agent 配置，再预览计划或创建 Agent。
- 当前 UI 文案以中文为默认语言，`设置` 中预留了 `English` 切换入口。
- 当前语言会随 Goal 澄清、Plan 拆分和 Issue 预览请求传给本地 server；默认
  `zh-CN`，因此 Agent 输出的可视化 Goal / Plan / Issue 文案也应为中文。
- `计划` 面板提供 `Agent 辅助拆分为多个 Plan`：只有 locked Goal 可通过本机
  `multica` CLI 选择或自动选择一个 Multica Agent，创建真实 assist issue/task
  后生成多个并行 Plan；无可用 Agent 时显示 blocked 提示。
- `目标` 面板的 `澄清目标` 默认通过 Multica Agent assist 做真实语义澄清；
  无 Agent、Multica CLI 不可用、run 超时或输出无效时显示 blocked 提示，
  不静默退回本地预置数据。
- 用于验证插件控制台的信息结构、视觉密度和本地交互，不是正式集成版。

## 控制台页面

`控制台` 首屏包含两栏：

- `目标`：展示当前目标、负责人或触发来源、状态、完成度、最近更新，以及
  恢复 / 继续入口。
- `计划`：明确展示 `Goal -> Plan -> Issue` 路径，展示有序步骤、
  pending/running/done/blocked 状态、依赖关系、当前执行项高亮和阻塞原因。

## 权限页面

`权限` 是独立页面，不再堆叠在 `控制台` 中：

- `一键 Agent 权限配置`：展示权限模板、scope/resource groups、TTL lease、
  审批要求、风险摘要，以及预览配置 / 应用权限。

## 左侧导航

当前视觉版采用 Multica-like 深色风格，但左侧入口收敛为插件导航：

- `控制台`
- `权限`
- `活动`
- `记录`
- `设置`

其中 `控制台` 是默认视图，展示 `目标` 和 `计划` 两栏。`权限` 是一键
Agent 权限配置页面；`活动`、`记录` 和 `设置` 保持独立页面。

`Project`、`Issues`、`Agents`、`Runs`、`Environments`、`Data`、`Skills`、`MCP`
和 runtime settings 留在 Multica 原生侧。GUI 中的 `Native Multica` 只用于说明
边界，不提供完整管理页面。

左侧 workspace 卡片下方还有 `一键配置 Agent` 主按钮。该按钮打开本地弹层，
用于选择 Agent preset、预览模型/runtime/权限模板/scope/guardrail，并展示
真实 Multica CLI 的 discover、dry-run、保存计划和显式执行命令。`Image2
Codex Agent` preset 还提供 `Create Image2 Codex Agent`，通过本地 GUI server
真实注册 skill、创建或更新 agent、绑定 skill，并写入审计记录。

左侧还显示两组可点击预制体：

- `插件预制体`：Multica++ 内置的 Planner、Executor、Review、Image2、
  Incident 等通用预制体。
- `团队预制体`：团队成员从共同工作环境沉淀的预制体，例如 GUI Builder。

预制体包含 skills、MCP、instructions、runtime hint、权限、TTL、审批策略和
环境配置路径提示。MCP 和 secret env 目前只展示和记录阻断项，不直接写入。
弹层内的 `创建团队预制体` 会创建一个当前 GUI server 会话内的团队预制体，
并刷新左侧 `团队预制体`。它不调用 Multica CLI，不写 Multica metadata，也不
持久化到仓库文件；重启 server 后需要重新创建。

## 本地交互

- 点击左侧导航切换三栏视图或占位页。
- 点击 `一键配置 Agent` 打开本地配置弹层。
- 默认选择 `Image2 Codex Agent` preset，也可以切换 Planner / Review /
  Incident 等 preset。
- `创建团队预制体` 会基于表单中的名称、创建者、说明和 instructions 创建
  当前会话的团队预制体。
- 左侧预制体点击后会打开编辑器，支持修改 Agent Name 和 Instructions。
- `预览计划` 会调用 `/api/agent-presets/:id/plan`，生成 dry-run 计划。
- `创建 Agent` 会调用 `/api/agent-presets/:id/create`，带确认 token 后真实
  创建或更新 Multica Agent。
- 预览 / 应用浏览器预览只更新页面状态和 mock record。
- 弹层里的 `真实 Multica CLI 计划` 展示可在仓库根目录运行的真实命令。
- `创建 Image2 Codex Agent` 会 POST 到 `/api/agent-config/image2/create`。
- `Agent 辅助拆分为多个 Plan` 会先 GET `/api/assist/agents`，发现可用 Agent
  后 POST `/api/plan/split`，body 使用 `mode: "agent"`。这会创建真实 Multica
  assist issue/task；返回的业务 Issue 仍只是候选预览，不会直接创建。
- `生成 Plan 并预览 Issue` 会先生成 Plan，再展示 `Plan 到 Issue 预览`；
  Issue 始终是候选预览，不会直接创建 Multica issue。
- Plan 当前步骤高亮。
- 权限模板、TTL 和审批开关改变本地预览。
- Preview / Apply 按钮只写入页面内 mock record。
- `设置` 中的 `界面语言` 当前固定为中文，`English` 标记为预留，不会切换文案包。
- `设置` 中的 `Multica Agent 辅助` 显示 daemon/runtime/Agent 检测结果、自动或
  手动 Agent 选择和运行超时；默认等待 300000ms，可点击 `检测 Agent` 做
  readiness 检查。
- `设置` 中的 `高级：本地 CLI 直连 provider` 保留 Codex / Claude 直连配置，
  但默认 Goal/Plan 辅助不使用该路径。
- `设置` 中的 `读取密钥摘要` 是独立动作。只有输入
  `READ-LOCAL-LLM-SECRET-METADATA` 后，server 才会读取 allowlist 内的本机
  Codex / Claude 配置文件，并只返回 provider、path hint、key name、present、
  fingerprint、lengthRange、formatHint 等脱敏摘要；不返回明文、不保存 key。

## Agent 辅助 Goal 澄清

GUI 的 `澄清目标` 会 POST `/api/goal/normalize`，body 中包含 `mode: "agent"`、
当前 `设置` 里的 Agent 选择和 `language: "zh-CN"`。server 通过本机 `multica`
CLI 发现 Agent，创建真实 assist issue/task，轮询 run 输出，并解析裸 JSON Goal
draft。Multica Agent prompt 会要求 JSON key 保持英文，同时所有用户可见 value
按当前语言输出。服务端只接受语义字段，可信的 `id`、时间戳、owner、source、
project 和 raw request 仍由本地代码生成。

对应 CLI：

```powershell
node src\cli.js assist agents --output json
node src\cli.js goal normalize --input examples\goal-request.json --agent --language zh-CN --goal-out out\goal.json --output json
```

不带 `--agent` 或兼容别名 `--llm` 时仍使用确定性本地规则。带 `--agent` 时如果
Multica CLI、daemon、Agent 或 run 输出不可用，会返回 blocked JSON 且不自动
fallback。`--llm` 当前作为兼容别名映射到 Multica Agent assist。

## Agent 辅助 Goal 拆分

Agent 辅助拆分保留在现有确定性 Goal/Plan 流程旁边，不替代单 Plan 生成。流程是：

```powershell
node src\cli.js assist agents --output json
node src\cli.js assist diagnose --output json
node src\cli.js plan split --input out\locked-goal.json --agent --language zh-CN --plan-set-out out\plan-set.json --output json
node src\cli.js plan preview-issues --goal out\locked-goal.json --plan-set out\plan-set.json --language zh-CN --issue-split-out out\issue-split.json --output json
```

Agent 发现会读取 `multica daemon status`、`multica runtime list --output json` 和
`multica agent list --output json` 的非敏感元数据。自动选择优先 idle、本机 runtime
online、planner/lead/architect 类 Agent，尽量避开 full-access worker，除非用户
显式选择或没有其他可用 Agent。找不到可用 Agent 时返回 blocked JSON，不会静默退回
规则拆分。Agent 输出必须包含可解析 JSON；解析失败、Plan 少于 2 个、步骤少于 2 个、
包含真实业务写入或绕过确认的指令都会被服务端阻断。

语言规则：`language` 默认 `zh-CN`，可通过 CLI `--language en-US` 测试英文预留路径。
JSON schema key 不翻译；Goal 标题、目标、成功标准、Plan 卡片、步骤、风险、问题和
Issue preview 的标题/描述/summary 都按请求语言生成或渲染。

旧的 Codex / Claude 直连命令仍保留在 `node src\cli.js llm ...` 和设置的高级区，
用于诊断或兼容；默认 GUI/CLI assist 不再使用该路径。

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
- Agent 辅助澄清和拆分默认通过本机 `multica` CLI 创建真实 assist issue/task；
  它只生成 draft Goal/PlanSet，不创建业务 Issue。
- Agent 辅助 prompt 和本地 Issue preview 会使用当前请求语言；中文 UI 下默认生成
  中文 Plan 和 Issue 候选文案。
- 旧 LLM 直连桥不直接发起 API key HTTP 调用，并仅在高级兼容路径中使用。
- 默认 discovery / diagnose 不读取 Codex / Claude 配置中的 secret；只有用户输入
  `READ-LOCAL-LLM-SECRET-METADATA` 后，才读取 allowlist 配置文件并返回脱敏摘要。
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

## 开发约束

- GUI 后续开发必须遵守 `docs/development-constraints.zh-CN.md`。
- 首屏以 `Goal`、`Plan` 两栏为主，`Agent Permission Setup` 保持独立
  `权限` 页面。
- 新增真实写入按钮必须先提供 dry-run/preview 状态，并通过本地 GUI server 调用
  受控 CLI。
- 变更用户可见行为时，同步更新 `README.zh-CN.md`、本文件和 `CHANGELOG.md`。

## 视觉约束

- 黑、近黑、白和中性灰为主。
- 状态色如必须使用，应非常克制。
- 面板圆角不超过 8px。
- 不使用彩色渐变、装饰插画或营销 hero。
- 页面信息密度适中，避免复杂审计栏、capability diff、instruction diff 抢占首屏。

## 验收清单

- 桌面视口下 `控制台` 首屏显示两栏：`目标`、`计划`；`权限` 页面单独显示
  `一键 Agent 权限配置`。
- 移动视口下控制台两栏按顺序堆叠，权限页面保持单列。
- 视觉以黑、白、灰为主。
- 左侧导航采用插件入口：`控制台`、`权限`、`活动`、`记录`、`设置`。
- 左侧 `一键配置 Agent` 按钮可打开配置弹层。
- 左侧显示 `插件预制体` 和 `团队预制体`。
- 点击预制体后可修改 Agent Name 和 Instructions。
- 预制体预览 / 创建走本地 API，并展示计划或创建结果。
- 弹层可选择 preset，Preview / Apply 可写入页面内记录反馈。
- 弹层展示真实 `node src/cli.js agent-config ...` 命令。
- `Image2 Codex Agent` preset 的创建按钮可调用本地 API 并展示 agent/skill id。
- `agent-config apply` 不带 `--execute` 时只返回 dry-run 计划。
- `控制台` 首屏显示两栏，`权限` 使用独立页面，插件导航最多保留 5 项。
- `设置` 显示中文优先的语言设置，并预留 `English` 入口。
- 运行 `npm test`。
