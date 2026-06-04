# Multica++ 产品需求文档

## 1. 一句话结论

Multica++ 是 Multica 的 GUI-first 外接插件控制台，用 Goal、Plan 和一键配置
智能体权限，让多智能体运行更可见、可授权、可恢复、可审计。

## 2. 背景

Multica 已经具备任务队列、issue、agent、squad、runtime、skills、MCP、取消、
暂停和自动化等基础能力。Multica++ 的机会不是重做这些能力，而是在 Multica
之上补一个面向人的控制面：用户先看清目标、计划和权限，再决定是否继续运行。

多智能体协作的主要风险不在于缺少 agent，而在于运行目标容易漂移、计划缺少
持续记录、权限配置不够直观、任务中断后难以接回，以及事后无法说明为什么授予
了某些能力。GUI-first 的优先级可以先把这些关键决策点放到一个可见界面里，
再按界面逐步补齐底层功能。

## 3. 产品定位

Multica++ 是 Multica 的外接治理控制台，不是新的 Multica 工作台。

它负责：

- 展示并维护一次 agent run 的 Goal。
- 展示 Plan 步骤、状态、依赖、当前执行项和恢复入口。
- 提供一键智能体权限配置，覆盖模板、scope、TTL、审批和风险预览。
- 将运行上下文、权限决策和恢复记录沉淀为可审计记录。
- 在后续阶段接入现有 Runtime Agent Spec、Goal/Plan ledger 和权限短租约。

它不负责：

- 不替代 Multica 的项目、issue、agent、squad、runtime、skills、MCP 或自动化。
- 不复刻 Multica 左侧原生导航，不做完整 issue 管理、agent 管理或 runtime 管理。
- 不做完整 run history、用量中心、数据资产管理或系统设置中心。
- 不 fork Multica daemon，不做运行时逐字命令硬拦截。
- 不声明自动接管所有权限，也不绕过人工确认。

## 4. 目标用户

- 多 agent 协作负责人：需要快速确认这轮运行的目标、计划和权限边界。
- Agent operator：需要在任务中断、暂停或异常后恢复到可信状态。
- 安全敏感团队：需要短租约、审批、风险摘要和权限决策记录。
- 内部 Multica 使用团队：需要在不替换 Multica 的前提下提高可控性和审计性。

## 5. 核心体验

### 5.1 Goal

Goal 栏用于回答“这轮 agent 工作到底要完成什么”。

首版展示：

- 当前目标。
- 负责人或触发来源。
- 状态与完成度。
- 最新目标更新。
- 恢复或继续入口。

成功标准：

- 用户能在首屏读懂本次运行目标。
- 目标状态能和 Plan 进度对应。
- 任务中断后能看到最后可信恢复点。

### 5.2 Plan

Plan 栏用于回答“agent 准备如何完成目标，以及现在进行到哪里”。

首版展示：

- 有序计划步骤。
- pending、running、done、blocked 等状态。
- 步骤依赖。
- 当前执行项高亮。
- 阻塞项和后续动作。

成功标准：

- 用户能在首屏看清执行路径。
- 当前步骤、阻塞步骤和完成步骤明确。
- 后续接入 ledger 时能承载状态、证据和更新时间。

### 5.3 一键配置智能体权限

权限栏用于回答“这轮 agent 可以做什么，多久有效，是否需要审批”。

首版展示：

- 权限模板。
- scope/resource group。
- TTL lease。
- approval required。
- 风险摘要。
- 预览配置和应用权限按钮。

成功标准：

- 用户不需要进入 Multica 原生 agent 配置也能理解本次 run 的权限边界。
- 高风险 scope 不被静默授权。
- 权限配置可记录、可复盘、可逐步接入短租约。

## 6. GUI 信息架构

左侧导航最多保留 5 个入口：

- `Control`：主工作台，承载 Goal、Plan 和一键权限配置。
- `Permissions`：权限模板、scope、TTL、审批策略和风险预览。
- `Activity`：只展示与当前 Goal/Plan 相关的运行事件、阻塞和恢复点。
- `Records`：launch review、权限决策、配置变更和监控记录。
- `Settings`：插件级设置，例如默认模板、记录策略和 Multica CLI 连接状态。

不作为一级入口：

- `Project`：Multica 原生项目能力，插件只显示当前项目上下文。
- `Agents`：Multica 原生智能体能力，插件只配置当前 run 的权限。
- `Runs`：不做完整运行历史中心，只在 Activity 展示相关事件。
- `Environments`、`Runtime`、`Skills`：交给 Multica 原生能力。
- `Data`：作为权限资源组呈现，不做数据管理产品。
- `Docs`、`Support`：仅作为外链或帮助菜单。

## 7. 路线图

### M0：Launch Review 与基础 spec

目标：不 fork Multica，生成可审阅 Runtime Agent Spec、review markdown 和 ledger
draft。

状态：已完成。

### M1：真实 Multica 数据到 Runtime Agent Spec

目标：从真实 issue、agent、runtime、skills 只读数据生成 Runtime Agent Spec。

状态：已基本完成，包括模块拆分、schema v1、Multica CLI 只读 adapter、真实数据
映射、CLI lock/list 和三类 example。

### M2：GUI-first 三栏控制台

目标：先做本地静态 GUI 原型，用 mock 数据表达完整产品体验。

输出：

- 深色 Multica-like 控制台。
- 三栏首屏：Goal、Plan、Agent Permission Setup。
- 左侧导航：Control、Permissions、Activity、Records、Settings。
- 概念图与 prompt 记录。
- 不接真实 Multica CLI，不写 Multica metadata。

### M2.5：按 GUI 补齐底层能力

目标：让三栏界面逐步接入真实能力。

优先级：

1. Goal/Plan ledger：支持步骤状态、恢复点、证据和 blocked 原因。
2. 权限短租约：支持 TTL、审批字段、高风险自动要求确认。
3. Preset/Profile：从 issue、agent、workspace 生成默认 goal、plan 和权限模板。
4. 上游兼容：真实 CLI fixtures、fail-closed adapter 和 launch record 回传。

### M3：Activity 与 Records

目标：收敛与当前 Goal/Plan 相关的实时事件和审计记录。

输出：

- Activity 事件流。
- Records 审计记录。
- 暂停、恢复、失败和权限变更记录。
- 不重做完整 run history 或 Multica runtime 管理。

## 8. 成功指标

- 可见：用户能在首屏看到 Goal、Plan 和权限边界。
- 可授权：高风险权限有 TTL、审批和风险摘要。
- 可恢复：中断后能看到最后可信 Goal/Plan 状态。
- 可审计：权限决策、配置变更和恢复动作可追踪。
- 不重复建设：不替代 Multica 原生项目、issue、agent、runtime、skills 和 MCP 能力。

## 9. 风险与约束

- GUI-first 不能被误读为已具备所有真实运行控制能力，首版必须明确 mock 范围。
- 外接层不能硬拦截 runtime 最终命令，只能做启动前审阅、配置确认和旁路记录。
- Multica CLI 响应可能漂移，需要 fixtures 和 fail-closed adapter。
- schema、权限和模块边界属于高影响决策，必须经过明确评审。
- 所有 secret 只记录 key 名和风险，不记录明文值。

## 10. 内部推广口径

推荐说法：

Multica++ 是 Multica 的外接治理控制台，帮助公司内部多 agent 工作更可见、
可授权、可恢复、可审计。

避免说法：

- 不说 Multica++ 替代 Multica。
- 不说 Multica++ 全自动接管权限。
- 不说 agent 可以不经确认获得所有权限。
- 不说 Multica++ 重做任务队列、skills、MCP、暂停或取消能力。
- 不说使用后没有风险或不需要人工监督。
