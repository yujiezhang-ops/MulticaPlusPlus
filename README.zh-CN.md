# Multica++

Multica++ 是 Multica 的 GUI-first 外接插件控制台。它不重做 Multica 已经具备
的任务队列、issue、智能体配置、技能包、MCP、取消或暂停机制，而是用 `Goal`、
`Plan` 和一键配置智能体权限，把一次 agent run 变成可见、可授权、可恢复、
可审计的控制记录。

完整产品说明见 [中文 PRD](docs/prd/MulticaPlusPlus-PRD.zh-CN.md)。

当前 GUI 方向见 [GUI 计划](gui/README.md)，简化版概念图提示词位于
`gui/assets/multica-console-simplified.prompt.md`。本地生成的参考图保存在
`output/imagegen/`，该目录作为生成物不纳入本次 PR。

## 当前能力

- 生成 Runtime Agent Spec：稳定记录一次 agent run 的目标、任务、workspace、
  agent、runtime、skills、permissions 和 initial plan。
- 渲染 Launch Review Markdown：用于启动前审阅。
- 展示 Instruction Overlay Diff：对比 workspace、agent、task、comment、
  autopilot 等指令层。
- 做 Capability And Permission Review：标记 repo、env key、secret-like env
  key、MCP server、权限 scope 和风险。
- 记录 Goal/Plan Ledger Lite：支持 draft、locked、running、completed 等状态。
- 通过 Multica CLI 只读读取 issue、agent、runtime、skills 数据生成 spec。

## GUI-first 方向

当前产品优先级已经调整为先完成插件控制台，再按界面补齐功能。首版 GUI 的
浏览器页面仍使用本地预览数据，不会直接执行本机命令；真实 Multica Agent
配置通过仓库内 CLI 桥完成。

首屏只突出三栏：

- `Goal`：当前目标、负责人、状态、完成度、最新更新和恢复入口。
- `Plan`：计划步骤、状态、依赖、当前执行项和阻塞项。
- `Agent Permission Setup`：权限模板、scope、TTL、审批、风险摘要、预览和应用。

当前视觉原型按概念图一比一复原 Multica-like 项目页外壳，因此左侧会显示
`Overview`、`Project`、`Agents`、`Runs`、`Environments`、`Data`、`Settings`、
`Docs`、`Support` 等导航元素。其中 `Project` 是承载三栏控制台的默认视图。
左侧 workspace 卡片下方新增 `一键配置 Agent` 按钮，用于打开本地 mock 配置弹层。

这些导航项在首版中只作为视觉壳和占位视图，不代表 Multica++ 接管 Multica 原生
项目、agent、run、environment 或 data 管理能力。真实产品能力仍收敛在三栏：
`Goal`、`Plan` 和 `Agent Permission Setup`。
`一键配置 Agent` 当前只做 preset 选择、配置预览、mock 应用和页面记录反馈，
不直接创建或修改真实 Multica agent。弹层会展示对应的真实 CLI 命令，用户在
终端中执行 dry-run 或显式确认后才会写入 Multica。

## 快速开始

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

用示例 JSON 生成审阅材料：

```bash
node src/cli.js \
  --input examples/issue-assignment.json \
  --spec-out out/spec.json \
  --review-out out/review.md \
  --ledger out/ledger.jsonl
```

从真实 Multica 数据生成 spec：

```bash
node src/cli.js from-multica \
  --issue-id MUL-123 \
  --agent-id agent-uuid \
  --workspace-name Core \
  --repo https://github.com/acme/shop \
  --spec-out out/spec.json \
  --review-out out/review.md
```

一键配置 Agent 的真实 CLI 流程：

```bash
# 只读探测本地 Multica daemon、workspace、project、runtime、agent、skills
node src/cli.js agent-config discover --output json

# 生成配置计划，不写 Multica
node src/cli.js agent-config plan \
  --preset planner \
  --plan-out out/agent-config-plan.json \
  --review-out out/agent-config-plan.md

# dry-run apply：默认只显示将执行的写操作
node src/cli.js agent-config apply --preset planner --output json

# 真实执行：必须显式传入确认 token
node src/cli.js agent-config apply \
  --preset planner \
  --execute \
  --confirm APPLY-MULTICA-AGENT-CONFIG \
  --output json
```

当前本地默认会选择 `SparkProject` workspace、`MulticaPlusPlus` project、
`Codex Full Access Worker` 作为源配置，并使用在线的 Codex runtime。
如果 workspace 里没有匹配的 skill，计划会记录 `missing:skills:*` 并跳过
skill 分配；不会伪造成功。`custom_env` 写入被设计为阻断项，必须在人工确认后
用 `multica agent env set --custom-env-file` 或 `--custom-env-stdin` 单独处理。

锁定并列出 ledger：

```bash
node src/cli.js lock \
  --ledger out/ledger.jsonl \
  --spec-id ras_xxxxxxxx \
  --approved-by ppio

node src/cli.js list --ledger out/ledger.jsonl --output json
```

## 模块结构

- `src/spec/`：Runtime Agent Spec 生成、schema 校验和 Markdown 渲染。
- `src/overlay/`：Instruction Overlay Diff。
- `src/capability/`：权限和能力风险标记。
- `src/ledger/`：Goal/Plan Ledger Lite。
- `src/multica-client.js`：Multica CLI 只读 adapter。
- `src/multica-mapper.js`：真实 Multica 数据到 Runtime Agent Spec 的映射。
- `src/agent-config.js`：一键配置 Agent 的 Multica CLI 探测、计划和受控执行。
- `examples/`：issue assignment、comment mention、autopilot run 示例输入。
- `ops/monitoring/`：本地监控记录、更新日志、快照和备份目录。

## 协作方式

本项目通过 Multica 管理 Claude 与 Codex 的协作：

- Claude-Lead 负责产品、架构、schema、模块边界和跨文件 review。
- Codex Full Access Worker 负责局部实现、测试、CLI 联调和验证。
- Codex 不得擅自修改 schema、权限边界或协作规则。
- 涉及 secret 的内容只记录 key 名和风险，不记录明文值。

## 路线图

### M1：真实数据生成 Runtime Agent Spec

已基本完成：

- 模块拆分。
- schema v1。
- Multica 只读 client。
- 真实数据映射。
- CLI lock/list。
- 三类任务 example。

### M2：GUI-first 三栏控制台

先做本地静态 GUI 原型，用 mock 数据表达完整产品体验。GUI 不接真实 Multica
CLI，不写 Multica metadata。

### M2.5：按 GUI 补齐底层能力

围绕三栏界面补齐：

- Goal/Plan ledger：步骤状态、恢复点、证据和 blocked 原因。
- 权限短租约：TTL、审批字段、高风险确认。
- Preset/Profile：从 issue、agent、workspace 生成默认 goal、plan 和权限模板。
- 上游兼容：真实 CLI fixtures、fail-closed adapter 和 launch record 回传。

### M3：Activity 与 Records

只收敛与当前 Goal/Plan 相关的运行事件和审计记录，不重做完整 run history 或
Multica runtime 管理。

## 非目标

- 不 fork Multica daemon。
- 不替代 Multica issue board、agent 配置、skills、MCP registry、runtime 或
  自动化。
- 不复刻 Multica 原生左侧导航。
- 不做完整项目管理、issue 管理、智能体管理、运行时管理、用量中心或数据资产
  管理。
- 不做运行时逐字命令硬拦截。
- 不伪造 browser、IDE 等客户端工具的真实可达性。
- 不声明自动接管所有权限。
