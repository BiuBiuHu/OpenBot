# 托管 OpenHands 安装

## 0. 版本历史
| 版本 | 日期 | 变更 | 原因 | 影响 |
| --- | --- | --- | --- | --- |
| v0.1 | 2026-11-20 | 固定依赖并自动安装执行引擎 | 用户无需维护 OpenHands | 本仓库安装器、CLI、设置页 |

## 1. 当前决策
使用经过联调的 Agent Server / SDK / Tools / Workspace 1.49.2，完整传递依赖带哈希锁定。第一版支持 Ubuntu 24.04 x86_64，独立 venv、非 root 服务账户、systemd 管理、回环监听。优先复用已经验证的 Python 原生部署；暂不引入 Docker 与网络/工作区映射变化。来源：https://pypi.org/project/openhands-agent-server/1.49.2/ 。

## 2. 项目发现与保存点
OpenBot 独立仓库；npm/TypeScript，npm run build。原功能已按用户授权合并 PR #13，main 保存点 a0362bf；从同步 main 创建 codex/managed-openhands。既有 ECS 服务保留，安装使用独立目录、服务名及 18000 端口。

## 3. 变更清单与执行顺序
1. 依赖清单和哈希锁；安装脚本处理前置检查、锁、凭据、候选验证、服务切换与失败恢复。
2. SSH 安装适配器、CLI setup 与设置页异步安装接口；沿用 Bot 本地 session/Origin 防护，不返回凭据到浏览器。
3. 首装、重入、失败、并发和凭据保护测试；测试环境实际安装与重入验证。
4. README 与验证证据回写，构建、自审、提交。

## 4. 兼容、迁移与回滚
只管理 openbot-engine 专属资源，不接管其他 OpenHands。失败不修改本机连接配置；更新失败恢复此前服务。依赖安装不要求模型调用，不产生模型费用。已有 Bot Runtime 的 OH_BASE_URL/会话密钥需显式迁移，不自动重启正在执行任务的服务。本次不包含 Chromium/桌面/完整 Bot Runtime 的一键部署。

## 5. 自动执行循环
按脚本、服务适配、UI 顺序验证。失败先归因再修复；证据记入同目录 evidence-manifest.md，review 记入 code-review.md。

## 6. 风险与边界
首次下载需要网络与足够磁盘；安装器需要 root 或免密 sudo 以配置 systemd/专用账户。固定版本不等于全功能电脑就绪；浏览器、模型及 Bot Runtime 状态分别说明。安装进行中使用系统锁拒绝并发，断开客户端后可重试检查。
