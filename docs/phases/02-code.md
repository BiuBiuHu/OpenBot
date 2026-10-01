# 阶段 2 · 改代码

独立文档。评审应能只读这一份就否定它。本阶段**尚未实现**。未实现却标绿，本阶段作废。

本阶段开始前，阶段 1 的评测必须全绿。阶段 1 有一条红，本阶段不得绿。

## 目标

人在**同一条聊天**里请 ECS 上的 OpenHands 改代码。本机中间层只把原句分发过去，不先用「这是不是改代码」的分类挡住 Agent。

人要能：

- 说出改哪个文件、改成什么样，并在同一条线程里看到进展和结果。
- 看见的句子服从 Settings 语言（默认简体中文）。
- 危险操作仍走已有审批门，而不是本机默默改笔记本上的仓库。

## 非目标

- 不在本阶段做文档库（阶段 3）。
- 不在本阶段验收「Agent 在桌面上拖鼠标」（阶段 4）。OpenHands 在 ECS 工作区改文件即可。
- 不在本机再做一个和第二条聊天对等的「代码模式」。
- 不 fork OpenHands，不把 ECS 工作区镜像成笔记本磁盘。
- 不实现本阶段代码。不合并 PR #7。

## 当前事实

1. 阶段 1 的决策是：中间层不在 Agent 之前分类。当前仓库**还没**满足阶段 1——`src/thread.ts` 对「你能帮我改代码吗」走 `isVagueCodingAsk` → `voiceCodingReady`，Agent 看不见这句话。见 [01-chat.md](01-chat.md)「当前事实」。
2. 具体到文件的话，只要没被含糊改代码正则吃掉，现有路径可以 `forceHandoff` / 无本机 key 时走 `runHandoffTurn`（`src/handoff.ts`），在 ECS 的 OpenHands 建会话。
3. 现有 `evals/chat-layer/cases/change-code.json` 要求 shown 含「可以」和「文件」，这是本地抢答的及格线，不是「ECS 上改了代码」。
4. OpenHands 常把「我是 OpenHands… workspace/project」当第一句。`voiceChatReply` 会挡说明书，但挡不住「根本没把改代码句送出去」。
5. 笔记本页和 ECS 工作区是两台机器。本机仓库路径不是 ECS 上的 `workspace`。评测夹具 conversation id 不是 live 主机。
6. 密钥：只在 Settings 填私钥路径；session 相关项进 `~/.openbot/.env`，不进 git。

## 设计

1. **先完成阶段 1。** 含糊的「你能帮我改代码吗」也必须送到 Agent。Agent 可以反问文件；中间层不得代答。
2. **代码能力 = ECS OpenHands。** 创建 / 轮询 / 事件映射已有壳（`src/oh-client.ts`、`src/oh-events.ts`）。本阶段验收的是：人说改文件时，会话在 ECS 上，shown 是短的人话，不是说明书或本机工作区清单。
3. **同一条线程。** 进度和最终句都在左边聊天。不要弹出第二个「代码控制台」。
4. **审批。** 已有危险命令门（`src/approval.ts`、页面 Approve / Deny）继续有效。本阶段不发明第二种门。
5. **三台机器。** 改的是 ECS 工作区。笔记本页只显示。CI mock 和 example.com 不是电脑。
6. **语言。** shown 用 `~/.openbot` 的 language。

## 交付物

- 阶段 1 评测全绿（重跑，不是口头说「应该还绿」）。
- 下面的会失败测试先合入、先红，再实现。
- 至少一条「指出文件 + 想改成什么样」的评测，证明交接收到原句，shown 不是 OH 说明书、不是「先不背说明书」。
- 现场页能用同一输入框完成一次改文件对话（实验室可用 mock 会话；live 不得在无 ECS 时标绿）。
- 不交付文档产品、不交付新的桌面操作 API。PR #7 仍是草稿。

## 先写会失败的测试

必须**重跑**阶段 1 表里全部 `TC-CHAT-DISPATCH-*` 与 `TC-CHAT-VOICE-AFTER-001`。其中一条红，本阶段停止。

然后先合入这些（在阶段 1 已完成后，若本阶段未做，应变红）：

| ID | 断言 |
|----|------|
| `TC-CODE-HANDOFF-001` | `runThreadTurn("把 src/example.ts 里的 foo 改成 bar", { forceHandoff: true })` 调用交接，`goal` 是原句；`path` 不是 `coding` / `lookup` / `clock` |
| `TC-CODE-HANDOFF-002` | 远端夹具仍是 OpenHands 说明书时，shown 不含「我是 OpenHands」「workspace/project」 |
| `TC-CODE-HANDOFF-003` | 远端夹具是 timeout + 排查日志时，沿用 `timeout-is-short` 及格线 |
| `TC-CODE-NO-LOCAL-REPO-001` | shown 与评测记录不含本机绝对路径当「已改好的文件」；不含 PEM / session key / 非环回地址 |

在阶段 1 完成前就写 `TC-CODE-HANDOFF-001` 也会红（含糊句被拦；带路径的句子今天可能已经交接）。评审应看：**带路径的句子**在阶段 1 之后仍交接；**含糊句**不得再被本地「可以……文件」吃掉。

## 评测用例与及格线

**重跑（一条红则本阶段红）：**

`who-are-you`、`analyze-other-product`、`timeout-is-short`、`links-render`，以及阶段 1 改写后的 `todays-time`、`what-is-grok-bot`、`change-code` / `dispatch-sees-agent`、`language-zh-CN`。

**本阶段新增：**

| id | 人说的话 | 及格 |
|----|----------|------|
| `edit-named-file` | 「把 `src/example.ts` 里的 `foo` 改成 `bar`。」 | 分发到 OpenHands。shown 用简体（默认），提及这次修改或文件名，不含 OH 说明书、不含「先不背说明书」、不含本机抢答「可以。说一下改哪个文件」。 |
| `code-then-chat` | 先改文件句，再问「你是谁」 | 第二条仍走阶段 1 的 `who-are-you` 及格线。证明没有切到另一个 mode。 |

夹具 conversation id 只用 `eval-…` 这种假 id。

## 现场页怎么验收

笔记本页，同一条聊天，语言简体中文。

1. 先重做 [01-chat.md](01-chat.md)「现场页怎么验收」全部步骤。任一步失败，本阶段失败。
2. 发一条带文件名和改法的话。应看到远端在干活（助手头像等待），而不是本机瞬间「可以。说一下改哪个文件」。
3. 最终句是短的人话。打开右边电脑卡片**不是**本步骤的及格条件（那是阶段 4）；但卡片若在，不得出现 noVNC 工具条，以免有人把「看见桌面」误当成「代码已验收」。
4. 不要在 ECS 或笔记本把私钥贴进聊天。

没有真实 ECS 时，只许说「mock 交接路径过了」，不许把阶段 2 标绿。

## 什么情况本阶段作废

- 阶段 1 评测未重跑，或重跑有红却标绿。
- 含糊改代码句再次被中间层抢答。
- 实现了本阶段却没有先红的 `TC-CODE-HANDOFF-*`。
- 人要切到第二个窗口才能改代码。
- 把笔记本工作区当作 ECS 工作区汇报成功。
- 文档或评测出现密钥、PEM、非环回地址。
- 合并 PR #7 或改打 `main`。
- 宣称已实现本阶段（本文写作时尚未实现）。

## 之后阶段

阶段 3、4 必须重跑**阶段 1 + 本阶段**评测。本阶段有红，后面不得绿。
