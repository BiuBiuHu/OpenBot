# OpenBot MVP Markdown UI 原型

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 单页远程遥控台 | C 端工具页，不是 B 类运营表 | 实现为 `src/ui/index.html` |
| v0.2 | 2026-09-20 | 会话面：1:1 Agent 线程；预留群组房间 | 本机是瘦客户端，不是模型循环 | v0 只画单 Agent；群组 v0.5 |
| v0.3 | 2026-09-21 | 同一窗口三种 mode；默认本机 LLM | 聊天 ≠ 总是 Agent | 底栏先 Local LLM；点选 Agent 才升级 |

## 1. 当前决策

- 当前 UI 结构：单页**同一聊天窗口**。顶栏标明当前 mode + 底栏切换：`Local LLM`（默认）| `Agent` | `Run on host`。Agent 模式下右侧才出现该主机任务。
- 当前交互风格：终端感（phosphor / amber）。本机 LLM 像普通对话；切到 Agent 才强调“这是你的机器”。
- 当前平台形态：本机 Web（`127.0.0.1:3847`）+ CLI。本机 LLM 的循环在笔记本；Agent 循环在远端。
- 页面类型：**C 类工具页**（会话 + 远程遥控）。不是 B 类运营/审核台。
- 效率目标：3 秒内看清**现在是本机 LLM 还是 Agent**、主机是否在线、能否 `uname -a`。
- v0.5：增加 **房间**。v0 不画完整房间 UI。

B 类运营效率规则不适用：没有多对象表格、没有批量生图、没有详情抽屉矩阵。Jobs 侧栏是“这台电脑上还活着的任务”，不是运营审核队列。

## 2. 入口与信息架构

### 2.1 页面入口

`npx openbot serve` → `http://127.0.0.1:3847/`

CLI 入口：`openbot run` / `openbot chat` / `openbot status`。

### 2.2 导航层级

v0 无多路由。底栏会话 mode：`Local LLM`（默认）| `Chat with agent` | `Run on host`。从 Local LLM `@mention` 或点选 Agent/主机即升级。v0.5 增加房间。

### 2.3 信息分组

1. 当前 mode 徽章：`LOCAL LLM` 或 `AGENT · user@host`
2. 本机 LLM：用户 / 助手气泡；无工具块、无任务侧栏
3. Agent 1:1：思考 / 工具 / 审批 + 右侧远端任务
4. v0.5：房间参与者条（user + @researcher @coder …）

### 2.4 上下文与冗余控制

- 哪些信息由筛选区/页面标题表达，不在每行重复：host / persist 只在顶栏。
- 哪些字段必须在列表中直接可见：job status、id、command。
- 哪些长内容只进入详情抽屉：v0 无抽屉；完整输出在对话区。

## 3. 页面清单

| 页面/弹窗 | 入口 | 目标用户 | 关键动作 | 权限 |
|-----------|------|----------|----------|------|
| 会话台 `/` | serve | 主人 | 默认本机 LLM；可切 Agent / Run / 批准 | 本机回环 |
| 审批卡片 | 危险工具 | 主机主人 | Approve / Deny（转发远端 `/v1/approvals`） | 单次 id |
| 房间 `/`（v0.5） | 房间切换 | 主机主人 | @mention 或交给编排器；看多名 Agent 事件 | 本机回环 |
| CLI | 终端 | 主机主人 | 同等动作 | TTY 确认 |

## 4. 关键页面原型

### 4.1 遥控台

默认本机 LLM（未 bind 也可）：

```text
┌ OpenBot ●  LOCAL LLM                      BYOK on laptop: yes
│                                           agent: not selected
├───────────────────────────────────────────┤
│ you   帮我把这段 README 写短一点
│ llm   （普通助手气泡，无 tool / 无审批）
├───────────────────────────────────────────┤
│ [Local LLM ▼] [  帮我把这段…          ][Send]
│    也可选 Agent:default 升级到远端
└───────────────────────────────────────────┘
```

切到 1:1 Agent 之后：

```text
┌ OpenBot ●  AGENT  default                 ubuntu@203.0.113.10
│                                           persist systemd-user
│                                           BYOK on host: yes
├───────────────────────────────┬───────────┤
│ you                           │ TASKS     │
│  看一下 uname 并写进 workspace │ tsk_a1 … │
│ agent · thought / tool        │           │
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
- 操作：Send、切换 Local LLM / Agent / Run、Approve、Deny。v0.5 增加 @mention。
- 升级：从 Local LLM 下拉选 Agent 或输入 `@agent`；系统提示“下一条将在主机上执行”，禁止静默重放整段闲聊。
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
5. 默认 `Local LLM`：本机 BYOK，SSE 只有助手文本。未 bind 也走得通。
6. `Chat with agent`：消息变成远端 `POST /v1/tasks`，SSE 画 thought/tool/approval。无主机 key 时提示切回 Local LLM 或用 Run。
7. 失败：顶栏红灯 + 错误文案。Agent 失败不得把输出标成本机 LLM，也不得跳到本机 shell。
8. 合盖再打开：Local LLM 停在上次气泡；Agent 线程续订远端事件。

不需要的路径：新建对象、跨页多选、发布确认（非 SaaS）。

## 5. 状态与交互

### 5.1 加载、空态、错误态

- 加载：meta “connecting…”。
- 本机 LLM 空态：“普通对话。要让 VPS 动手，选一个 Agent。”
- 空任务（仅 Agent mode）：“No tasks yet. They live on the remote agent.”
- 错误：无本机 key、agent 不可达、无主机 key、审批拒绝、非零退出。
- 群组空态（v0.5）：“点名一个 Agent，或打开编排。”

### 5.2 表单校验和保存反馈

空输入不发送。配置不在 UI 保存，只用 CLI `init`。

### 5.3 权限差异和只读状态

单用户。无本机 key 时 Local LLM 不可用；无主机 key 时 Agent 聊天不可用；Run 仍可用。未 bind 只禁用 Agent / Run，不禁用 Local LLM。群组里审批卡仍贴在**产生危险工具的那名 Agent** 的气泡下。

### 5.4 预发/线上环境标识

不适用（本地回环应用）。Local LLM 顶栏写 `LOCAL LLM` / laptop BYOK；Agent 模式才展示**远端主机名**，避免把本机闲聊误认成 VPS。

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
- 从本机 LLM 升级时是否带上最近 N 条作 Agent 上下文：实现时默认**不自动带工具化历史**，只带用户确认的摘要或新消息。
