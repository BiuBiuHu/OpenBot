# OpenBot MVP Markdown UI 原型

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 单页远程遥控台 | C 端工具页，不是 B 类运营表 | 实现为 `src/ui/index.html` |
| v0.2 | 2026-09-20 | 会话面：1:1 Agent 线程；预留群组房间 | 本机是瘦客户端，不是模型循环 | v0 只画单 Agent；群组 v0.5 |

## 1. 当前决策

- 当前 UI 结构：单页会话面。顶栏身份 + **1:1 Agent 线程**（思考 / 工具 / 审批都在这条线程）+ 右侧该 Agent 的任务 + 底栏输入。
- 当前交互风格：终端感（phosphor / amber），强调“你在跟这台机器上的 Agent 说话”，不是通用 AI 聊天气泡。
- 当前平台形态：本机 Web（`127.0.0.1:3847`）+ CLI。模型循环不在本机。
- 页面类型：**C 类工具页**（远程遥控 / 会话）。不是 B 类运营/审核台。
- 效率目标：3 秒内看清主机是否在线、persist、正在跟哪名 Agent 说话、能否直接 `uname -a`。
- v0.5：左侧或顶栏增加 **房间**（用户 + 多名 Agent）。v0 不画完整房间 UI，避免挡内核。

B 类运营效率规则不适用：没有多对象表格、没有批量生图、没有详情抽屉矩阵。Jobs 侧栏是“这台电脑上还活着的任务”，不是运营审核队列。

## 2. 入口与信息架构

### 2.1 页面入口

`npx openbot serve` → `http://127.0.0.1:3847/`

CLI 入口：`openbot run` / `openbot chat` / `openbot status`。

### 2.2 导航层级

v0 无多路由。模式切换在底栏：`Chat with agent` | `Run on host`。v0.5 增加房间切换（仍尽量单页）。

### 2.3 信息分组

1. 主机 + **具名 Agent**（user@host、persist、uname、Agent 是否已配置 BYOK）
2. 1:1 线程：用户 / Agent 思考 / 工具块 / 审批卡
3. 该 Agent 上的任务（合盖后仍在；来自远端 `tasks/`）
4. v0.5 才出现：房间参与者条（user + @researcher @coder …）

### 2.4 上下文与冗余控制

- 哪些信息由筛选区/页面标题表达，不在每行重复：host / persist 只在顶栏。
- 哪些字段必须在列表中直接可见：job status、id、command。
- 哪些长内容只进入详情抽屉：v0 无抽屉；完整输出在对话区。

## 3. 页面清单

| 页面/弹窗 | 入口 | 目标用户 | 关键动作 | 权限 |
|-----------|------|----------|----------|------|
| 1:1 遥控台 `/` | serve | 主机主人 | 跟具名 Agent 聊天、Run、批准/拒绝 | 本机回环 |
| 审批卡片 | 危险工具 | 主机主人 | Approve / Deny（转发远端 `/v1/approvals`） | 单次 id |
| 房间 `/`（v0.5） | 房间切换 | 主机主人 | @mention 或交给编排器；看多名 Agent 事件 | 本机回环 |
| CLI | 终端 | 主机主人 | 同等动作 | TTY 确认 |

## 4. 关键页面原型

### 4.1 遥控台

```text
┌ OpenBot ●  1:1  agent:default             ubuntu@203.0.113.10
│                                           persist systemd-user
│                                           Linux … 6.x x86_64
│                                           BYOK on host: yes
├───────────────────────────────┬───────────┤
│ sys  agent ready              │ TASKS ON  │
│                               │ THE AGENT │
│ you                           │ running   │
│  看一下 uname 并写进 workspace │ tsk_a1  看一下 uname…
│                               │           │
│ agent · thought               │           │
│  我在主机上执行 uname -a      │           │
│ agent · tool  run_shell       │           │
│  Linux box 6.12.0-… x86_64    │           │
├───────────────────────────────┴───────────┤
│ [Chat with agent ▼] [  看一下 uname…  ][Send]
└───────────────────────────────────────────┘
```

v0.5 房间草图（不进 v0 实现）：

```text
┌ room: ship-v0     you · @researcher · @coder · @reviewer
│ you     @coder 补测试  @reviewer 看 diff
│ coder   tool …          （事件来自 vps-a 的一条 task）
│ reviewer thought …      （事件来自 vps-b 的另一条 task）
└ [mention routing ▼] [  @coder …                 ][Send]
```

- 布局：顶栏 / 对话 / jobs / 输入。
- 字段：无登录表单；密钥在 `~/.openbot`。
- 操作：Send、Approve、Deny、切换 Chat/Run。v0.5 增加 @mention。
- 列表列：status、id、goal/command。
- 行内可视对象：连接灯（绿=worker 可达）。
- 详情信息：uname 字符串、错误原文。
- 批量操作：无。昂贵/危险动作用**一张**审批卡，禁止嵌套确认。
- 反馈：SSE token/output；错误用红色 sys 行。

基础交互路径（紧跟草图）：

1. 进入 serve URL → 顶栏拉 `/api/status`。
2. 选 `Run on host`，输入 `uname -a`，Send → `/api/run` SSE。
3. 输出出现在 host 气泡；jobs 刷新。
4. 若命令危险：出现审批卡，Approve 才继续，Deny 写回拒绝。
5. Chat 模式：本机把消息变成远端 `POST /v1/tasks`，SSE 画 thought/tool/approval。目标态无主机 key 时错误行说明用 Run。
6. 失败：顶栏红灯 + 错误文案（SSH/agent/模型），不跳到本机 shell。
7. 合盖再打开：同一 1:1 线程续订事件，不新建人格。

不需要的路径：新建对象、跨页多选、发布确认（非 SaaS）。

## 5. 状态与交互

### 5.1 加载、空态、错误态

- 加载：meta “connecting…”。
- 空任务：“No tasks yet. They live on the remote agent.”
- 错误：agent 不可达、无 key、审批拒绝、非零退出。
- 群组空态（v0.5）：“点名一个 Agent，或打开编排。”

### 5.2 表单校验和保存反馈

空输入不发送。配置不在 UI 保存，只用 CLI `init`。

### 5.3 权限差异和只读状态

单用户。无 key 时 Chat 不可用，Run 可用。群组里审批卡仍贴在**产生危险工具的那名 Agent** 的气泡下，不做成房间级总闸（避免误批他机命令）。

### 5.4 预发/线上环境标识

不适用（本地回环应用）。顶栏展示的是**远端主机名**，避免用户误以为在浏览托管云电脑。

### 5.5 B 类运营效率检查

- 列表能否完成主要判断：jobs 侧栏可看是否还在跑。
- 操作是否贴近数据行：审批贴在对话流，因为决策对象是当前命令。
- 是否支持批量生成/批量处理：**不支持**（v0 单条）。
- 是否支持单条返工：再发一条命令。
- 异常和缺字段是否可行动：缺 key / 未 bind 有下一步文案。
- 是否避免了筛选上下文的重复列：是。

本地 mock：静态 HTML 可先渲染空态；功能验收必须打真实 `/api/status` 与 `/api/run`（见测试策略）。无 Vercel。

## 6. 响应式与终端范围

桌面优先。窄屏隐藏 jobs 侧栏，对话仍可用。不承诺移动端精修。

## 7. 未解决问题

- 多会话历史、文件树浏览：Backlog。
- 群组房间完整 UI：v0.5，见 `03-architecture/remote-agent.md` §6.2。不挡远端 Agent 内核。
