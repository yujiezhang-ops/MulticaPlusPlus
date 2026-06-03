# Multica++ 产品需求文档

## 1. 一句话结论

Multica 类工具已经有任务队列、智能体配置、技能包、MCP 和取消/暂停机制；
Multica++ 的机会不是重做这些能力，而是把计划、目标、权限、客户端能力和
运行配置收敛成一个可见、可授权、可恢复、可审计的插件控制层。

## 2. 背景

多智能体协作的主要风险不在于缺少 agent，而在于用户看不清一次运行实际会
带着什么上下文、权限、技能和运行配置启动。任务开始后，目标和计划容易漂移，
权限授权过长或过宽，运行中断后缺少可恢复依据，事后也难以审计为什么执行了
某些动作。

Multica 已经提供任务、issue、agent、squad、runtime、skills、MCP、取消、
暂停和自动化等基础能力。Multica++ 应作为外接 Launch Review 与控制层，
围绕一次 agent run 建立可审阅的 Runtime Agent Spec、Goal/Plan 账本、
权限短租约、能力可达性说明和运行控制台。

## 3. 产品定位

Multica++ 是 Multica 的外接插件控制层。

它负责：

- 在 agent 启动前生成可审阅、可锁定的 Runtime Agent Spec。
- 展示目标、初始计划、任务来源、agent、runtime、skills、MCP、env key 和权限。
- 对比 workspace、agent、task、comment、autopilot 等指令层的运行配置差异。
- 记录 Goal/Plan 的状态、证据、变更与恢复点。
- 将权限从静态 risk flag 升级为短租约和人工审批。
- 在能力边界内探测 shell、repo、MCP 等本层可达资源。
- 汇总实时流、取消、暂停、自动暂停和恢复入口，形成运行控制台。

它不负责：

- 不替换 Multica 的 issue board、任务队列、agent 配置、skills、MCP registry。
- 不 fork Multica daemon，不做运行时逐字命令硬拦截。
- 不伪造 browser、IDE 等客户端工具的真实可达性。
- 不把外接层升级为新的完整 agent 平台。

## 4. 目标用户

- 多 agent 协作的项目负责人：需要知道谁在跑、带什么权限、是否偏离目标。
- 安全敏感的工程团队：需要最小授权、短 TTL、审批记录和事后审计。
- 需要恢复长任务的 agent operator：需要从失败、中断、暂停后恢复计划状态。
- 使用 Multica 管理 Claude/Codex 等 agent 的团队：需要把协作协议和运行记录
  产品化。

## 5. 核心场景

### 5.1 启动前审阅

用户在派发 issue、comment trigger 或 autopilot run 前，先生成 Runtime Agent
Spec。Spec 展示本次运行的 goal、task、agent、runtime、skills、MCP、env key、
permission scopes、初始 plan 和 instruction overlay diff。

成功标准：

- 用户能在启动前看懂本次 run 会带着什么跑。
- 高风险能力被明确标记。
- Spec 能被锁定并写入 ledger。

### 5.2 权限短租约与审批

系统默认不长期授予写权限。读权限使用较短 TTL，写权限使用更短 TTL，高风险
能力需要单次确认。

成功标准：

- repo write、shell write、secret env、MCP 等高风险项自动要求审批。
- 权限记录包含审批人、过期时间和审批状态。
- 缺失或畸形权限输入 fail-closed 到安全默认值。

### 5.3 Goal/Plan 账本

用户不仅看到初始计划，还能看到 plan item 的状态、owner、证据、更新时间和
阻塞原因。任务恢复时，agent 可以从 ledger 中找回最后可信计划状态。

成功标准：

- plan item 可从 pending/in progress/done/blocked 等状态中追踪。
- 每次计划变更有 changedAt 和 evidence。
- 旧的 string plan 输入可以兼容升级，不破坏已有用例。

### 5.4 能力可达性说明

Multica++ 在本层可达范围内探测 shell、repo、MCP server 等能力，无法探测的
客户端能力必须标记为 unknown 或 cannot probe。

成功标准：

- 可达、不可达、无法探测三类状态明确。
- 不可达项展示原因。
- 不声称能检查 browser/IDE 的真实客户端状态。

### 5.5 实时控制台

在 M3 阶段，用户通过一个控制台查看 run 的实时输出、状态、权限、plan 进度、
取消、暂停、自动暂停和恢复入口。

成功标准：

- 用户能在一个视图里知道 run 是否仍可信。
- 取消/暂停行为和原因可追踪。
- 控制台不替代 Multica runtime，只收敛和解释已有控制能力。

## 6. 产品能力拆分

### 6.1 Runtime Agent Spec

当前已具备的基础能力：

- `buildRuntimeAgentSpec` 从输入生成 spec。
- `renderLaunchReviewMarkdown` 输出审阅 Markdown。
- `from-multica` 可从只读 Multica 数据生成 spec。
- schema v1 使用 zod 做 fail-closed 校验。

后续增强：

- 权限字段扩展为审批与短租约结构。
- initialPlan 升级为可追踪 plan item ledger。
- version drift 和真实 CLI fixtures 纳入兼容测试。

### 6.2 Instruction Overlay Diff

当前覆盖 workspace、agent、task、comment、autopilot 相关指令层。

后续增强：

- 标记覆盖关系和禁用语义。
- 在 PRD/控制台中展示“本次 run 的最终有效指令”。
- 对危险指令或冲突指令给出人工审阅提示。

### 6.3 Capability And Permission Review

当前覆盖 repos、env keys、secret-like env keys、MCP servers、token type、
scopes 和 risk flags。

后续增强：

- 从 risk flags 升级为可审批权限网关。
- 增加本层可达性探测。
- 把不可达原因写入 launch review。

### 6.4 Goal/Plan Ledger

当前 ledger 已能记录 draft、locked、running、completed 等状态。

后续增强：

- 将 plan item 纳入 ledger。
- 支持恢复点、证据和 blocked 原因。
- 将 specId 或 launch record 回传到 Multica issue metadata/comment。

### 6.5 Preset/Profile 初始化

新增 preset/profile 能力后，用户可以输入 issue、agent、workspace 生成最佳实践
默认 spec。

默认配置应包含：

- 少量明确 agent。
- 明确 goal。
- 初始 plan。
- 必选 skills。
- lint/test 要求。
- 安全 TTL。
- 人工确认策略。

### 6.6 实时控制台

M3 控制台收敛已有实时能力，而不是重做 runtime。

控制台应展示：

- run 基本信息和 specId。
- goal 和 plan item 进度。
- 权限状态和过期时间。
- instruction overlay diff。
- capability 可达性。
- 实时输出摘要。
- 取消、暂停、自动暂停、恢复入口。

## 7. 路线图

### M0：外接 Launch Review 原型

目标：不 fork Multica，生成可审阅 spec、review markdown 和 ledger draft。

状态：已完成。

### M1：从手写 JSON 到真实 Multica 数据

目标：从真实 issue、agent、runtime、skills 只读数据生成 Runtime Agent Spec。

状态：已基本完成，包括模块拆分、schema v1、multica-client、真实数据映射、
CLI lock/list 和三类 example。

### M2：插件控制层最小闭环

目标：把“可见、可授权、可恢复、可审计”落到 spec、ledger、权限和能力探测。

优先级：

1. 权限网关：短租约、审批字段、高风险自动审批。
2. Goal/Plan 可见性：initialPlan 升级为 plan item ledger。
3. Capability Bridge：本层可达探测和不可达原因。
4. Preset/Profile：一键最佳实践初始化。
5. 上游兼容：真实响应 fixtures 和 launch record 回传。

### M3：实时控制台

目标：收敛现有实时流、取消、暂停和自动暂停机制，形成运行控制台。

输出：

- 控制台信息架构。
- Run state model。
- 控制动作与审计记录。
- 恢复点和失败后继续运行策略。

## 8. 成功指标

- 启动前审阅：每个高风险 run 都能生成并锁定 spec。
- 安全默认：写权限和高风险能力不会被静默长期授权。
- 可恢复：中断后能从 ledger 找到最后可信 goal/plan 状态。
- 可审计：一次 run 的 spec、审批、plan 变更、状态变化和结果可追踪。
- 集成成本：不 fork daemon 的前提下完成 M2 最小闭环。

## 9. 风险与约束

- 外接层不能硬拦截 runtime 最终命令，只能做启动前审阅、锁定和旁路记录。
- Multica CLI 响应可能漂移，需要 fixtures 和 fail-closed adapter。
- schema、权限和模块边界属于高影响决策，必须由 Claude-Lead 裁定。
- Codex 执行局部实现时不得擅自扩 schema 或改变协作边界。
- 所有 secret 只记录 key 名和风险，不记录明文值。

## 10. 当前待办映射

- `SPA-10`：权限网关。
- `SPA-11`：Goal/Plan plan item ledger。
- `SPA-12`：Capability Bridge。
- `SPA-13`：Preset/Profile 初始化。
- `SPA-14`：上游兼容加固。

这些 issue 构成 M2 的最小产品闭环。M3 实时控制台应在 M2 完成后启动。

