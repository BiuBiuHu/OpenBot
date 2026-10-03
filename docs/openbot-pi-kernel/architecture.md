# OpenBot Pi 内核

本地聊天的主代理是 Pi 会话。远程电脑上的 OpenHands 是另一个代理。两者分开迭代：主代理用 Pi 的 TypeScript SDK，远程任务优先走 A2A，对不上时保留现有 OpenHands 通道。

本文只记已经装上、已经接到代码里的事实。没有部署，没有 SSH，没有改用户机器上的文件。

## 安装的包

锁文件里的实际版本（`package-lock.json`）：

| 包 | 版本 | 角色 |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 1.0.0 | 会话入口 `createAgentSession` |
| `@earendil-works/pi-agent-core` | 1.0.0 | 更低层的代理循环（coding-agent 的依赖，也列为直接依赖） |
| `@earendil-works/pi-ai` | 1.0.0 | 模型、`CredentialStore`、助手消息流 |
| `@a2a-js/sdk` | 1.3.0 | 远程 A2A 客户端 |
| `typebox` | 1.3.27 | 自定义工具的参数 schema |

`package.json` 用 `^` 写这些范围。npm 上 0.99.2 之后的当前版是 1.0.0，许可证 MIT，`engines.node` 为 `>=22.19.0`。本仓库 `engines.node` 已改成 `>=22.19.0`。测试在 Node 22.23.3 上跑过。

正式依赖是 `@earendil-works/*`。没有把旧的 `badlogic/pi-mono` 写成依赖。没有引入 PaiCLI（itwanger/PaiCLI-Python），也没有 Python sidecar。

## 主代理：Pi

一条对话只发给拥有它的代理。页面仍是一条输入；请求体里的 handoff 开关被忽略。没有确认交接卡，没有 This computer / Run on host。

`POST /api/chat` 按 `threadId` 缓存一个 `PiSession`（`src/server.ts` 的 `piSessionFor`）。`src/thread.ts` 的 `runThreadTurn` 做的第一件模型侧的事是 `session.prompt(用户原文)`。时钟、含糊的「改代码」、公开文档链接、网页查询不再在这里用规则抢答。公开文档和网页查询也不再是 Pi 的本地工具。

会话由 `src/pi-kernel.ts` 的 `createOpenBotPiSession` 创建，调用 `@earendil-works/pi-coding-agent` 的 `createAgentSession`：

- `SessionManager.inMemory`、`SettingsManager.inMemory`，压缩和重试关掉。
- `DefaultResourceLoader` 关掉扩展、技能、提示模板、主题和上下文文件。
- `noTools: "builtin"`，不启用内置 bash / edit / write，避免改用户文件。
- 工作目录和 agent 目录在系统临时目录（`openbot-pi-cwd`、`openbot-pi-agent`），不写 `~/.pi`。
- 凭证存在进程内的 `CredentialStore`，不落盘。
- 有本地模型密钥时走 `openai-completions`。没有密钥时仍创建会话并 `prompt`；用户原文进入 Pi 上下文之后，流只返回「本地模型还没配密钥。」，不联网，也不按规则回答。

系统提示要求用简体中文，自称 OpenBot，不是 OpenHands。「你是谁」回答成 OpenBot。若 Pi 返回的文本仍像 OpenHands 自我介绍，`presentPiText` 在 `prompt` 返回之后才改写成 OpenBot。这不是抢在模型前面的路由。

## 会话上的工具

Pi 自己只注册时钟（`src/session-tools.ts` 的 `clock`）。只有模型调用时才执行。它不是假的子代理。

读公开文档、网页查询、跑命令、改文件、用那台电脑上的浏览器都不是写死在 Pi 里的工具。它们来自远端 agent card，对得上才注册，调用时只发 A2A。没有卡就不注册，也不改回本地读文档或本地搜索。系统提示不规定哪句话用哪个工具。详见 `docs/openbot-a2a-adapter/architecture.md`。

| 工具 | 作用 |
| --- | --- |
| `clock` | 上海时区的当前时间 |

## 远程代理：A2A，对不上则保留现有通道

ECS 上的 OpenHands 仍是另一个代理。Pi 的远端工具来自 agent card，调用 `sendA2aSkill`，不落到别的通道上冒充。没有卡就不注册这些工具。旧的 `runRemoteTask` 不是 Pi 的工具。

1. 用 2 秒超时探测 `/.well-known/agent-card.json`。卡里要有字符串 `name` 和数组 `supportedInterfaces`，才算对方说 A2A。
2. 有卡时用 `@a2a-js/sdk` 的 `ClientFactory`（JSON-RPC 与 REST 传输）`createFromUrl`，`sendMessage`，`returnImmediately: false`。任务没到终态就继续 `getTask`。终态包括完成、失败、取消、拒绝；另外把需要输入、需要认证当作停下，避免空转。这里不设 60 秒放弃。
3. `runRemoteTask` 在没有卡，或 SDK 调用失败且不是纯连接错误时，仍走现有 OpenHands 通道：`POST /api/conversations`，再轮询 `execution_status`，直到 `isTerminalStatus`。`sendA2aSkill` 不走这条退路。`timeoutMs` 不再当作放弃条件。`pollConversation` 只有调用方显式传入 `timeoutMs` 才有截止；`openbot oh run` 只有 `--timeout` 才限时。
4. 连不上时只回「连不上这台电脑。」。活路径不再发出「这台电脑这轮没在时限里跑完。你再说一次就行。」。若润色结果仍含这句，改成「这台电脑这轮没做成。你换一句再试。」。

现有 OpenHands Agent Server 自己不会发 `/.well-known/agent-card.json`。适配层源码在 `src/a2a-adapter/`，这次没有部署。没部署之前，现网对端没有卡，Pi 不会把调用记成 A2A。有合法 agent card 的对端才走 `@a2a-js/sdk`。

离线评测 `src/eval-set.ts` 的 `shownForCase` 仍用口吻函数打分。那条路径不经过活的 `runThreadTurn`，也不表示活的聊天会在本进程读文档或查网页。`voiceChatReply` 在 outcome 为 `timeout` 时仍保留计时器台词，供离线用例使用；活的远程任务不传 `timeout` / `running`。

## 测试

`tests/pi-kernel.test.ts`：

- 用户原文先进入真实 `createAgentSession` 的模型上下文，规则不先回答，工具在模型调用之前不会执行。没有卡时不注册读公开文档和网页查询。
- 模型先看见「现在几点」，再调用 `clock`。
- 远程任务在很短的 `timeoutMs` 内仍未结束时，回复不含那句 60 秒计时器台词，并等到终态。
- 连不上时回复恰好是「连不上这台电脑。」。
- 「你是谁」先到 Pi；若返回 OpenHands 自我介绍，才改写成 OpenBot。

`npm test` 在 Node 22.23.3 上跑。还没有在用户的真实页面上验证。
