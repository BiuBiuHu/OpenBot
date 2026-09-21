# OpenBot MVP PRD

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 从定位 README 落成可验收 PRD | opc-skills 要求目标先于字段 | Bind / Persist / Remote 成为唯一 P0 主线 |
| v0.2 | 2026-09-20 | Persist/Remote 含远端 Agent 循环；本机为瘦客户端；对话分 1:1 与群组 | 用户确认远端是 think+execute 的常驻 Agent | 模型循环与任务权威迁到主机；群组为 v0.5 |
| v0.3 | 2026-09-21 | 同一窗口三种会话；默认可本机 LLM | 聊天 ≠ 总是 Agent | 未 bind 也能 NL 聊；点选 Agent 才上 VPS |

## 1. 当前决策

- 当前产品决策：SSH 绑定用户自己的 Linux 主机 + **systemd 常驻 `openbot-agent`** + 本机**同一聊天窗口**三种会话。口号：**SSH your own machine. The agent gets a computer — you keep the keys.**
- **聊天 ≠ 总是 Agent。** 默认可是本机 LLM（笔记本 BYOK，无 VPS 工具）；用户点选 Agent/主机或 `@mention` 才升级到远端 1:1 / 群组。
- 被拒绝的替代方案：远端只当哑 Worker、把每句本机闲聊都变成远端任务、托管 Firecracker、和 OpenHands 打编码 IDE 战争、v0 桌面像素操控、把 computer-use 叫成 Agent。
- 当前范围边界：单机、单用户、无头 2C4G、**单进程** Agent。v0 会话 = 本机 LLM + 可选 1:1 Agent；群组房间 = v0.5，不阻塞内核。

## 2. 需求验证结论

- 需求验证文档：`requirement-validation.md`
- 已消除的歧义：电脑 = 用户 SSH 主机；Agent 任务的思考在远端；**本机 LLM 是另一种会话，不上 VPS**；Worker ≠ Agent ≠ computer-use ≠ 本机 LLM。
- 仍需确认的问题：无阻塞项。群组房间权威落本机或 lead 主机，放到 v0.5。
- 不进入本版本的内容：团队 ACL、技能市场、浏览器自动化（Phase 3 plugin）、多主机切换 UI、完整多 Agent 编排。

## 3. 目标澄清

- 用户真正想完成的业务结果：本机先能普通聊天；需要电脑时，把**自己的** Linux 主机变成合盖也不消失的 Agent PC，在同一窗口里遥控。
- 主要用户/角色：会 SSH 的个人开发者。
- 核心工作流：打开本机 LLM 头脑风暴 → 需要动手时点选 Agent → 合上笔记本 → Agent 在远端继续想和做 → 再打开看到结果或审批。
- 工作单元和批量范围：v0 一条本机会话 **或** 一条远端任务。v0.5 一个房间可扇出多名 Agent 的任务。
- 成本、时效和质量约束：2C4G 单进程 Agent；python3+bash；危险动作先问；本机 LLM 用笔记本 BYOK，Agent 用主机 BYOK。
- 返工/重试/回滚方式：重新 bind；拒绝审批；`systemctl --user restart openbot-agent` / 重跑 bootstrap。
- 用户已确认结论：隐喻对齐 Grok Bot 的持久电脑，不对齐托管账单；远端是 Agent 不是哑 Worker；聊天窗口默认可以只是 LLM。

## 4. 用户、问题与场景

### 4.1 用户与角色

一个人，一台他已经能 SSH 进去的 Linux 机器（VPS / 迷你主机 / 闲置笔记本）。

### 4.2 要解决的问题

只聊天的助手在合上笔记本时结束。托管 Agent PC 把机器和 token 锁在平台里。用户需要：**电脑是我的，钥匙是我的**。

### 4.3 触发场景和使用频率

- 第一次：克隆、init、bind、serve。
- 每天：打开本机 LLM 写草稿 / 问答；或切到 1:1 Agent 让 VPS 动手；或 `run` 一条不经模型的命令。
- 以后：在群组里 @researcher / @coder / @reviewer（可在不同主机）。
- 中断：地铁/合盖；本机 LLM 停，Agent 任务继续；回来看同一窗口。

### 4.4 当前替代方案和痛点

| 替代 | 痛点 |
|------|------|
| 自己 SSH 手工敲 | 没有远端 Agent 循环，没有审批记录 |
| OpenHands | 产品是编码任务控制台，不是“我的电脑” |
| Grok Bot | 不是你的主机，也不是你的 token 计量 |

## 5. 范围

### 5.1 In Scope

1. Bind：`openbot init` + `openbot bind`（SSH 只做登记与 bootstrap）
2. Persist：systemd-user / tmux / nohup 拉起 **`openbot-agent`**；任务/事件在远端盘
3. Remote：**远端 Agent 循环**（想 + 执行）+ `run_shell` / 文件工具 + 事件回传
4. 本机同一聊天窗口：默认 **本机 LLM**；可选 1:1 Agent（订阅 + 批准）。群组 v0.5
5. 审批门（任务状态 `awaiting_approval`）
6. MIT、`.gitignore`、`.env.example`、架构文档（含 Worker≠Agent≠computer-use）

### 5.2 Out of Scope

团队 ACL、市场、Firecracker、桌面/浏览器自动化（Phase 3 才做 plugin）、移动端精修、和 OpenHands 比 IDE、v0 完整多 Agent 群组（v0.5）。

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

本机 LLM：未配置 key → 可聊 / 缺 key 报错（**不依赖 bind**）。Agent：未配置 → 已绑定 → 隧道开 → 任务 `queued → running → awaiting_approval → succeeded|failed`。群组（v0.5）一条发言可扇出多条任务。

### 6.3 异常、空态和失败路径

SSH 失败、主机无 python3、隧道断、无 API key、审批拒绝、命令失败。全部必须对人可读。隧道断时本机 LLM 仍可用。禁止把本机 LLM 输出标成 host，也禁止静默把 Agent 任务改在本机执行。

### 6.4 成本保护和返工流程

- 本机 LLM 与 Agent 聊天才调用模型（各用各的 BYOK）；`run` 不调用。
- 只有 Agent 模式会动 VPS；危险命令先审批。
- 合盖杀死本机 LLM 生成，不杀死 Agent 循环，不重跑已在跑的任务。

## 7. 验收标准

| 需求 ID | 验收标准 | 证据类型 | 优先级 |
|---------|----------|----------|--------|
| REQ-OPENBOT-001 | bind 经 SSH 安装 **openbot-agent**（保留 bootstrap 故事），config 记下 token 与 persist | 命令/日志 | P0 |
| REQ-OPENBOT-002 | 停掉本机后 Agent 仍响应 /health；**任务与 Agent 循环**仍在远端盘 | 进程+文件 | P0 |
| REQ-OPENBOT-003 | Remote 含远端 Agent 循环；`uname -a` 级执行仍在主机并回传 | 测试/CLI | P0 |
| REQ-OPENBOT-004 | BYOK 分两处：本机 LLM 用笔记本 key，Agent 用主机 key；缺对应 key 时该模式不可用，exec/run 可用 | 代码+测试 | P0 |
| REQ-OPENBOT-005 | 危险命令必须批准（任务进入 `awaiting_approval`） | 单测+UI | P0 |
| REQ-OPENBOT-006 | 文档禁止 Firecracker/像素对等声明；computer-use ≠ Agent | 文档 | P0 |
| REQ-OPENBOT-007 | 密钥不进仓库 | 扫描+gitignore | P0 |
| REQ-OPENBOT-008 | README 安装路径可跑通 `npm run build` | 安装复跑 | P0 |
| REQ-OPENBOT-009 | 1:1 具名 Agent 聊天：消息变任务，事件进线程 | UI+API | P1（Phase 2，不挡 Phase 1） |
| REQ-OPENBOT-010 | 用户+多名 Agent 的群组房间（mention 或编排扇出） | 文档→实现 | P2（v0.5） |
| REQ-OPENBOT-011 | 同一窗口默认本机 LLM（无工具、无需 bind）；可点选 Agent 升级 | UI+API | P1（可先于或并行于 Phase 1） |

## 8. 指标与版本节奏

### 8.1 成功指标

陌生人能克隆并在 2C4G 上跑通；隐喻在 README 一眼可读；出现外部 issue/PR。

### 8.2 版本路线

- v0 内核：远端 `openbot-agent` 单进程循环（Phase 1）+ 本机同一窗口（默认 LLM + 可选 1:1 Agent，Phase 2）。
- v0.5：群组房间。
- 以后：无头浏览 plugin（Phase 3）、多主机切换。不承诺日期。不把群组当内核的门禁。聊天默认不是 Agent。

## 9. 未解决问题

- 托管预发/SaaS 发布矩阵不适用；见 `06-ops/release-plan.md`。
