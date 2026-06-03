# Multica++ 产品需求文档(PRD)

| 项目 | 内容 |
| --- | --- |
| 文档名称 | Multica++ 完整中文 PRD |
| 版本 | v1.0 |
| 状态 | 草稿 / 待评审 |
| 关联 issue | SPA-16(PRD-1) |
| 适用范围 | 指导 SPA-10 ~ SPA-14 的 M2 backlog |
| 一句话定位 | Multica++ 是 Multica 类 agent 平台的**外接插件控制层**,让 agent 运行变得可见、可授权、可恢复、可审计。 |

> 本文是**产品需求文档**,描述"要解决什么问题、为谁解决、边界在哪、按什么顺序交付",不是工程实现计划。具体的接口签名、数据结构、模块拆分以 Runtime Agent Spec schema 与各模块代码为准。

---

## 1. 执行摘要

### 1.1 一句话结论

Multica 这类 agent 工具**已经具备**任务队列、agent 配置、skills、MCP 接入、运行中的取消 / 暂停等核心运行能力。Multica++ **不重做这些能力**,而是在它们之外补一层**插件控制层**:在任务启动前把"目标、计划、运行配置、权限范围、能力与风险"收敛成一份可评审的快照;在任务运行中和结束后,把"发生了什么、用了什么授权、能不能恢复"沉淀为可审计的账本。

简言之:**Multica 负责"跑",Multica++ 负责"让你在跑之前看得清、跑之中控得住、跑之后查得明"。**

### 1.2 为什么是"插件层"而不是"重做一个 Multica"

- **不 fork daemon。** 重写运行时既无必要也不可持续。Multica++ 以只读方式消费 Multica 的数据(通过统一客户端),不替换它的 issue board、运行时 daemon、skill 注册表或 autopilot 系统。
- **不做硬拦截。** Multica++ 不在运行时链路里插入强制阻断;它提供的是**启动前评审**与**运行后审计**,控制点落在"启动闸门"和"账本状态机",而非劫持每一次工具调用。
- **不伪造可达性。** 不假装拥有 browser / IDE 等 Multica++ 实际触达不到的运行时通道。能桥接的能力如实桥接,触达不到的如实标注缺口。

### 1.3 核心价值主张

| 维度 | 现状(裸 Multica) | Multica++ 补什么 |
| --- | --- | --- |
| **可见** | agent 启动后才知道它读到了什么指令、有什么权限 | 启动前生成 Runtime Agent Spec 快照 + 指令叠加 diff,先看后跑 |
| **可授权** | 权限多为长期、宽泛配置 | 短租约 token、最小 scope、高风险动作显式标记并要求确认 |
| **可恢复** | 任务中断后靠人工回溯 comment 拼现场 | goal/plan 账本记录 `draft → locked → running → completed`,可定位到最后已知状态 |
| **可审计** | 用了哪些 secret env、MCP、repo:write 散落各处 | 能力与权限评审集中产出风险清单,事后可查 |

---

## 2. 背景与问题定义

### 2.1 现状:Multica 已经很能跑

Multica 类平台(及其同类 agent 运行时)目前已经提供了一套完整的运行底座:

- **任务队列与触发**:issue 指派、comment @mention、autopilot 三类触发都能把任务推入 agent。
- **agent 配置**:provider、model、runtime、instructions、skills、env、MCP servers 都可配置。
- **能力接入**:skills 注册表、MCP server 接入,让 agent 能调用外部工具。
- **运行控制**:运行中的取消、暂停等基础生命周期操作已存在。

这些能力**不需要也不应该**被 Multica++ 重做。

### 2.2 问题:跑得动,但"跑之前 / 跑之中 / 跑之后"是黑盒

裸用 Multica 时,真正让用户焦虑的不是"能不能跑",而是控制面的缺失:

1. **启动前不可见。** 用户点下"派发"时,并不清楚这个 agent 最终会被注入哪些指令层(workspace context、agent instructions、task prompt、trigger comment、autopilot 上下文叠加后的真实形态),也不清楚它实际握有哪些权限和高风险能力。等于闭着眼签授权。
2. **权限粗放且长效。** 权限往往是长期、宽泛的静态配置。一个只需要读 issue 的任务,可能携带着 `repo:write` 和一串 secret env,且 token 长期有效。最小授权与短租约缺位。
3. **中断后难恢复。** 任务跑到一半失败 / 被取消后,"它当时的目标是什么、计划走到哪一步、是否已经锁定"这些信息散落在 comment 流里,只能靠人工考古。缺少一份结构化的 goal/plan 账本。
4. **事后难审计。** 这次运行到底碰了哪些 repo、用了哪些 secret、开了哪些 MCP、申请了哪些 scope——没有集中的、可回溯的评审记录。

### 2.3 Multica++ 的切入点

Multica++ 把控制面收敛成三个动作:

- **启动前**:产出一份可评审的 **Runtime Agent Spec**(目标 + 运行配置 + 指令叠加 + 能力权限评审 + 初始计划),让人先看后批。
- **运行边界**:用**短租约 token + 最小 scope + 风险标记**约束授权,把高风险动作显式暴露。
- **运行后 / 中断时**:用 **goal/plan 账本状态机**记录每一步状态流转,提供可恢复、可审计的现场。

---

## 3. 目标用户与使用场景

### 3.1 目标用户

| 角色 | 关心什么 | Multica++ 如何服务 |
| --- | --- | --- |
| **派发者 / 任务发起人** | 我派出去的 agent 会读到什么、能动什么 | 启动前看 Spec 快照与指令 diff,确认后再放行 |
| **平台 / 安全负责人** | 哪些运行碰了 secret、repo:write、MCP | 集中的能力权限评审 + 风险清单 + 短租约约束 |
| **运维 / 值班** | 任务断了,现场是什么,能不能接着跑 | goal/plan 账本定位最后已知状态,支持恢复判断 |
| **审计 / 复盘者** | 某次运行用了什么授权、做了什么 | 账本与 Spec 构成可回溯的启动与运行记录 |

### 3.2 典型场景

1. **高风险任务的启动闸门。** 一个带 `repo:write` 和数据库 secret 的修复任务被派发前,派发者在 Spec 评审里看到 `repo_write_scope`、`secret_env:DB_PASSWORD` 等风险标记,确认无误后锁定(lock)账本再启动。
2. **指令叠加的事前审查。** autopilot 触发的任务,其最终 prompt 是 workspace context + agent instructions + autopilot 上下文层层叠加的结果。Multica++ 把叠加结果渲染成 diff,避免"agent 实际读到的指令和你以为的不一样"。
3. **中断恢复。** 任务在 `running` 阶段崩溃,运维查账本发现它已 `locked` 且记录了初始 plan,据此判断从哪一步接续,而不是从零重派。
4. **事后审计。** 复盘某次越权疑虑时,直接调出该 spec 的账本事件链与能力评审,而非翻 comment 考古。

---

## 4. 范围定义

### 4.1 范围内(In Scope)

- **Runtime Agent Spec**:一次 agent 运行的稳定 JSON 快照(schema 版本化,见第 7 节)。
- **指令叠加评审(Instruction Overlay)**:把多层指令渲染为可读 diff,标注评审状态。
- **能力与权限评审(Capability & Permission Review)**:汇总 repos、env keys、secret-like env keys、MCP servers、token 类型、scopes,并产出风险标记。
- **goal/plan 账本(Ledger)**:`draft → locked → running → completed`(及 `amended`)的状态机与 JSONL 事件流。
- **统一 Multica 客户端(只读能力桥)**:以只读方式从 Multica 读取 issue / agent / runtime / skills,喂给 Spec 构建。

### 4.2 范围外(Out of Scope / 非目标)

明确不做以下事项,这是产品边界的硬约束:

- **不 fork daemon。** 不重写、不分叉 Multica 运行时;不替换其 issue board、运行时 daemon、skill 注册表、autopilot 系统。
- **不做运行时硬拦截。** 不在工具调用链路里插入强制阻断逻辑。控制点是"启动闸门 + 账本状态机",不是逐次调用劫持。
- **不伪造 browser / IDE 可达性。** 不假装拥有实际触达不到的运行时通道;桥接能桥接的,如实标注桥接不到的。
- **不存储 secret 值本身。** 能力评审只记录 secret-like env 的**键名**用于风险提示,绝不持久化其值。

---

## 5. 插件切入顺序(产品演进主线)

Multica++ 的能力不是一次性铺开,而是按"先补账本 / 配置差异 → 再补权限 / 能力桥 → 最后收敛为实时控制台"的顺序切入。这条主线决定了路线图(第 6 节)的阶段划分。

### 5.1 第一刀:补 goal/plan 账本与运行配置差异

最先要解决的是"中断后无现场"和"启动前看不清配置"。因此第一步落在:

- 建立 **goal/plan 账本**:把一次运行的目标与计划用状态机沉淀下来,提供恢复与审计的最小地基。
- 暴露**运行配置差异**:把 agent 的运行配置(provider / model / runtime / 指令叠加)收敛成可对比、可评审的快照,让"实际要跑的配置"显式化。

> 这一步几乎全是只读 + 本地产物,风险最低,却立刻把黑盒变成可见。

### 5.2 第二刀:补权限短租约与统一客户端能力桥

在"看得清"之上,补"控得住"和"读得齐":

- **权限短租约**:从长效宽泛授权转向短 TTL、最小 scope 的 task-scoped token,并对 `repo:write`、secret env、MCP 等高风险项显式标记。
- **统一客户端能力桥**:用一个只读客户端把 Multica 侧的 issue / agent / runtime / skills 数据规范化地桥接进来,让 Spec 构建有一致、可降级(missing 即告警而非崩溃)的数据源。

### 5.3 第三刀:把实时流、取消、自动暂停收敛为实时控制台

当账本、配置、权限、能力桥都就位后,最后把分散的运行时信号收敛成一个**实时控制台**:

- 把**实时事件流**、**取消**、**自动暂停**这些原本散落的运行时控制点,聚合到统一的可观测 / 可操作界面。
- 注意:这一步消费的是 Multica 已有的取消 / 暂停能力(参见 1.1),Multica++ 做的是**收敛与呈现**,不是重新实现运行时控制,也不违反"不做硬拦截"的边界。

---

## 6. 路线图(MVP / M1 / M2 / M3)

路线图与第 5 节的切入顺序一一对应。每个阶段给出**目标、交付能力、验收信号**。阶段边界以"用户能拿到什么价值"划分,而非以代码模块划分。

### MVP — 启动前可见(外接、最小闭环)

- **目标**:在任务启动前产出一份可评审的快照,把黑盒变可见。这是完全外接、不触碰运行时的最小闭环。
- **交付能力**:
  - 从一份输入 JSON 生成 **Runtime Agent Spec**(目标 / workspace / task / agent / runtime / skills / 初始计划)。
  - 渲染**指令叠加 diff** 与 **能力权限评审 markdown**(repos / env keys / secret env keys / MCP / scopes / 风险标记)。
  - 通过 CLI 输出 spec.json、review.md。
- **验收信号**:用户给定一次任务输入,能在启动前看到完整、可读的 Spec 与风险清单。

### M1 — 可恢复 + 数据桥(账本 + 只读客户端)

- **目标**:对应"第一刀"与"第二刀"的数据基础——补 goal/plan 账本,补统一只读客户端。
- **交付能力**:
  - **goal/plan 账本**:`draft → locked → running → completed`(含 `amended`)状态机,JSONL 事件持久化,非法流转拒绝。
  - **统一 Multica 客户端**:只读拉取 issue / agent / runtime / skills 并规范化,字段缺失降级为 warning 而非崩溃。
  - 由只读 Multica 数据直接构建 Spec(`from-multica` 路径)。
- **验收信号**:一次运行可被记录为可回溯的账本事件链;Spec 可从真实 Multica 数据生成。

### M2 — 可授权(权限短租约 + 风险闸门收口)

- **目标**:对应"第二刀"的权限侧——把授权从长效宽泛收敛为短租约、最小 scope、高风险显式确认。**这是 SPA-10 ~ SPA-14 backlog 的主战场。**
- **交付能力**(产品需求层面,具体拆分见第 8 节):
  - 短 TTL、task-scoped token 的权限模型与 scope 最小化校验。
  - 高风险动作(repo:write / shell:write / secret env / MCP)的统一风险标记与"启动需确认"闸门。
  - 账本与权限评审在 lock 环节的强一致校验(批准记录 `approvedBy`)。
- **验收信号**:高风险任务在未经评审确认时无法被 lock / 启动;授权范围与 TTL 可在 Spec 中明示。

### M3 — 可控:实时控制台

- **目标**:对应"第三刀"——把实时流、取消、自动暂停收敛为统一实时控制台。
- **交付能力**:
  - 运行中事件流的聚合呈现。
  - 取消 / 自动暂停信号的统一入口(消费 Multica 已有能力,不重做运行时)。
  - 账本与实时状态的联动视图(运行态可视 + 可恢复定位)。
- **验收信号**:用户能在一个界面观测运行态并触达取消 / 暂停,且操作落到账本可审计。

> 阶段是累进的:后一阶段建立在前一阶段的 Spec / 账本 / 客户端之上,不推倒重来。

---

## 7. 产品能力详述

> 本节描述四大能力**对用户意味着什么**(产品视角),不规定实现。Runtime Agent Spec 的 schema 是唯一权威结构契约,由架构师裁定,成员不得擅改。

### 7.1 Runtime Agent Spec(运行快照)

一次 agent 运行的稳定快照,是评审、账本、审计共同引用的单一事实来源。它至少表达:这次运行的**目标**、在哪个 **workspace / 哪些 repo**、由哪个 **agent / runtime / model** 执行、带哪些 **skills**、叠加后的**指令**、评审出的**能力与权限**、申请的**权限范围**、以及**初始计划**。

产品要求:
- schema **版本化**(带 `schemaVersion`),演进可识别、可兼容。
- 结构**稳定且可降级**:字段缺失时给出默认值与告警,而不是让评审流程崩溃。
- spec 有明确生命周期状态(draft / approved / rejected),与账本状态机协同但不混淆。

### 7.2 指令叠加评审(Instruction Overlay)

把 workspace context、agent instructions、task prompt、trigger comment、autopilot 上下文等**多层指令**合成 agent 实际会读到的形态,并以 **diff** 呈现,带评审状态(pending / approved / rejected)。

产品要求:让派发者在启动前确认"agent 实际读到的指令"与预期一致,杜绝隐式叠加导致的意外行为。

### 7.3 能力与权限评审(Capability & Permission Review)

汇总并评估一次运行的能力面:repos、env keys、**secret-like env keys(仅键名)**、MCP servers、token 类型、scopes,产出**风险标记**(如高风险 skill、secret env、MCP 启用、repo:write scope、shell:write skill)。

产品要求:
- 风险项**显式可见**,不隐藏在配置深处。
- **绝不持久化 secret 值**,只用键名做风险提示。
- 风险标记可作为启动闸门(M2)的判定输入。

### 7.4 goal/plan 账本(Ledger)

以 JSONL 事件流记录一次 spec 的状态流转:`draft → locked → running → completed`,并允许 `running → amended → locked` 的修订回环。非法流转必须被拒绝。

产品要求:
- 状态机**收口**,只允许合法跃迁。
- lock 事件记录批准信息(`approvedBy`),为审计留痕。
- 提供"查最新状态""列全部事件"的读路径,支撑恢复与审计。

### 7.5 统一 Multica 客户端(只读能力桥)

以**只读**方式经由 `multica` CLI 拉取 issue / agent / runtime / skills 数据,规范化后供 Spec 构建使用。

产品要求:
- **只读**,不改 Multica 任何状态。
- 字段缺失 → warning(可观测),而非静默或崩溃。
- 是 Multica++ 与 Multica 之间唯一的数据桥,保持边界清晰。

---

## 8. 对 M2 backlog(SPA-10 ~ SPA-14)的指导

本 PRD 的 M2 阶段(第 6 节)即 SPA-10 ~ SPA-14 的产品依据。落 backlog 时遵循以下口径(具体 issue 由 squad leader 拆分与分派):

- 所有 M2 issue 必须落在**权限短租约 + 风险闸门**主题内,不得借机扩散到运行时硬拦截或 daemon 改动(违反第 4.2 节边界)。
- 涉及 **schema 或模块边界**变更的需求,必须升级给架构师裁定,执行者不得自行修改。
- 高风险动作(repo:write / shell:write / MCP / secret-env)在 backlog 中应被显式标注,并对应到"启动需确认"的验收条款。
- 每个 issue 必须带**明确验收口径**(用户能验证的行为,而非"代码写完了")。

---

## 9. 约束、假设与风险

### 9.1 约束

- 仅通过 `multica` CLI 与 Multica 平台交互,不直接打 HTTP / API。
- 不持久化任何 secret 值。
- schema 与模块边界为受控资产,变更需架构师批准。

### 9.2 假设

- Multica 的 issue / agent / runtime / skills 只读数据可经 CLI 稳定获取。
- Multica 已提供的取消 / 暂停能力可被 M3 控制台消费。

### 9.3 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Multica 数据结构演进导致客户端字段缺失 | Spec 构建降级 | 缺失即 warning + 默认值,schema 版本化 |
| 用户误把 Multica++ 当成运行时拦截器 | 期望错位 | PRD 反复声明非目标(4.2),控制点限定在闸门 + 账本 |
| secret 值误入产物 | 安全事故 | 仅记录键名,评审与账本均不落值 |
| M3 控制台被误解为重做运行时 | 范围蔓延 | 明确"收敛呈现 + 消费已有能力",不重实现 |

---

## 10. 术语表

| 术语 | 含义 |
| --- | --- |
| Runtime Agent Spec | 一次 agent 运行的版本化 JSON 快照,评审 / 账本 / 审计的单一事实来源 |
| Instruction Overlay | 多层指令叠加后的可读 diff,带评审状态 |
| Capability & Permission Review | 能力与权限评审,产出风险标记 |
| Ledger | goal/plan 账本,状态机 + JSONL 事件流 |
| 短租约 token | 短 TTL、task-scoped 的最小权限令牌 |
| 风险标记(risk flag) | 对高风险能力 / 权限的显式标注 |
| 启动闸门 | 未通过评审 / 确认则不可 lock / 启动的控制点 |

---

## 11. 开放问题

- M2 短租约 token 的 TTL 默认值与可调范围,需结合 Multica 实际 token 模型确定。
- M3 实时控制台的实时通道(消费 Multica 哪个事件源)有待确认其可达性,严禁伪造(见 4.2)。
- 账本的存储介质在更深集成阶段是否上移到 Multica 任务认领流附近,属未来决策,MVP/M1 保持外接。

---

*本 PRD 描述产品需求与边界,供 squad 据此拆分 backlog;一切结构契约以 Runtime Agent Spec schema 为准。*
