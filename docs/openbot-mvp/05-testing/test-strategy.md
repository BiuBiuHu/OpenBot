# OpenBot MVP 测试策略

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初始策略 | 最小充分集，不默认全量无关测试 | 定义 TC 与系统边界 |

## 1. 当前决策

- 当前测试范围：审批分类、配置/密钥隔离、worker job 协议、`uname -a` 远端语义、无 key 聊天失败、危险命令拒绝、**OH adapter mock HTTP**（探活 / 建会话 / 交接 stub）。
- 当前测试优先级：P0 上述路径。P2：真实 VPS、真实模型、真实 tunneled OH。
- 当前发布门禁：GitHub Code PR + 本地/实验室测试报告。无 Vercel/生产 SaaS。

## 2. 需求到测试追踪

| 需求 ID | 验收标准 | 测试用例 ID | 证据 | 状态 |
|---------|----------|-------------|------|------|
| REQ-OPENBOT-001 | SSH bind 安装 worker | TC-BIND-001 | 命令/日志 | 条件 |
| REQ-OPENBOT-002 | 控制面退出 worker 仍在 | TC-PERSIST-001 | 进程 | 条件 |
| REQ-OPENBOT-003 | `uname -a` 在 worker 执行 | TC-REMOTE-001 | worker.test / e2e | 必测 |
| REQ-OPENBOT-004 | 无 key 不能聊天 | TC-BYOK-001 | e2e-local | 必测 |
| REQ-OPENBOT-005 | 危险命令需批准 | TC-APPR-001..003 | approval.test | 必测 |
| REQ-OPENBOT-006 | 无 Firecracker 声明 | TC-DOC-001 | 文档审 | 必测 |
| REQ-OPENBOT-007 | 密钥不进仓 | TC-CFG-001 | config.test | 必测 |
| REQ-OPENBOT-008 | 构建安装路径 | TC-INST-001 | npm build | 必测 |
| BL-016 | OH adapter 探活 + 建会话（mock） | TC-OH-001..007 | oh-client.test | 必测 |

## 3. 测试范围

### 3.1 涉及系统

- 客户端：本机 Web + CLI。
- 主服务：控制面。
- 内部 worker：Python HTTP。
- 第三方：只验证“无 key 失败”，不付费打模型。

### 3.2 不涉及系统和原因

- Auth 服务 / DB / OSS / 邮件 / 移动端 / Vercel：产品无这些运行时。
- 全量历史回归：仓库无旧测试。

## 4. 风险驱动测试重点

### 4.1 P0 风险

误在本机执行、危险命令无门、密钥入库、合盖丢 worker、安装命令不可跑。

### 4.2 边界值、等价类和状态迁移

- 命令：安全 `uname -a` / `echo` vs 危险 `rm -rf /` `sudo reboot` `curl\|sh`。
- Job：queued → running → succeeded/failed/timeout。
- 配置：缺 host、缺 token、有 token。

### 4.3 决策表和错误猜测

| 有 SSH | 有 token | 有 key | 期望 |
|--------|----------|--------|------|
| 否 | 否 | * | init/bind 指引 |
| 是 | 是 | 否 | run 成功，chat 失败 |
| 是 | 是 | 是 | chat 可调工具 |

错误猜测：把控制面 `uname` 当成远端；SSE 中断当 job 失败（应为 persist）。

## 5. 测试命令和数据

```bash
npm install
npm run build
npm test
```

数据：临时 `OPENBOT_HOME`、随机 worker port、仓库内 `worker/worker.py`。禁止真实密钥。

## 6. 测试报告要求

写入 `test-report.md`：环境、commit、命令、通过/失败、副作用（不得破坏宿主机）。

## 7. 联调门禁

- 进程和端口拓扑：控制面 3847、worker 3848 或测试随机端口；各一份进程。
- 环境变量和环境隔离：`OPENBOT_HOME` 指向临时目录。
- 数据库、迁移和写入路径：不适用 SQL；检查临时 home 无密钥进仓。
- service-to-service：控制面 → worker Bearer。
- 第三方 API 最小验证：缺 key。
- 失败归因格式：前端 / 控制面 / worker / SSH / 配置。

## 8. 客户端专项联调（条件启用）

- 是否启用客户端专项门禁：**启用（Web 工具页）**。
- 启用或不启用原因：改了 `src/ui/index.html` 与 `/` 路由。
- 客户端类型：本机 Web。
- 运行形态：dev/`node dist/cli.js serve` 或测试内 `startControlPlane`。
- API 环境：`127.0.0.1` 控制面。
- 关键用户路径：打开 `/`、Run `uname -a`、审批卡。
- 接口契约和错误态：status 红灯、无 key。
- 缓存/离线/推送/深链影响：不适用。
- 验证工具和命令：curl GET `/`；有浏览器则打开功能页。
- 设备、浏览器、版本或构建号：实验室 Chrome 或无 GUI 时 HTTP。
- 证据路径：`integration-report.md`。

B 类 mock→Vercel：不适用。

## 9. 未解决问题

- 用户家用 VPS 不在 CI 内。
