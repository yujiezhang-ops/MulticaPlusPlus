# Multica++

Multica++ 是 Multica 的外接 Launch Review 与插件控制层。它不重做
Multica 已经具备的任务队列、智能体配置、技能包、MCP、取消或暂停机制，而是
把一次 agent run 的目标、计划、权限、技能、客户端能力和运行配置收敛成一个
可见、可授权、可恢复、可审计的启动记录。

完整产品说明见 [中文 PRD](docs/prd/MulticaPlusPlus-PRD.zh-CN.md)。

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

### M2：插件控制层最小闭环

当前 backlog：

- `SPA-10`：权限网关，从 risk flags 升级为短租约和审批字段。
- `SPA-11`：Goal/Plan 可见性，initialPlan 升级为 plan item ledger。
- `SPA-12`：Capability Bridge，本层可达探测和不可达原因。
- `SPA-13`：Preset/Profile，一键最佳实践初始化。
- `SPA-14`：上游兼容加固，真实响应 fixtures 和 launch record 回传。

### M3：实时控制台

收敛已有实时流、取消、暂停和自动暂停机制，形成运行控制台。控制台应展示
run 状态、goal/plan 进度、权限状态、capability 可达性、实时输出和恢复入口。

## 非目标

- 不 fork Multica daemon。
- 不替代 Multica issue board、agent 配置、skills 或 MCP registry。
- 不做运行时逐字命令硬拦截。
- 不伪造 browser、IDE 等客户端工具的真实可达性。

