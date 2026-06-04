# 一键配置 Agent 预制体体系设计

## 目标

将当前的一键配置 Agent 从“选择少量 preset 的弹层”升级为“预制体体系”。
预制体用于沉淀团队共同工作环境和实践样例，用户可以从插件内置预制体或团队
成员创建的预制体中选择一个，检查并修改默认配置，然后创建 Multica Agent。

## 用户旅程

1. 用户进入 Multica++，左侧看到两组预制体：插件预制体、团队预制体。
2. 用户点击一个预制体。
3. 主区域展示该预制体的默认配置，包括用途、runtime、model、skills、MCP、
   instructions、权限 scope、TTL、审批要求和环境配置路径提示。
4. 用户按当前任务修改默认值。
5. 用户先 Preview，生成 fail-closed 的 Multica CLI plan。
6. 用户确认后 Create Agent，真实创建或更新 Multica Agent。
7. 系统记录审计事件。Squad 创建作为后续扩展，第一版只提供预览/占位。

## 预制体分类

- 插件预制体：随 Multica++ 提供，适合通用工作流。
- 团队预制体：从团队共同环境沉淀，带创建者、适用场景和环境路径说明。

第一版预制体：

- Planner Agent：目标拆解和计划维护。
- Executor Agent：本地实现和测试。
- Review Agent：代码审查和风险复核。
- Image2 Generation Agent：Paigod image2 高质量图片生成。
- Incident Triage Agent：blocked run 诊断和恢复建议。
- Team GUI Builder Agent：团队成员样例，面向本项目 GUI 原型施工。

## Schema

每个预制体至少包含：

- `id`：稳定标识。
- `source`：`plugin` 或 `team`。
- `name`、`description`、`role`、`useCases`。
- `createdBy`：团队预制体创建者；插件预制体为 `Multica++`。
- `agent`：`name`、`description`、`instructions`、`model`、`runtimeHint`、
  `visibility`、`maxConcurrentTasks`。
- `skills`：名称、说明、可选本地路径。
- `mcpServers`：名称、用途、是否必需、配置提示。
- `permissions`：scopes、TTL、审批要求、风险等级。
- `environment`：需要的 key 名、推荐配置路径、是否必需；不保存 secret 明文。
- `guardrails`：人工确认、secret 处理、写入边界。
- `target`：`agent` 或 `squad-preview`。

## 写入边界

Multica 当前 CLI 可真实写入：

- agent name、description、instructions、runtime id、model、visibility、
  max concurrent tasks、runtime config。
- agent skill assignments。

第一版不真实写入：

- MCP 配置：只展示和记录，因为当前 `multica agent create/update` 没有直接 MCP
  参数。
- secret env 明文：只展示 key 名和路径提示，真实 env 写入必须单独走
  `multica agent env set --custom-env-file` 或 `--custom-env-stdin`。
- Squad：只提供 `squad-preview`，后续在确认 leader/member/依赖关系后接入。

## GUI

左侧导航保留 Multica-like 外壳，但新增预制体区域：

- `Plugin Presets`
- `Team Presets`

点击预制体后，主区域或弹层展示可编辑配置：

- Agent 名称。
- Role / Instructions。
- Model / runtime hint。
- Skills。
- MCP servers。
- Permission scopes / TTL / approval。
- Env path hints。
- Guardrails。

按钮：

- `Preview Plan`：dry-run，不写 Multica。
- `Create Agent`：确认后通过本地 GUI server 真实写 Multica。
- `Create Squad`：第一版禁用或仅记录预览。

## 测试要求

- 预制体库能返回插件和团队两类预制体。
- 团队环境能生成团队预制体，并保留 skills、MCP、instructions、权限和环境路径。
- 用户覆盖项能合并到预制体配置。
- 预制体能转换为 Multica Agent 配置计划。
- MCP 和 secret env 写入保持 fail-closed。
- GUI 点击预制体后能显示并修改配置。
- `Create Agent` 只在确认 token 正确时执行真实写入。
