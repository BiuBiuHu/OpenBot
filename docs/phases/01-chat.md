# 阶段 1 · 聊天

独立文档。评审应能只读这一份就否定它。本阶段是四阶段里唯一允许先改中间层路由的阶段；第 2–4 阶段不得在本阶段评测全绿之前标绿。

## 目标

人只面对**一条聊天**。句子原样交给 Agent（v0 即 ECS 上的 OpenHands 会话，经本机壳分发）。

本机中间层只做这些事：

- 把人的话送到 Agent。
- 把 Agent 回来的事件收进同一条线程。
- 用 Settings 里保存的语言说话（默认 `zh-CN`）。
- 去掉 OpenHands 说明书、超时原文、工具轨迹；链接可点。

它**不**做这些事：

- 在 Agent 看到句子之前，用正则把话分成搜索 / 时钟 / 改代码 / 电脑。
- 用本机搜索或本机时钟**代替** Agent 回答。
- 另开「搜索模式」或「电脑模式」让人切换。

## 非目标

- 不在本阶段做文档库、上传、长文写作产品（阶段 3）。
- 不在本阶段要求 Agent 在 ECS 桌面上点鼠标（阶段 4）。具体改某个文件可以走到 OpenHands，但「改代码」产品验收在阶段 2。
- 不把聊天改成三个对等 mode。
- 不把评测记录或页面写成含私钥、session key、公网地址。
- 不合并 PR #7，不把 PR 改打到 `main`。

## 当前事实

评审请打开这些文件核对。说错了就否定本节。

1. 页面只有一条输入，没有 This computer / Run on host 开关。证据：`src/ui/index.html` 的 `#box` → `POST /api/chat`。
2. `src/thread.ts` 的 `runThreadTurn` **先**判断 `isClockAsk`、`isVagueCodingAsk`、`needsLookup`，命中则 `emit` 本地句子并返回 `path: "clock" | "coding" | "lookup"`，**此时不调用** `runHandoffTurn`。
3. 本地口吻在 `src/chat-voice.ts`：`voiceNow`、`voiceCodingReady`、`voiceFromSearch`。时钟用 `Asia/Shanghai`。含糊改代码回「可以。说一下改哪个文件、想改成什么样。」
4. `src/eval-set.ts` 的 `shownForCase` 对时钟问和 `lookupRequired` 用例同样走本地函数，不重放「Agent 先看见」这条路径。
5. 现有评测（`evals/chat-layer/cases/`）里，`todays-time` 要求出现「现在是」「上海」且不得像搜索；`what-is-grok-bot` 要求 `lookupRequired` 且出现「网上查过了」；`change-code` 要求出现「可以」和「文件」，不得出现「先不背说明书」。这三份**固化了当前拦截**，与本阶段目标冲突。
6. 另三份在 Agent **之后**打分，与「只分发」不冲突：`who-are-you`（不得出现 OpenHands 自我介绍）、`timeout-is-short`（不得出现 `conversation timed out` 和排查日志）、`links-render`（尖括号 URL 变成可点链接）、`analyze-other-product`（分析别的产品不得念 OH 说明书）。
7. Settings 有语言项，默认简体中文，写入 `~/.openbot` 的配置，和主机 / 用户 / 端口 / 私钥**路径**在一起。私钥正文不进 `config.json`。session key 只进本机 `~/.openbot/.env`，接口不回显。证据：`src/config.ts`、`src/language.ts`、`src/ui/index.html`。
8. 本机页和 ECS 不是同一台机器。隧道是本机环回转发。OpenHands 探活走 `http://127.0.0.1:8000/health` 这类环回，不把公网地址写进仓库。

## 设计

1. **一条入口。** `runThreadTurn`（以及 `/api/chat`、`openbot chat`）对人的原句只走分发：有远端配置则 `runHandoffTurn`，没有则说清「还没连上这台电脑」，不要用搜索或时钟顶替。
2. **分类后置。** 搜索、开文件、改代码、看桌面，都是 Agent 在 ECS 上的事，或 Agent 回来之后由中间层**润色**。禁止在 `runThreadTurn` 顶部保留 `isClockAsk` / `needsLookup` / `isVagueCodingAsk` 短路。
3. **回来之后仍可润色。** `voiceChatReply` 可以继续：丢掉「我是 OpenHands」、超时原文、`/opt/` 轨迹；按 Settings 语言改写；链接 Markdown 化。这是分发之后的壳，不是抢答。
4. **评测跟代码一起改。** `shownForCase` 不得再对时钟 / 查找走本地抢答。旧用例 `todays-time`、`what-is-grok-bot`、`change-code` 必须改成「Agent 先看见」，或删掉并换成下面的新用例。留下旧及格线又宣称阶段 1 完成，本阶段作废。
5. **三台机器。** 聊天发生在笔记本页。思考和工具在 ECS 的 OpenHands。公开搜索页若被 Agent 打开，那是「不是产品」的网页，不要写成 OpenBot 的第三台电脑。
6. **语言。** 人看见的每一句（成功、失败、超时）服从 `~/.openbot` 的 `language`，默认 `zh-CN`。

## 交付物

- 中间层不再在 Agent 之前按意图抢答。`runThreadTurn` 的 `path` 不再出现 `clock` / `lookup` / `coding`（或等价短路）。
- 评测集与 `shownForCase` 与上述一致。
- Settings 语言、密钥路径规则保持现状，不回退。
- 本阶段**不**交付文档库、桌面接管新交互。PR #7 仍是草稿。

## 先写会失败的测试

先合入测试，确认在**当前** `cursor/local-oh-client-74e9` 上红，再改 `thread.ts` / `eval-set.ts`。先改代码再补测试，本阶段作废。

| ID | 断言（当前应变红） | 今天为什么红 |
|----|-------------------|--------------|
| `TC-CHAT-DISPATCH-001` | `runThreadTurn("今天的时间是什么时候", { forceHandoff: true, … })` 的 `path` 不是 `"clock"`；`runHandoffTurn`（或测试注入的等价物）收到**原句** | `src/thread.ts` 第 53–58 行直接 `voiceNow` |
| `TC-CHAT-DISPATCH-002` | `runThreadTurn("Grok Bot 是什么", { forceHandoff: true, searchWeb })` 的 `path` 不是 `"lookup"`；注入的 `searchWeb` **调用次数为 0** | 第 67–86 行走 `needsLookup` |
| `TC-CHAT-DISPATCH-003` | `runThreadTurn("你能帮我改代码吗", { forceHandoff: true })` 的 `path` 不是 `"coding"`；原句进入交接 | 第 60–65 行走 `voiceCodingReady` |
| `TC-CHAT-DISPATCH-004` | 交接依赖被调用时，`goal` 与用户输入逐字相同（含标点） | 短路根本不调用交接 |
| `TC-CHAT-VOICE-AFTER-001` | 对 `who-are-you` / `timeout-is-short` / `links-render` 的**远端夹具**跑 `voiceChatReply`，仍然不得出现 OH 说明书、超时原文、未处理的 `<https://…>` | 若有人「修分发」时删掉润色，这一条会红，这是故意的 |

测试里只许出现环回和夹具 conversation id，不许出现公网地址、PEM、session key。

## 评测用例与及格线

跑法仍是 `npx openbot eval`。记录只进 `~/.openbot/evals/`（0600）。现场 live 行只许有 shown 文本和 conversation id。

**必须保留且仍按「Agent 之后」打分的旧用例：**

| id | 及格 |
|----|------|
| `who-are-you` | 人问「你是谁」。shown 含 OpenBot，不含「我是 OpenHands」「workspace/project」。最多约 3 句。 |
| `analyze-other-product` | 「帮我分析下 grokbot 的架构」。shown 提到 grokbot，不含 OH 说明书。 |
| `timeout-is-short` | 远端夹具是 timeout。shown 不含 `conversation timed out`、`排查过程`、`/opt/`。最多 2 句。 |
| `links-render` | 远端夹具有 `<https://example.com/docs>`。shown 是 Markdown 链接，不是尖括号原样。 |

**必须改写或替换的旧用例（旧及格线不得当作本阶段绿）：**

| 旧 id | 本阶段新及格线 |
|-------|----------------|
| `todays-time` | 分发记录证明 Agent（或交接 mock）看见了「今天的时间是什么时候」。shown 用 Settings 语言。不得在 Agent 之前由 `voiceNow` 生成。Agent 回来之后报上海时间可以，那是 Agent 的答复被润色，不是中间层抢答。 |
| `what-is-grok-bot` | 分发记录证明原句到了 Agent。`searchWeb` 不得由 `runThreadTurn` 在交接前调用。shown 仍不得是 OH 说明书、不得是裸的「我不知道」。Agent 自己去查网，属于 ECS / 不是产品，不算中间层搜索模式。 |
| `change-code` | 「你能帮我改代码吗」进入交接。shown 不得是「先不背说明书」。不得再要求必须出现本地那句「可以……文件」（那是抢答）。 |

**本阶段新增评测（先以失败用例合入）：**

| id | 人说的话 | 及格 |
|----|----------|------|
| `dispatch-sees-agent` | 上面三句各一条夹具 | `path !== clock|lookup|coding`；夹具 `rawReply` 仍经 `voiceChatReply` 再展示 |
| `language-zh-CN` | 任意一句远端英文或繁体夹具 | Settings=`zh-CN` 时 shown 是简体，不回显密钥 |

没有「本机先搜索再决定要不要给电脑」的及格线。谁把这条写回评测，阶段 1 作废。

## 现场页怎么验收

在笔记本打开本机壳（默认 `http://127.0.0.1:3847/`）。Settings 里语言为简体中文。不要把主机地址或钥匙贴进聊天或仓库。

1. 发「你是谁」。左边同一条线程出回复。不得整段 OpenHands 说明书。
2. 发「今天的时间是什么时候」。网络面板或服务日志应看到对 OpenHands（环回）的会话，而不是秒回、且服务端 `path=clock`。
3. 发「Grok Bot 是什么」。同样应先分发给 Agent，而不是本机先打公开搜索再发言。
4. 发「你能帮我改代码吗」。应进同一条线程的电脑侧，而不是本地那句「可以。说一下改哪个文件」。
5. 头像仍在气泡外：人右、助手左。没有角色标签。
6. 页面、评测文件、PR 正文里没有 PEM、session key、非环回的地址。

实验室 mock 只能证明分发函数，不能把 live 标绿。

## 什么情况本阶段作废

- 仍保留 `clock` / `lookup` / `coding` 短路，却宣称「只分发」。
- 先改代码、后补测试，或新测试在旧代码上就是绿的。
- 旧的 `todays-time` / `what-is-grok-bot` / `change-code` 原样留着当绿，和目标打架。
- 页面又出现搜索 / 电脑 mode 开关。
- 回复语言不读 `~/.openbot`，或默认不是简体中文。
- 配置或接口回显私钥正文或 session key。
- 把公开搜索引擎写成 OpenBot 的一台电脑。
- 合并 PR #7，或把 base 改成 `main`。

## 之后阶段

阶段 2、3、4 的文档各自要求：**先重跑本阶段全部评测**。本阶段有一条红，后面阶段不得绿。
