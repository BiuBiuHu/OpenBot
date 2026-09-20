# OpenBot MVP Markdown UI 原型

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 单页远程遥控台 | C 端工具页，不是 B 类运营表 | 实现为 `src/ui/index.html` |

## 1. 当前决策

- 当前 UI 结构：单页。顶栏身份 + 中间对话 + 右侧 host jobs + 底栏输入。
- 当前交互风格：终端感（phosphor / amber），强调“这是你的机器”而不是通用 AI 聊天气泡。
- 当前平台形态：本机 Web（`127.0.0.1:3847`）+ CLI。
- 页面类型：**C 类工具页**（远程遥控）。不是 B 类运营/审核台。
- 效率目标：3 秒内看清主机是否在线、persist 方式、能否直接 `uname -a`。

B 类运营效率规则不适用：没有多对象表格、没有批量生图、没有详情抽屉矩阵。Jobs 侧栏是“这台电脑上还活着的任务”，不是运营审核队列。

## 2. 入口与信息架构

### 2.1 页面入口

`npx openbot serve` → `http://127.0.0.1:3847/`

CLI 入口：`openbot run` / `openbot chat` / `openbot status`。

### 2.2 导航层级

无多路由。模式切换在底栏：`Chat (BYOK)` | `Run on host`。

### 2.3 信息分组

1. 主机身份（user@host、persist、uname、是否有模型 key）
2. 对话 / 命令输出
3. 远端 jobs（合盖后仍在）

### 2.4 上下文与冗余控制

- 哪些信息由筛选区/页面标题表达，不在每行重复：host / persist 只在顶栏。
- 哪些字段必须在列表中直接可见：job status、id、command。
- 哪些长内容只进入详情抽屉：v0 无抽屉；完整输出在对话区。

## 3. 页面清单

| 页面/弹窗 | 入口 | 目标用户 | 关键动作 | 权限 |
|-----------|------|----------|----------|------|
| 遥控台 `/` | serve | 主机主人 | 聊天、Run、批准/拒绝 | 本机回环 |
| 审批卡片 | 危险命令 | 主机主人 | Approve / Deny | 单次 id |
| CLI | 终端 | 主机主人 | 同等动作 | TTY 确认 |

## 4. 关键页面原型

### 4.1 遥控台

```text
┌ OpenBot ●  SSH your own machine…          ubuntu@203.0.113.10
│                                           persist systemd-user
│                                           Linux … 6.x x86_64
│                                           model gpt-4o-mini
├───────────────────────────────┬───────────┤
│ sys  ready                    │ JOBS ON   │
│  Commands run on the host.    │ THE HOST  │
│                               │ running   │
│ you  run on host              │ a1b2  uname -a
│  uname -a                     │           │
│                               │           │
│ host                          │           │
│  Linux box 6.12.0-… x86_64    │           │
├───────────────────────────────┴───────────┤
│ [Run on host ▼] [  uname -a          ][Send]
└───────────────────────────────────────────┘
```

- 布局：顶栏 / 对话 / jobs / 输入。
- 字段：无登录表单；密钥在 `~/.openbot`。
- 操作：Send、Approve、Deny、切换 Chat/Run。
- 列表列：status、id、command。
- 行内可视对象：连接灯（绿=worker 可达）。
- 详情信息：uname 字符串、错误原文。
- 批量操作：无。昂贵/危险动作用**一张**审批卡，禁止嵌套确认。
- 反馈：SSE token/output；错误用红色 sys 行。

基础交互路径（紧跟草图）：

1. 进入 serve URL → 顶栏拉 `/api/status`。
2. 选 `Run on host`，输入 `uname -a`，Send → `/api/run` SSE。
3. 输出出现在 host 气泡；jobs 刷新。
4. 若命令危险：出现审批卡，Approve 才继续，Deny 写回拒绝。
5. Chat 模式走 `/api/chat`；无 key 时错误行说明用 Run。
6. 失败：顶栏红灯 + 错误文案（SSH/worker/模型），不跳到本机 shell。

不需要的路径：新建对象、跨页多选、发布确认（非 SaaS）。

## 5. 状态与交互

### 5.1 加载、空态、错误态

- 加载：meta “connecting…”。
- 空 jobs：“No jobs yet. They live on the remote host.”
- 错误：worker 不可达、无 key、审批拒绝、非零退出。

### 5.2 表单校验和保存反馈

空输入不发送。配置不在 UI 保存，只用 CLI `init`。

### 5.3 权限差异和只读状态

单用户。无 key 时 Chat 不可用，Run 可用。

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

- 多会话历史、文件树浏览：Backlog，不进 v0 主路径。
