# Multica++

Multica++ 是 Multica 的 GUI-first 外接插件控制台。它不重做 Multica 已经具备
的任务队列、issue、智能体配置、技能包、MCP、取消或暂停机制，而是用 `Goal`、
`Plan` 和一键配置智能体权限，把一次 agent run 变成可见、可授权、可恢复、
可审计的控制记录。

完整产品说明见 [中文 PRD](docs/prd/MulticaPlusPlus-PRD.zh-CN.md)。
后续开发必须遵守 [开发约束](docs/development-constraints.zh-CN.md)，提交前按
[PR 检查清单](docs/pr-checklist.zh-CN.md) 自查。
本机 Codex 已提供精简 skill：
`C:\Users\PPIO\.codex\skills\multica-plusplus-dev-guardrails\SKILL.md`，后续开发
可先触发该 skill，再按仓库文档处理细节。

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
- 支持 LLM 辅助 `locked Goal -> 多 Plan` 拆分：优先通过本机 Codex / Claude
  Agent CLI 桥生成并行 `planSet` 草案；无可用 provider 时返回 blocked，不自动
  降级为规则拆分。

## GUI-first 方向

当前产品优先级已经调整为先完成插件控制台，再按界面补齐功能。首版 GUI 的
浏览器页面可以作为本地预览打开；如果使用 `npm run gui` 启动本地服务，
`一键配置 Agent` 弹层中的 Image2 按钮会通过本地 API 调用 Multica CLI，
真实创建或更新一个可运行的 Codex Image2 Agent。

首屏只突出三栏：

- `Goal`：当前目标、负责人、状态、完成度、最新更新和恢复入口。
- `Plan`：计划步骤、状态、依赖、当前执行项和阻塞项。
- `Agent Permission Setup`：权限模板、scope、TTL、审批、风险摘要、预览和应用。

当前 GUI 左侧是 Multica++ 插件导航：`控制台`、`权限`、`活动`、`记录`、
`设置`。其中 `控制台` 是承载三栏控制台的默认视图。左侧
workspace 卡片下方新增 `一键配置 Agent` 按钮，用于打开本地配置弹层。
界面文案当前以中文为默认语言，`设置` 中已预留 `English` 切换入口，后续接入
完整英文文案包后再启用切换。

左侧还会显示 `插件预制体` 和 `团队预制体`。`Project`、`Issues`、
`Agents`、`Runs`、`Environments`、`Data`、`Skills`、`MCP` 和 runtime settings
继续留在 Multica 原生侧；Multica++ 不接管这些完整管理页面。真实产品能力仍
收敛在三栏：`Goal`、`Plan` 和 `Agent Permission Setup`。
`一键配置 Agent` 正在重构为预制体体系：左侧会展示插件内置预制体和团队成员
创建的预制体。用户点击预制体后可以查看并修改默认 Agent 名称、instructions、
skills、MCP、权限 scope、TTL、审批要求和环境配置路径提示，再 Preview dry-run
计划或创建 Multica Agent。MCP 和 secret env 目前只做可见提示和阻断记录，不会
伪造已写入。

## 快速开始

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

启动本地 GUI server：

```bash
npm run gui
```

打开 `http://127.0.0.1:8787/` 后，点击左侧 `一键配置 Agent`，保持默认
`Image2 Codex Agent` preset，再点击 `Create Image2 Codex Agent`。该按钮会：

- 读取当前机器的 Multica daemon、workspace、project、runtime、agent、skills。
- 用 `C:\Users\PPIO\.codex\skills\paigod-imagegen\SKILL.md` 创建或更新
  `paigod-imagegen` skill。
- 创建或更新 `Multica++ Image2 Codex Agent`。
- 绑定 `paigod-imagegen` skill 到该 agent。
- 把审计记录追加到 `out/agent-config-events.jsonl`。

也可以直接在左侧 `插件预制体` / `团队预制体` 中选择预制体，修改默认配置
后点击 `预览计划` 或 `创建 Agent`。弹层内的 `创建团队预制体` 可以基于
团队共同本地环境创建一个当前 GUI server 会话内的团队预制体；它不写 Multica
metadata，也不持久化到仓库文件。当前真实创建范围是 Multica Agent；Squad 预制体
先作为后续扩展。

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

# 真实执行：普通 planner preset 必须显式传入确认 token
node src/cli.js agent-config apply \
  --preset planner \
  --execute \
  --confirm APPLY-MULTICA-AGENT-CONFIG \
  --output json

# 真实执行：Image2 Codex Agent
node src/cli.js agent-config apply \
  --preset image2 \
  --execute \
  --confirm CREATE-MULTICA-IMAGE2-CODEX-AGENT \
  --output json
```

当前本地默认会选择 `SparkProject` workspace、`MulticaPlusPlus` project、
`Codex Full Access Worker` 作为源配置，并使用在线的 Codex runtime。
如果 workspace 里没有匹配的 skill，计划会记录 `missing:skills:*` 并跳过
skill 分配；不会伪造成功。`custom_env` 写入被设计为阻断项，必须在人工确认后
用 `multica agent env set --custom-env-file` 或 `--custom-env-stdin` 单独处理。

Goal / Plan 到 issue 的受控流程：

```bash
# 将模糊需求整理成 Goal 草案
node src/cli.js goal normalize \
  --input examples/goal-request.json \
  --goal-out out/goal.json \
  --output json

# 人工确认后锁定 Goal
node src/cli.js goal lock \
  --input out/goal.json \
  --goal-out out/locked-goal.json \
  --approved-by ppio \
  --output json

# 从 locked Goal 生成 Plan
node src/cli.js plan generate \
  --input out/locked-goal.json \
  --complexity complex \
  --plan-out out/plan.json \
  --output json

# 探测本机 LLM Agent CLI provider，不读取或输出密钥
node src/cli.js llm discover --output json

# LLM 辅助拆分为多个并行 Plan；无 Codex/Claude CLI 时返回 blocked 且非零退出
node src/cli.js plan split \
  --input out/locked-goal.json \
  --llm \
  --plan-set-out out/plan-set.json \
  --output json

# 显式规则 fallback：不带 --llm，不调用外部模型
node src/cli.js plan split \
  --input out/locked-goal.json \
  --plan-set-out out/plan-set.json \
  --output json

# 预览是否拆成 Multica issue，不写 Multica
node src/cli.js plan preview-issues \
  --goal out/locked-goal.json \
  --plan out/plan.json \
  --issue-split-out out/issue-split.json \
  --output json

# 对 planSet 预览 issue：每个子 Plan 生成一个 issue candidate，不写 Multica
node src/cli.js plan preview-issues \
  --goal out/locked-goal.json \
  --plan-set out/plan-set.json \
  --issue-split-out out/issue-split.json \
  --output json

# dry-run apply：默认不写 Multica
node src/cli.js plan apply-issues \
  --issue-split out/issue-split.json \
  --audit-path out/issue-split-events.jsonl \
  --output json

# 真实创建 issue：必须显式确认
node src/cli.js plan apply-issues \
  --issue-split out/issue-split.json \
  --audit-path out/issue-split-events.jsonl \
  --execute \
  --confirm APPLY-MULTICA-ISSUE-SPLIT \
  --output json
```

LLM 辅助拆分只通过本机 Agent CLI 桥调用模型。provider 发现只检测用户显式配置、
`%USERPROFILE%\.codex`、`%USERPROFILE%\.claude`、命令可用性以及 CC Switch /
Cherry Studio 等配置工具的存在性提示；不会读取 `auth.json`、settings secret 或
API key。模型输出必须是裸 JSON，本地代码会补齐 id、number、status、timestamps
并二次校验。少于两个 Plan、步骤不足、包含真实写入或绕过确认的指令都会被 blocked。
Codex provider 通过 `codex exec --json --sandbox read-only --ephemeral --output-schema <schema-file> --output-last-message <file>`
读取最终消息；Claude provider 通过
`claude -p --output-format json --no-session-persistence --tools "" --json-schema <schema-json>`
读取单次结果。

`plan apply-issues` 真实执行会使用 `multica issue create --description-file` 创建
issue，并逐键写入 metadata。默认 dry-run 不会调用 Multica。

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
- `src/agent-preset.js`：插件预制体、团队预制体、用户覆盖合并和预制体到 Agent
  配置计划的转换。
- `src/llm-assist.js`：LLM provider 发现、Agent CLI 桥调用、模型 JSON 解析和
  Goal/Plan 拆分草案校验。
- `src/gui-server.js`：本地 GUI server 和按钮触发的真实 Image2 Agent 创建 API。
- `examples/`：issue assignment、comment mention、autopilot run 示例输入。
- `ops/monitoring/`：本地监控记录、更新日志、快照和备份目录。

## 协作方式

本项目通过 Multica 管理 Claude 与 Codex 的协作：

- Claude-Lead 负责产品、架构、schema、模块边界和跨文件 review。
- Codex Full Access Worker 负责局部实现、测试、CLI 联调和验证。
- Codex 不得擅自修改 schema、权限边界或协作规则。
- 涉及 secret 的内容只记录 key 名和风险，不记录明文值。

## 开发约束

- 任何后续开发必须先阅读 [开发约束](docs/development-constraints.zh-CN.md)。
- 日常执行可先使用本机 skill
  `C:\Users\PPIO\.codex\skills\multica-plusplus-dev-guardrails\SKILL.md`。
- PR 前必须按 [PR 检查清单](docs/pr-checklist.zh-CN.md) 自查。
- 用户可见变更必须写入 [CHANGELOG.md](CHANGELOG.md) 的 `Unreleased`。
- 贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

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
