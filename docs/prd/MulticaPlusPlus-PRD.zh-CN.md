# Multica++ 产品需求文档(PRD)

| 项目 | 内容 |
| --- | --- |
| 文档名称 | Multica++ 完整中文 PRD |
| 版本 | v1.0 |
| 状态 | 草稿 / 待评审 |
| 关联 issue | SPA-16(PRD-1) |
| 适用范围 | 指导 GUI-first 控制台、Goal/Plan、Agent assist 与 M2 backlog |
| 一句话定位 | Multica++ 是 Multica 类 agent 平台的**外接插件控制层**,让 agent 运行变得可见、可授权、可恢复、可审计。 |

> 本文是**产品需求文档**,描述"要解决什么问题、为谁解决、边界在哪、按什么顺序交付",不是工程实现计划。具体的接口签名、数据结构、模块拆分以 Runtime Agent Spec schema 与各模块代码为准。

---

## 1. 执行摘要

### 1.1 一句话结论

Multica 这类 agent 工具**已经具备**任务队列、agent 配置、skills、MCP 接入、运行中的取消 / 暂停等核心运行能力。Multica++ **不重做这些能力**,而是在它们之外补一层**插件控制层**:在任务启动前把"目标、计划、运行配置、权限范围、能力与风险"收敛成一份可评审的快照;在任务运行中和结束后,把"发生了什么、用了什么授权、能不能恢复"沉淀为可审计的账本。

简言之:**Multica 负责"跑",Multica++ 负责"让你在跑之前看得清、跑之中控得住、跑之后查得明"。**

### 1.2 为什么是"插件层"而不是"重做一个 Multica"

- **不 fork daemon。** 重写运行时既无必要也不可持续。Multica++ 以只读方式消费 Multica 的数据,不替换它的 issue board、运行时 daemon、skill 注册表或 autopilot 系统。
- **不做硬拦截。** Multica++ 不在运行时链路里插入强制阻断;它提供的是**启动前评审**与**运行后审计**,控制点落在"启动闸门"和"账本状态机",而非劫持每一次工具调用。
- **不伪造可达性。** 不假装拥有 browser / IDE 等 Multica++ 实际触达不到的运行时通道。能桥接的能力如实桥接,触达不到的如实标注缺口。

### 1.3 核心价值主张

| 维度 | 现状(裸 Multica) | Multica++ 补什么 |
| --- | --- | --- |
| **可见** | agent 启动后才知道它读到了什么指令、有什么权限 | 启动前生成 Runtime Agent Spec 快照 + 指令叠加 diff,先看后跑 |
| **可授权** | 权限多为长期、宽泛配置 | 短租约 token、最小 scope、高风险动作显式标记并要求确认 |
| **可恢复** | 任务中断后靠人工回溯 comment 拼现场 | goal/plan 账本记录 `draft -> locked -> running -> completed`,可定位到最后已知状态 |
| **可审计** | 用了哪些 secret env、MCP、repo:write 散落各处 | 能力与权限评审集中产出风险清单,事后可查 |

---

## 2. 背景与问题定义

### 2.1 现状:Multica 已经很能跑

Multica 类平台目前已经提供了一套完整的运行底座:

- **任务队列与触发**:issue 指派、comment @mention、autopilot 三类触发都能把任务推入 agent。
- **agent 配置**:provider、model、runtime、instructions、skills、env、MCP servers 都可配置。
- **能力接入**:skills 注册表、MCP server 接入,让 agent 能调用外部工具。
- **运行控制**:运行中的取消、暂停等基础生命周期操作已存在。

这些能力**不需要也不应该**被 Multica++ 重做。

### 2.2 问题:跑得动,但"跑之前 / 跑之中 / 跑之后"是黑盒

裸用 Multica 时,真正让用户焦虑的不是"能不能跑",而是控制面的缺失:

1. **启动前不可见。** 用户点下"派发"时,并不清楚 agent 最终会被注入哪些指令层,也不清楚它实际握有哪些权限和高风险能力。
2. **权限粗放且长效。** 权限往往是长期、宽泛的静态配置。一个只需要读 issue 的任务,可能携带着 `repo:write` 和一串 secret env。
3. **中断后难恢复。** 任务失败 / 被取消后,目标、计划、锁定状态散落在 comment 流里,只能靠人工回溯。
4. **事后难审计。** 运行到底碰了哪些 repo、用了哪些 secret、开了哪些 MCP、申请了哪些 scope,没有集中的可回溯记录。

### 2.3 Multica++ 的切入点

Multica++ 把控制面收敛成三个动作:

- **启动前**:产出一份可评审的 **Runtime Agent Spec**。
- **运行边界**:用**短租约 token + 最小 scope + 风险标记**约束授权。
- **运行后 / 中断时**:用 **goal/plan 账本状态机**记录状态流转,提供可恢复、可审计的现场。

当前 GUI-first 原型进一步把这三个动作显式化为两个页面:

- **控制台**:承载 Goal 与 Plan,明确展示 `Goal -> Plan -> Issue` 路径。
- **权限**:承载一键 Agent 权限配置,不再与 Goal/Plan 堆在同一页面。

---

## 3. 目标用户与使用场景

### 3.1 目标用户

| 角色 | 关心什么 | Multica++ 如何服务 |
| --- | --- | --- |
| **派发者 / 任务发起人** | 我派出去的 agent 会读到什么、能动什么 | 启动前看 Spec 快照与指令 diff,确认后再放行 |
| **平台 / 安全负责人** | 哪些运行碰了 secret、repo:write、MCP | 集中的能力权限评审 + 风险清单 + 短租约约束 |
| **运维 / 值班** | 任务断了,现场是什么,能不能接着跑 | goal/plan 账本定位最后已知状态,支持恢复判断 |
| **审计 / 复盘者** | 某次运行用了什么授权、做了什么 | 账本与 Spec 构成可回溯的启动与运行记录 |
| **多 agent 协作负责人** | 如何让目标、计划、Issue 拆分和权限边界一致 | 控制台把 Goal、Plan、Issue preview 与权限配置分开呈现 |

### 3.2 典型场景

1. **高风险任务的启动闸门。** 带 `repo:write` 和数据库 secret 的修复任务被派发前,用户在 Spec 评审里看到风险标记,确认无误后锁定账本再启动。
2. **指令叠加的事前审查。** autopilot 触发任务时,Multica++ 把最终 prompt 叠加结果渲染成 diff,避免 agent 实际读到的指令和用户预期不一致。
3. **中断恢复。** 任务在 `running` 阶段失败,运维查账本发现它已 `locked` 且记录了初始 plan,据此判断从哪一步接续。
4. **Agent 辅助 Goal/Plan。** 用户点击 Agent 辅助澄清或拆分时,Multica++ 通过本机 `multica` CLI 创建真实 assist issue/task,生成本地 draft Goal 或 planSet,但业务 Issue 仍保持 preview-first。
5. **事后审计。** 复盘某次越权疑虑时,直接调出 spec、账本事件链与能力评审,而非翻 comment。

---

## 4. 范围定义

### 4.1 范围内(In Scope)

- **Runtime Agent Spec**:一次 agent 运行的稳定 JSON 快照。
- **指令叠加评审(Instruction Overlay)**:把多层指令渲染为可读 diff,标注评审状态。
- **能力与权限评审(Capability & Permission Review)**:汇总 repos、env keys、secret-like env keys、MCP servers、token 类型、scopes,并产出风险标记。
- **goal/plan 账本(Ledger)**:`draft -> locked -> running -> completed` 的状态机与 JSONL 事件流。
- **统一 Multica 客户端(只读能力桥)**:以只读方式从 Multica 读取 issue / agent / runtime / skills,喂给 Spec 构建。
- **GUI-first 控制台**:以中文优先 UI 展示 Goal、Plan、Issue preview、权限配置、Activity、Records 与 Settings。
- **Multica Agent assist**:通过本机 `multica` CLI 创建 assist issue/task,辅助 Goal 澄清与 Goal -> 多 Plan 拆分。
- **Plan-to-Issue preview**:从 Plan 或 planSet 生成 Issue 候选,真实创建仍走显式确认。

### 4.2 范围外(Out of Scope / 非目标)

- **不 fork daemon。** 不重写、不分叉 Multica 运行时。
- **不替代 Multica 原生工作台。** 不复刻完整 project、issue、agent、squad、runtime、skills、MCP、run history、用量中心或系统设置页面。
- **不做运行时硬拦截。** 不在工具调用链路里插入强制阻断逻辑。
- **不伪造 browser / IDE 可达性。** 不假装拥有实际触达不到的运行时通道。
- **不存储 secret 值本身。** 能力评审只记录 secret-like env 的**键名**用于风险提示,绝不持久化其值。
- **Agent assist 不创建业务 Issue。** 它只生成本地 draft Goal / planSet;业务 Issue 创建仍必须通过 preview-first + confirmation token。

---

## 5. 插件切入顺序(产品演进主线)

### 5.1 第一刀:补 goal/plan 账本与运行配置差异

- 建立 **goal/plan 账本**:把一次运行的目标与计划用状态机沉淀下来,提供恢复与审计的最小地基。
- 暴露**运行配置差异**:把 agent 的运行配置(provider / model / runtime / 指令叠加)收敛成可对比、可评审的快照。

### 5.2 第二刀:补权限短租约与统一客户端能力桥

- **权限短租约**:从长效宽泛授权转向短 TTL、最小 scope 的 task-scoped token。
- **统一客户端能力桥**:用一个只读客户端把 Multica 侧的 issue / agent / runtime / skills 数据规范化地桥接进来。

### 5.3 第三刀:把实时流、取消、自动暂停收敛为实时控制台

- 把实时事件流、取消、自动暂停这些原本散落的运行时控制点,聚合到统一的可观测 / 可操作界面。
- 这一步消费 Multica 已有取消 / 暂停能力,Multica++ 做的是收敛与呈现,不是重新实现运行时控制。

---

## 6. GUI 信息架构与核心体验

### 6.1 左侧导航

当前 GUI 左侧是 Multica++ 插件导航,不复刻 Multica 原生工作台。一级入口最多保留:

- `控制台`
- `权限`
- `活动`
- `记录`
- `设置`

其中 `控制台` 是默认工作视图,承载 Goal 与 Plan;`权限` 独立承载一键 Agent 权限配置。

### 6.2 Goal

Goal 区用于回答"这轮 agent 工作到底要完成什么"。

首版展示:

- 当前目标。
- 负责人或触发来源。
- 状态与完成度。
- 最新目标更新。
- 恢复或继续入口。
- Agent 辅助澄清入口。

成功标准:

- 用户能在首屏读懂本次运行目标。
- 目标状态能和 Plan 进度对应。
- 任务中断后能看到最后可信恢复点。
- Agent assist 失败时显示 blocked 原因,不伪装成预置数据成功。

### 6.3 Plan

Plan 区用于回答"agent 准备如何完成目标,以及现在进行到哪里"。

首版展示:

- `Goal -> Plan -> Issue` 的流程轨迹。
- 有序计划步骤。
- pending、running、done、blocked 等状态。
- 步骤依赖。
- 当前执行项高亮。
- 阻塞项和后续动作。
- Agent 辅助拆分为多个并行 Plan。
- Plan 到 Issue preview,并明确 Issue 仍只是候选。

成功标准:

- 用户能在首屏看清执行路径。
- 当前步骤、阻塞步骤和完成步骤明确。
- 多 Plan 卡片能表达并行 workstream,并保留 suggested agent、依赖、验收证据。
- 后续接入 ledger 时能承载状态、证据和更新时间。

### 6.4 一键配置智能体权限

权限页用于回答"这轮 agent 可以做什么,多久有效,是否需要审批"。

首版展示:

- 权限模板。
- scope/resource group。
- TTL lease。
- approval required。
- 风险摘要。
- 预览配置和应用权限按钮。

成功标准:

- 用户不需要进入 Multica 原生 agent 配置也能理解本次 run 的权限边界。
- 高风险 scope 不被静默授权。
- 权限配置可记录、可复盘、可逐步接入短租约。

### 6.5 Agent 预制体体系

一键配置 Agent 后续不只是一个按钮,而是预制体体系。预制体把团队共同工作环境和实践样例沉淀为可复用配置,包含 skills、MCP、instructions、runtime hint、权限 scope、TTL、审批要求和环境配置路径提示。

首版分为两类:

- **插件预制体**:Multica++ 内置,覆盖 Planner、Executor、Review、Image2、Incident 等通用场景。
- **团队预制体**:团队成员从共同工作环境创建,带创建者、适用场景和默认配置。

第一版 GUI server 支持创建当前会话内的团队预制体,不写 Multica metadata,不写仓库文件,也不持久化。用户点击预制体后,可以修改默认 Agent 名称和 instructions,再 Preview dry-run 计划或创建 Multica Agent。

### 6.6 Settings

Settings 承载当前语言、Multica Agent assist 检测与高级 provider 配置。

- 当前正式语言默认 `zh-CN`,预留 `en-US`。
- Goal 澄清、Plan 拆分和 Issue preview 请求必须携带当前语言;中文 UI 下所有可视化字段应输出简体中文。
- `Multica Agent 辅助`展示 daemon、runtime、agent 状态,提供自动选择或手动选择 agent。
- 高级 Codex / Claude 直连 provider 保留为兼容诊断路径,默认不参与自动选择。
- 授权读取本机 LLM secret metadata 必须由用户输入确认 token,且只返回脱敏摘要。

---

## 7. 路线图(MVP / M1 / M2 / M3)

### MVP — 启动前可见(外接、最小闭环)

- **目标**:在任务启动前产出一份可评审的快照,把黑盒变可见。
- **交付能力**:
  - 从输入 JSON 生成 Runtime Agent Spec。
  - 渲染指令叠加 diff 与能力权限评审 markdown。
  - 通过 CLI 输出 spec.json、review.md。
- **状态**:已完成。

### M1 — 可恢复 + 数据桥(账本 + 只读客户端)

- **目标**:补 goal/plan 账本,补统一只读客户端。
- **交付能力**:
  - goal/plan 账本状态机与 JSONL 事件持久化。
  - 统一 Multica 客户端只读拉取 issue / agent / runtime / skills 并规范化。
  - 由只读 Multica 数据直接构建 Spec。
- **状态**:已基本完成,包括 schema v1、Multica CLI 只读 adapter、真实数据映射、CLI lock/list 和三类 example。

### M2 — GUI-first 控制台

- **目标**:用本地 GUI 原型表达完整产品体验,并逐步接入真实能力。
- **交付能力**:
  - 中文优先的深色 Multica-like 控制台。
  - 控制台两栏:Goal、Plan。
  - 独立权限页:Agent Permission Setup。
  - 左侧插件导航:控制台、权限、活动、记录、设置。
  - 插件预制体与团队预制体。
  - Agent assist Goal 澄清与 Plan 拆分。
  - Plan-to-Issue preview-first 路径。
- **状态**:进行中,已有 GUI server、CLI、测试与文档闭环。

### M2.5 — 按 GUI 补齐底层能力

优先级:

1. Goal/Plan ledger:支持步骤状态、恢复点、证据和 blocked 原因。
2. Multica Agent assist:通过本机 `multica` CLI 选择 agent,创建 assist issue/task,解析 JSON 输出。
3. 权限短租约:支持 TTL、审批字段、高风险自动要求确认。
4. Preset/Profile:从团队共同环境沉淀默认 skills、MCP、instructions、runtime、权限、TTL、审批和环境配置路径提示。
5. 上游兼容:真实 CLI fixtures、fail-closed adapter 和 launch record 回传。

### M3 — Activity、Records 与实时控制台

- **目标**:收敛与当前 Goal/Plan 相关的实时事件和审计记录。
- **交付能力**:
  - Activity 事件流。
  - Records 审计记录。
  - 暂停、恢复、失败和权限变更记录。
  - 取消 / 自动暂停信号统一入口。
- **边界**:不重做完整 run history 或 Multica runtime 管理。

---

## 8. 产品能力详述

### 8.1 Runtime Agent Spec(运行快照)

一次 agent 运行的稳定快照,是评审、账本、审计共同引用的单一事实来源。它至少表达目标、workspace / repos、agent / runtime / model、skills、叠加后的指令、能力与权限、申请的权限范围以及初始计划。

产品要求:

- schema **版本化**。
- 结构**稳定且可降级**:字段缺失时给出默认值与告警。
- spec 有明确生命周期状态,与账本状态机协同但不混淆。

### 8.2 指令叠加评审(Instruction Overlay)

把 workspace context、agent instructions、task prompt、trigger comment、autopilot 上下文等多层指令合成 agent 实际会读到的形态,并以 diff 呈现。

产品要求:让派发者在启动前确认"agent 实际读到的指令"与预期一致,杜绝隐式叠加导致的意外行为。

### 8.3 能力与权限评审(Capability & Permission Review)

汇总并评估一次运行的能力面:repos、env keys、secret-like env keys(仅键名)、MCP servers、token 类型、scopes,产出风险标记。

产品要求:

- 风险项**显式可见**。
- **绝不持久化 secret 值**。
- 风险标记可作为启动闸门的判定输入。

### 8.4 goal/plan 账本(Ledger)

以 JSONL 事件流记录一次 spec 的状态流转:`draft -> locked -> running -> completed`,并允许 `running -> amended -> locked` 的修订回环。非法流转必须被拒绝。

产品要求:

- 状态机**收口**,只允许合法跃迁。
- lock 事件记录批准信息。
- 提供"查最新状态""列全部事件"的读路径。

### 8.5 统一 Multica 客户端(只读能力桥)

以**只读**方式经由 `multica` CLI 拉取 issue / agent / runtime / skills 数据,规范化后供 Spec 构建使用。

产品要求:

- **只读**,不改 Multica 任何状态。
- 字段缺失输出 warning,而非静默或崩溃。
- 是 Multica++ 与 Multica 之间的数据桥,保持边界清晰。

### 8.6 Multica Agent assist

Goal 澄清和 Goal -> 多 Plan 拆分默认通过本机 `multica` CLI 调用可用 Multica Agent:

- 发现 daemon、runtime 和 agent 非敏感状态。
- 用户可手动选择 agent,也可自动选择 planner/lead/architect 类 agent。
- 点击即创建真实 assist issue/task,并在 UI 和 audit 中显示 issue/run。
- Agent 输出必须是可解析 JSON;解析失败、超时、危险写入指令或字段不足都返回 blocked。
- 生成的 draft Goal / planSet 不创建业务 Issue,不写权限/schema。

### 8.7 Plan-to-Issue preview

Plan 或 planSet 可以生成 Issue 候选,用于人工确认是否拆分为业务 Issue。

产品要求:

- small local work 不强制创建 issue。
- 单一交付物生成一个 issue。
- 独立 workstream 才生成多个 issue candidate。
- 真实创建必须显式 `--execute` + confirmation token。

---

## 9. 对 M2 backlog 的指导

- 所有 M2 issue 必须落在 GUI-first 控制台、Goal/Plan、Agent assist、权限短租约或风险闸门主题内。
- 不得借机扩散到运行时硬拦截或 daemon 改动。
- 涉及 schema、权限边界、协作角色或模块边界变更的需求,必须升级给架构师裁定。
- 高风险动作(repo:write / shell:write / MCP / secret-env)必须被显式标注,并对应到"启动需确认"验收条款。
- 每个 issue 必须带明确验收口径,不能只写"代码完成"。

---

## 10. 成功指标

- **可见**:用户能在首屏看到 Goal、Plan 和 Issue preview 路径。
- **可授权**:高风险权限有 TTL、审批和风险摘要。
- **可恢复**:中断后能看到最后可信 Goal/Plan 状态。
- **可审计**:权限决策、配置变更和恢复动作可追踪。
- **语言一致**:中文 UI 下 Goal、Plan 和 Issue preview 的可视化文案为中文。
- **不重复建设**:不替代 Multica 原生项目、issue、agent、runtime、skills 和 MCP 能力。

---

## 11. 约束、假设与风险

### 11.1 约束

- 仅通过 `multica` CLI 与 Multica 平台交互,不直接打 HTTP / API。
- 不持久化任何 secret 值。
- schema 与模块边界为受控资产,变更需架构师批准。
- 真实 Multica 写入默认 dry-run,真实执行必须显式确认。

### 11.2 假设

- Multica 的 issue / agent / runtime / skills 只读数据可经 CLI 稳定获取。
- Multica Agent 能在 assist issue/task 中输出可解析 JSON。
- Multica 已提供的取消 / 暂停能力可被 M3 控制台消费。

### 11.3 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Multica 数据结构演进导致客户端字段缺失 | Spec 构建降级 | 缺失即 warning + 默认值,schema 版本化 |
| 用户误把 Multica++ 当成运行时拦截器 | 期望错位 | PRD 反复声明非目标,控制点限定在闸门 + 账本 |
| secret 值误入产物 | 安全事故 | 仅记录键名,评审与账本均不落值 |
| Agent assist run 超时或输出非 JSON | 用户看不到可用 Plan | 返回 blocked diagnostic,显示 assist issue/run 便于追踪 |
| M3 控制台被误解为重做运行时 | 范围蔓延 | 明确"收敛呈现 + 消费已有能力",不重实现 |

---

## 12. 术语表

| 术语 | 含义 |
| --- | --- |
| Runtime Agent Spec | 一次 agent 运行的版本化 JSON 快照,评审 / 账本 / 审计的单一事实来源 |
| Instruction Overlay | 多层指令叠加后的可读 diff,带评审状态 |
| Capability & Permission Review | 能力与权限评审,产出风险标记 |
| Ledger | goal/plan 账本,状态机 + JSONL 事件流 |
| Multica Agent assist | 通过 Multica CLI 创建 assist issue/task,让现有 agent 辅助生成 Goal 或 Plan |
| 短租约 token | 短 TTL、task-scoped 的最小权限令牌 |
| 风险标记(risk flag) | 对高风险能力 / 权限的显式标注 |
| 启动闸门 | 未通过评审 / 确认则不可 lock / 启动的控制点 |

---

## 13. 开放问题

- M2 短租约 token 的 TTL 默认值与可调范围,需结合 Multica 实际 token 模型确定。
- M3 实时控制台的实时通道需确认其可达性,严禁伪造。
- 账本的存储介质在更深集成阶段是否上移到 Multica 任务认领流附近,属未来决策,MVP/M1 保持外接。
- Agent assist 是否需要自动归档 assist issue,后续按用户追踪需求决定。

---

## 14. 内部推广口径

推荐说法:

Multica++ 是 Multica 的外接治理控制台,帮助公司内部多 agent 工作更可见、可授权、可恢复、可审计。

避免说法:

- 不说 Multica++ 替代 Multica。
- 不说 Multica++ 全自动接管权限。
- 不说 agent 可以不经确认获得所有权限。
- 不说 Multica++ 重做任务队列、skills、MCP、暂停或取消能力。
- 不说使用后没有风险或不需要人工监督。

---

*本 PRD 描述产品需求与边界,供 squad 据此拆分 backlog;一切结构契约以 Runtime Agent Spec schema 为准。*
