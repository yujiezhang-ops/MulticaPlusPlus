# Multica++ 开发约束

本文定义后续开发必须遵守的工程约束。关键词 `必须`、`禁止`、`应该`、`可以`
按规范性语义理解：`必须/禁止` 是合并门槛，`应该` 需要有明确理由才能偏离，
`可以` 是允许项。

日常开发可优先使用本机 Codex skill：
`C:\Users\PPIO\.codex\skills\multica-plusplus-dev-guardrails\SKILL.md`。
该 skill 是本文的精简执行版；本文保留完整规范和来源链接。

## 参考规范

- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)：
  提交信息使用 `type(scope): summary`，`feat` 表示功能，
  `fix` 表示修复，破坏性变更使用 `!` 或 `BREAKING CHANGE`。
- [Semantic Versioning](https://semver.org/)：公开接口变更按
  `MAJOR.MINOR.PATCH` 语义管理；本项目 `0.x` 阶段仍必须记录破坏性变更。
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)：用户可见变更按
  `Added`、`Changed`、`Fixed`、`Security` 等类别记录。
- [Twelve-Factor App](https://www.12factor.net/config)：配置和 secret 不写入
  代码；日志作为事件流输出。
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/stable-en/)：
  默认最小权限、输入校验、输出转义、secret 保护和审计记录。
- [OpenSSF Scorecard](https://openssf.org/scorecard/) 思路：依赖、CI、代码
  审查、分支保护和安全策略应可检查。

## 产品边界

- Multica++ 必须保持为 Multica 的外接治理控制台，不替代 Multica 的 issue
  board、agent 配置、runtime、skills、MCP、daemon、autopilot 或完整 run history。
- 新功能必须服务于 `Goal`、`Plan`、`Agent Permission Setup`、`Activity`、
  `Records` 或 `Settings` 之一；新增一级导航必须先有产品决策记录。
- GUI-first 不等于假装具备真实控制能力。任何 mock、dry-run、preview、blocked
  operation 必须在 UI、CLI 或文档中明确标注。
- 不得声明自动接管所有权限；高风险写入必须走人工确认。

## 架构约束

- 业务能力优先放在 `src/` 中可测试的纯模块；CLI、GUI server、浏览器 UI 只做
  编排和展示。
- 公共 Runtime Agent Spec schema、权限边界、协作角色、Multica 写入语义属于
  高影响变更，必须先更新 PRD 或决策记录，再实现。
- 新模块必须有清晰输入输出，不依赖全局状态；需要时间戳时允许注入 `createdAt`
  以便测试。
- 适配 Multica CLI 时必须 fail-closed：字段缺失、JSON 解析失败、命令失败或
  CLI 漂移时返回错误或 warning，不伪造成功。
- Windows 兼容是硬约束。涉及中文、多行描述或路径时优先使用文件参数，例如
  `--description-file`，避免管道和 shell 转义破坏内容。

## Goal / Plan / Issue 约束

- Goal 模块负责把模糊需求归一化为可执行目标；信息不足时必须保持 `draft`，
  并给出待澄清问题。
- 只有 `locked` Goal 可以生成 Plan 或进入 issue split preview。
- Plan 模块负责步骤、依赖、状态、建议执行者和验收证据，不负责静默创建 issue。
- Plan 到 Multica issue 的拆分必须先生成 preview；默认不写 Multica。
- 只有具备独立交付物、独立 owner/agent/runtime、并行价值、权限边界或独立验收
  的步骤才可以拆成 issue；禁止把每个小步骤机械拆成 issue。
- 真实 `multica issue create` 必须同时满足 `--execute` 和确认 token，并写本地
  audit JSONL。

## CLI 与 Multica 写入约束

- 所有会写 Multica 的 CLI 子命令默认必须 dry-run。
- 真实写入必须显式传入 `--execute` 和命令专属确认 token。
- 真实写入必须返回实际执行的 operation、命令参数、结果状态和错误信息。
- 任何 metadata、permission、skill、system instruction、schema 或协作边界变更
  都必须记录到本地 audit/monitoring 记录，并在 PR 中说明。
- Secret 只允许记录 key 名、来源提示和风险，不得记录明文值、token、cookie、
  OAuth code、API key 或完整 credential。

## GUI 约束

- 默认仍使用静态 `HTML/CSS/JS`，不得引入 Vite、React 或其他构建链，除非 PRD
  和开发约束同步更新。
- 首屏必须保持三栏：`Goal`、`Plan`、`Agent Permission Setup`。
- 插件一级导航最多保留 `Control`、`Permissions`、`Activity`、`Records`、
  `Settings`；Multica 原生能力只做边界说明。
- 视觉以黑、白、灰为主，圆角不超过 8px；禁止营销 hero、彩色渐变和装饰插画。
- 桌面和窄屏视口都不能出现文字重叠、按钮溢出、表格遮挡或布局横向失控。
- GUI 真实写入只能通过本地 GUI server 调用受控 CLI 流程；静态文件模式不得
  直接执行本机命令。

## 测试约束

- 新业务模块必须先写行为测试，再写实现；新增 CLI 行为必须覆盖 dry-run、确认
  token、失败路径和写入路径。
- GUI 交互必须至少有 VM/DOM 测试；涉及真实页面布局时必须用浏览器做人工或自动
  验证。
- 每个 PR 合并前必须运行 `npm test`，并在 PR 描述中写明结果。
- 修复 bug 必须新增或更新能复现该 bug 的测试。
- 测试不得依赖真实 Multica 写入；写入路径必须使用 mock CLI 或明确隔离的测试
  环境。

## 文档与记录约束

- 用户可见能力、边界、命令或流程变化必须同步更新 `README.zh-CN.md` 或相关
  docs。
- 产品方向、路线图、非目标变化必须同步更新 PRD。
- 开发流程或合并门槛变化必须同步更新本文、`CONTRIBUTING.md` 和 PR checklist。
- 用户可见变更必须写入 `CHANGELOG.md` 的 `Unreleased` 区域。
- 监控、权限、skills、系统级指令、schema、协作边界和真实 Multica 写入结果
  必须记录到 `ops/monitoring/` 或专用 audit JSONL。

## Git 与 PR 约束

- 提交信息应该使用 Conventional Commits，例如 `feat(goal-plan): add issue split preview`。
- 一个 PR 应该只处理一个目标；混合产品、重构、样式和安全变更时必须在 PR 描述
  中拆开说明。
- 禁止未经明确指令直接合并到 `main`。
- 不得回滚或覆盖非本轮创建的用户改动；发现相关冲突时必须先说明风险。
- PR 描述必须包含：变更摘要、边界说明、测试结果、风险、后续动作。

## 安全约束

- 输入来自用户、Multica、文件、CLI stdout、浏览器或外部服务时都必须视为不可信。
- 输出到 HTML 时必须使用 DOM API 设置文本，不拼接未转义 HTML。
- 任何 shell/CLI 调用必须使用参数数组，不用字符串拼接命令。
- 审计记录必须 redact secret-like 字段。
- 权限、skills、MCP、metadata、系统级指令和环境变量写入必须走最小权限和短租约
  思路，并保留人工确认。
