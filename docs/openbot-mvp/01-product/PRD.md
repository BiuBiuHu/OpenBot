# OpenBot MVP PRD

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 从定位 README 落成可验收 PRD | opc-skills 要求目标先于字段 | Bind / Persist / Remote 成为唯一 P0 主线 |

## 1. 当前决策

- 当前产品决策：本地安装控制面 + SSH 绑定用户自己的 Linux 主机 + 远端持久 worker + BYOK 聊天遥控。口号：**SSH your own machine. The agent gets a computer — you keep the keys.**
- 被拒绝的替代方案：托管 Firecracker 舰队、和 OpenHands 打编码 IDE 战争、v0 桌面像素操控。
- 当前范围边界：单机、单用户、无头 2C4G。

## 2. 需求验证结论

- 需求验证文档：`requirement-validation.md`
- 已消除的歧义：电脑 = 用户 SSH 主机；控制面可以关；模型 key 不进远端 worker。
- 仍需确认的问题：无阻塞项。
- 不进入本版本的内容：团队管理、技能市场、浏览器自动化、多主机切换 UI。

## 3. 目标澄清

- 用户真正想完成的业务结果：拥有一台**自己的**、合盖也不消失的 Agent PC，用聊天或一条命令遥控它。
- 主要用户/角色：会 SSH 的个人开发者。
- 核心工作流：绑定主机 → 放下一个任务 → 合上笔记本 → 再打开看到结果或审批。
- 工作单元和批量范围：单次对话 / 单条远端命令。
- 成本、时效和质量约束：2C4G；python3+bash；危险动作先问；BYOK。
- 返工/重试/回滚方式：重新 bind；拒绝审批；`systemctl --user restart openbot-worker` / 重跑 bootstrap。
- 用户已确认结论：隐喻对齐 Grok Bot 的持久电脑，不对齐托管账单。

## 4. 用户、问题与场景

### 4.1 用户与角色

一个人，一台他已经能 SSH 进去的 Linux 机器（VPS / 迷你主机 / 闲置笔记本）。

### 4.2 要解决的问题

只聊天的助手在合上笔记本时结束。托管 Agent PC 把机器和 token 锁在平台里。用户需要：**电脑是我的，钥匙是我的**。

### 4.3 触发场景和使用频率

- 第一次：克隆、init、bind、serve。
- 每天：打开本机 UI 或 CLI，让远端跑命令、改 workspace 文件。
- 中断：地铁/合盖；回来看 job。

### 4.4 当前替代方案和痛点

| 替代 | 痛点 |
|------|------|
| 自己 SSH 手工敲 | 没有 Agent 循环，没有审批记录 |
| OpenHands | 产品是编码任务控制台，不是“我的电脑” |
| Grok Bot | 不是你的主机，也不是你的 token 计量 |

## 5. 范围

### 5.1 In Scope

1. Bind：`openbot init` + `openbot bind`
2. Persist：systemd-user / tmux / nohup
3. Remote：`run_shell` / 文件工具 + 输出回传
4. 本机 Web UI + CLI
5. 审批门
6. MIT、`.gitignore`、`.env.example`、架构文档

### 5.2 Out of Scope

团队 ACL、市场、Firecracker、桌面/浏览器自动化、移动端精修、和 OpenHands 比 IDE。

### 5.3 权限和环境范围

SSH 用户能做的，Agent 就能做。审批门是产品控制，不是安全沙箱。

## 6. 核心流程

### 6.1 主流程

```text
clone → npm install && npm run build
 → openbot init --host … --user …
 → 把 OPENAI_API_KEY 写入 ~/.openbot/.env（可选）
 → openbot bind
 → openbot serve | openbot run 'uname -a' | openbot chat '…'
```

### 6.2 状态流转

未配置 → 已配置 → 已绑定 → 隧道开 → job 生命周期；危险命令：detected → pending → approved|denied。

### 6.3 异常、空态和失败路径

SSH 失败、主机无 python3、隧道断、无 API key、审批拒绝、命令失败。全部必须对人可读，禁止静默改在本机执行。

### 6.4 成本保护和返工流程

- 聊天才调用模型；`run` 不调用。
- 危险命令先审批。
- 合盖不重跑已经在跑的 job。

## 7. 验收标准

| 需求 ID | 验收标准 | 证据类型 | 优先级 |
|---------|----------|----------|--------|
| REQ-OPENBOT-001 | bind 经 SSH 安装 worker，config 记下 token 与 persist | 命令/日志 | P0 |
| REQ-OPENBOT-002 | 停掉控制面后 worker 仍响应 /health，jobs 仍在磁盘 | 进程+文件 | P0 |
| REQ-OPENBOT-003 | `uname -a` 在远端执行并回传 | 测试/CLI | P0 |
| REQ-OPENBOT-004 | BYOK；无 key 时聊天不可用，run 可用 | 代码+测试 | P0 |
| REQ-OPENBOT-005 | 危险命令必须批准 | 单测+UI | P0 |
| REQ-OPENBOT-006 | 文档禁止 Firecracker/像素对等声明 | 文档 | P0 |
| REQ-OPENBOT-007 | 密钥不进仓库 | 扫描+gitignore | P0 |
| REQ-OPENBOT-008 | README 安装路径可跑通 `npm run build` | 安装复跑 | P0 |

## 8. 指标与版本节奏

### 8.1 成功指标

陌生人能克隆并在 2C4G 上跑通；隐喻在 README 一眼可读；出现外部 issue/PR。

### 8.2 版本路线

- v0：本 PR（无头 worker）。
- 以后：多主机、只读浏览、可选浏览器阶段。不承诺日期。

## 9. 未解决问题

- 托管预发/SaaS 发布矩阵不适用；见 `06-ops/release-plan.md`。
