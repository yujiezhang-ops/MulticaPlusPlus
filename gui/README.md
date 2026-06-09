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
- 当前设计目标是桌面 Web 控制台，主要面向 1280px-1600px 宽度的浏览器工作区；
  窄屏只保证单列兜底和无横向溢出，不作为本轮主要体验。
- 视觉基调是深色/中性 Multica 控制台，允许少量低饱和渐变、过渡型卡片和柔和
  状态光，用于区分执行态、历史态和订阅态；不做营销 hero 或装饰堆叠。
- 仓库根目录的 `DESIGN.md` 是后续 Stitch 生成或人工重构 GUI 时的设计系统入口。
- 直接打开静态页面时，浏览器页面只使用本地预览数据。
- 通过 `npm run gui` 打开时，Image2 按钮会调用本地 API 执行真实 Multica CLI。
- 首屏为 `控制台`，采用 `目标` + `计划` 两栏工作区，并按
  `输入/澄清 Goal -> 锁定 Goal -> 生成 Plan -> 预览并创建 Issue` 的旅程推进。
- 左侧提供 `一键配置 Agent` 按钮，以及 `插件预制体` / `团队预制体`
  列表。
- 点击预制体后可以查看并修改默认 Agent 配置，再预览计划或创建 Agent。
- 当前 UI 文案以中文为默认语言，`设置` 中预留了 `English` 切换入口。
- 当前语言会随 Goal 澄清、Plan 拆分和 Issue 预览请求传给本地 server；默认
  `zh-CN`，因此 Agent 输出的可视化 Goal / Plan / Issue 文案也应为中文。
- 顶栏的 `隐藏内容` 只会临时隐藏当前工作区面板，方便暂时遮住已展示的
  Goal / Plan / Issue / 订阅内容；它不会清空浏览器本地草稿，也不会停止订阅或
  触发任何 Multica 写入。点击 `显示内容` 可以恢复。
- `记录` 页统一管理浏览器本地工作流快照和 Issue 订阅，采用 dashboard 布局：
  顶部是概览指标，主体按区块管理工作流记录和 Issue 执行跟踪。订阅管理使用
  `概览 + 筛选 + 紧凑列表 + 详情面板`，避免多列 issue 卡片和重复按钮堆积。
  删除记录只删除本地快照；新建流程只清空当前 Goal / Plan / Issue 草稿，
  历史记录和订阅表仍保留。
- 多个流程可以同时等待不同的 Assist Issue。每个 pending assist 都绑定到自己的
  工作流记录；后台结果完成时只更新所属记录，不会覆盖当前正在查看的新流程。
- `计划` 面板提供 `Agent 辅助拆分为多个 Plan`：只有 locked Goal 可通过本机
  `multica` CLI 选择或自动选择一个 Multica Agent，创建或复用该 Goal 链路的
  固定 assist inbox issue，并订阅该 issue 的收件箱结果；无可用 Agent 时显示
  blocked 提示。
- `目标` 面板的 `澄清目标` 默认通过 Multica Agent assist 做真实语义澄清；
  无 Agent、Multica CLI 不可用、run 超时或输出无效时显示 blocked 提示，
  不静默退回本地预置数据。
- Goal、locked Goal、Plan、PlanSet、pending Assist Issue 和 Issue preview 会保存
  为浏览器本地草稿；刷新页面后会继续订阅同一个 assist inbox issue，不会重新
  创建 assist task。该草稿不保存 secret、确认 token 或密钥摘要，也不会创建业务
  Multica Issue。
- 用于验证插件控制台的信息结构、视觉密度和本地交互，不是正式集成版。

## 控制台页面

`控制台` 首屏包含两栏，并默认只展示当前要判断和执行的内容：

- `目标`：输入和澄清需求，展示紧凑目标摘要、状态、负责人、进度和最多前三条
  成功标准。完整成功标准、最近更新和目标历史放在 `展开目标详情` 中；只有
  draft Goal 阻塞锁定时才展开待澄清问题和补充输入区。
- `计划`：顶部用大号旅程条和 `当前可执行动作` 提示展示下一步，例如锁定 Goal、
  生成 Plan、预览业务 Issue 或输入确认 token 创建 Issue。Plan/PlanSet 展示、
  业务 Issue preview 和创建入口保留在该页；步骤表、状态图例、Assist 运行详情、
  CLI 命令、metadata 和完整 Issue 描述默认折叠到详情入口。
- 订阅管理和历史快照通过页内入口跳转到 `记录` 页集中处理，不再堆叠在
  `控制台` 页面。

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
  后 POST `/api/plan/split`，body 使用 `mode: "agent"` 和 `async: true`。这会
  创建或复用固定 Multica assist inbox issue，随后通过 `/api/assist/subscribe`
  订阅该 issue 的运行/评论结果；Assist Issue 只用于生成 PlanSet，不等同于业务
  Issue。
- `生成 Plan 并预览 Issue` 会先生成 Plan，再展示 `Plan 到 Issue 预览`；
  若已有 Agent PlanSet，则直接按每个 subPlan 预览一个业务 Issue 候选，不会重新
  生成 Plan。
- `Plan 到 Issue 预览` 默认展示 title、priority 或 created 状态、description 摘要
  和主要操作。metadata、完整 description、`multica issue create` 命令和
  `复制命令` 放在 `查看写入详情` 中。每张候选卡片都有 `创建此 Issue`；总确认区
  保留 `创建全部 Multica Issue`。只有输入
  `APPLY-MULTICA-ISSUE-SPLIT` 后，GUI server 才会调用 `/api/plan/apply-issues`
  创建真实业务 Issue 并写 metadata。已创建的候选会显示 `打开 Issue` 和
  `复制 Issue ID`，再次批量创建时会跳过已创建候选。
- `记录` 页中的 `Issue 执行跟踪` 会读取本地订阅表，分组展示 `Assist Goal`、
  `Assist Plan` 和 `Business Issues`，并可按类型、状态和本地搜索过滤。前端只维护
  一个 60 秒聚合轮询 loop，不为每个 issue 单独建连接；同步最多读取 30 个活跃
  订阅。列表行只保留查看；暂时隐去、本地移除和关闭真实 Issue 放在
  右侧详情面板。Plan 页不会堆叠订阅管理卡片，只提供进入 `记录` 页的轻量入口。
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
`async: true`、当前 `设置` 里的 Agent 选择和 `language: "zh-CN"`。server 通过
本机 `multica` CLI 发现 Agent，为当前 Goal 链路创建或复用一个固定 assist inbox
issue，订阅该 issue，并立即返回 pending。浏览器随后通过 `/api/assist/subscribe`
实时订阅该 issue；如果页面刷新，会从 localStorage 恢复 pending assist 并继续
订阅同一个 issue，不会重新创建 assist task。若用户在一个 assist 运行中点击
`新建流程` 并启动另一个 assist，浏览器会并行轮询两条 pending assist；旧流程
结果写回对应工作流记录，新流程结果只更新当前页面。

结果读取顺序是 run `result.output` -> `issue run-messages` -> `issue comment list`。
真实 Agent 若只在 run output 写中文摘要、把完整 JSON 写到 issue comment，GUI
也会从 comment 中恢复 Goal draft。Multica Agent prompt 会要求 JSON key 保持英文，
同时所有用户可见 value 按当前语言输出。服务端只接受语义字段，可信的 `id`、
时间戳、owner、source、project 和 raw request 仍由本地代码生成。

如果 Agent 返回 `status: "draft"`，GUI 会保持 `锁定目标` 禁用，并显示待澄清
问题和 `澄清补充说明` 输入区。用户填写补充说明后点击 `提交补充澄清`，浏览器会
优先把上一版 draft Goal、待澄清问题和用户回答写入同一个 Assist Issue 的回复区，
通过 `/api/assist/reply` 触发同一 inbox issue 继续运行，并重新订阅该 issue 的
新返回结果；不会新建第二个 Goal 澄清 assist issue。只有后续结果变为 `clarified`
后，`锁定目标` 才会启用。

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
node src\cli.js plan apply-issues --issue-split out\issue-split.json --output json
node src\cli.js plan apply-issues --issue-split out\issue-split.json --execute --confirm APPLY-MULTICA-ISSUE-SPLIT --output json
```

Agent 发现会读取 `multica daemon status`、`multica runtime list --output json` 和
`multica agent list --output json` 的非敏感元数据。自动选择优先 idle、本机 runtime
online、planner/lead/architect 类 Agent，尽量避开 full-access worker，除非用户
显式选择或没有其他可用 Agent。找不到可用 Agent 时返回 blocked JSON，不会静默退回
规则拆分。Agent 输出必须包含可解析 JSON；解析失败、Plan 少于 2 个、步骤少于 2 个、
包含真实业务写入或绕过确认的指令都会被服务端阻断。

GUI 拆分时会为 locked Goal 生成固定 `assistChainId` 和一次性 `assistRequestId`，
复用标题形如 `Multica++ Assist Inbox · PlanSet · ...` 的 issue 作为该 Goal 链路的
收件箱。server 会更新该 issue 的描述、重新分配 Agent 并 `rerun`，然后通过 SSE
订阅 run/message/comment。`assistRequestId` 用于优先忽略旧 inbox comment；如果真实
Agent 忘记回填该字段，server 仍会在当前 run 时间窗口内尝试读取新 comment JSON。

对应 GUI API：

```text
POST /api/plan/split        { mode: "agent", async: true, ... }
GET  /api/assist/subscribe  ?kind=planSet&issueId=...&assistRequestId=...
POST /api/assist/result     { kind: "planSet", issueId, assistRequestId, lockedGoal, ... }
```

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
- Agent 辅助澄清和拆分默认通过本机 `multica` CLI 创建或复用真实 assist inbox
  issue/task；它只生成 draft Goal/PlanSet，不等同于业务 Issue。
- 业务 Issue 创建走单独的 Plan/PlanSet preview-first 流程：预览不写 Multica，真实
  创建必须输入 `APPLY-MULTICA-ISSUE-SPLIT` 并由本地 GUI server 调用
  `/api/plan/apply-issues`。
- 本地 Issue 订阅表默认存储在 `out/issue-subscriptions.json`，不会提交仓库。订阅
  同步只调用 `multica issue list --output json`、`multica issue runs <issueId>
  --output json` 和 `multica issue comment list <issueId> --output json`，不会修改
  Multica issue。
- 订阅详情中的 `暂时隐去`、`本地移除` 都只改变 Multica++ 本地状态。
  `关闭真实 Issue` 是真实 Multica 写入，必须输入 `CLOSE-MULTICA-SUBSCRIBED-ISSUE`，
  并通过本地 GUI server 执行 `multica issue status <id> cancelled --output json`。
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
