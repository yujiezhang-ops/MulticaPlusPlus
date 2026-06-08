# Multica++ PR 检查清单

每个 PR 创建或更新前必须逐项检查。本清单是合并门槛，不是建议。

## 1. 范围

- [ ] 本 PR 只服务一个明确 Goal。
- [ ] 未替代 Multica 原生 issue、agent、runtime、skills、MCP 或 daemon 能力。
- [ ] 未新增未经批准的一级导航、公共 schema、权限边界或协作角色。
- [ ] 未修改、回滚或覆盖无关的用户改动。

## 2. 安全与写入

- [ ] Multica 写入默认 dry-run。
- [ ] 真实写入必须同时需要 `--execute` 和确认 token。
- [ ] metadata、permission、skill、system instruction、schema 变更已记录。
- [ ] 未记录 secret 明文；日志、audit、测试快照都已做 redact。
- [ ] Windows 中文、多行描述和路径使用文件参数或结构化 API，未依赖脆弱 shell 转义。

## 3. 测试

- [ ] 新业务逻辑有行为测试。
- [ ] CLI 行为覆盖 dry-run、确认失败、执行成功和失败路径。
- [ ] GUI 交互有 VM/DOM 测试；必要时完成浏览器验证。
- [ ] 已运行 `npm test`。
- [ ] 测试不依赖真实 Multica 写入。

## 4. 文档

- [ ] README 或 GUI 文档已同步用户可见变化。
- [ ] PRD 已同步产品方向、非目标或路线图变化。
- [ ] `CHANGELOG.md` 的 `Unreleased` 已记录用户可见变更。
- [ ] 新命令、新确认 token、新 audit 路径已写明。

## 5. PR 描述

- [ ] Summary：说明做了什么。
- [ ] Boundaries：说明没有做什么，尤其是未接管 Multica 原生能力。
- [ ] Tests：粘贴实际测试命令和结果。
- [ ] Risks：列出剩余风险和已知限制。
- [ ] Follow-ups：列出下一步，不把未完成内容伪装成已完成。
