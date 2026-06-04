# Multica++ GUI Static Prototype

## 如何打开

当前 GUI 是可运行静态原型，可直接用浏览器打开：

```text
gui/index.html
```

如果浏览器或本地安全策略限制静态资源，也可以在仓库根目录或 `gui/`
目录下使用任意静态服务器打开，例如：

```powershell
python -m http.server 8080
```

## 当前范围

- 纯 HTML/CSS/JS 实现。
- 使用 mock 数据，不读取真实 Multica 状态。
- 首屏为 `Control`，采用三栏工作区。
- 用于验证插件控制台的信息结构、视觉密度和本地交互，不是正式集成版。

## 首屏三栏

`Control` 首屏包含三栏：

- `Goal`：展示当前目标、负责人或触发来源、状态、完成度、最近更新，以及
  Restore / Resume 入口。
- `Plan`：展示有序步骤、pending/running/done/blocked 状态、依赖关系、
  当前执行项高亮和阻塞原因。
- `Agent Permission Setup`：展示权限模板、scope/resource groups、TTL lease、
  approval required、风险摘要，以及 Preview Configuration / Apply Permissions。

## 左侧导航

左侧一级导航固定为 5 项：

- `Control`：主工作台和三栏首屏。
- `Permissions`：权限模板、scope、TTL、审批策略和风险预览。
- `Activity`：当前 Goal/Plan 相关事件、阻塞和恢复点。
- `Records`：launch review、权限决策、配置变更和监控记录。
- `Settings`：插件级设置。

不设置一级 `Project`、`Agents`、`Runs`、`Environments` 或 `Data` 入口。

## 本地交互

- 点击左侧导航切换视图或占位页。
- Plan 状态筛选或当前步骤高亮。
- 权限 scope 展开查看。
- TTL 和模板选择改变本地预览。
- Preview / Apply 按钮只写入页面内 mock record。

## 明确边界

- 不接真实 Multica CLI。
- 不写 Multica metadata。
- 不替代 Multica 原生项目、issue、agent、runtime、skills 或 MCP 管理。
- 不声明自动接管所有权限。
- 不把 GUI 扩展成新的 Multica 工作台；它只是外接插件控制台原型。

## 视觉约束

- 黑、近黑、白和中性灰为主。
- 状态色如必须使用，应非常克制。
- 面板圆角不超过 8px。
- 不使用彩色渐变、装饰插画或营销 hero。
- 页面信息密度适中，避免复杂审计栏、capability diff、instruction diff 抢占首屏。

## 验收清单

- 桌面视口下 `Control` 首屏显示三栏：`Goal`、`Plan`、
  `Agent Permission Setup`。
- 移动视口下三栏按顺序堆叠。
- 视觉以黑、白、灰为主。
- 左侧导航只有 `Control`、`Permissions`、`Activity`、`Records`、
  `Settings`。
- 无一级 `Project`、`Agents`、`Runs`、`Environments`、`Data`。
- 运行 `npm test`。
