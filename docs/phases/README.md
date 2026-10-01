# OpenBot 阶段文档

评审用。每一份都应能单独打开、单独否定。本目录只写决策与验收，**不**在这里实现第 2–4 阶段。

仓库路径：

| 文件 | 阶段 |
|------|------|
| [01-chat.md](01-chat.md) | 1 · 聊天 |
| [02-code.md](02-code.md) | 2 · 改代码 |
| [03-documents.md](03-documents.md) | 3 · 文档 |
| [04-computer-use.md](04-computer-use.md) | 4 · 电脑使用 |

GitHub（当前分支 `cursor/local-oh-client-74e9`）：

- [`docs/phases/README.md`](https://github.com/BiuBiuHu/OpenBot/blob/cursor/local-oh-client-74e9/docs/phases/README.md)
- [`docs/phases/01-chat.md`](https://github.com/BiuBiuHu/OpenBot/blob/cursor/local-oh-client-74e9/docs/phases/01-chat.md)
- [`docs/phases/02-code.md`](https://github.com/BiuBiuHu/OpenBot/blob/cursor/local-oh-client-74e9/docs/phases/02-code.md)
- [`docs/phases/03-documents.md`](https://github.com/BiuBiuHu/OpenBot/blob/cursor/local-oh-client-74e9/docs/phases/03-documents.md)
- [`docs/phases/04-computer-use.md`](https://github.com/BiuBiuHu/OpenBot/blob/cursor/local-oh-client-74e9/docs/phases/04-computer-use.md)

更早的 [`docs/openbot-mvp/`](../openbot-mvp/README.md) 是历史 MVP 卷宗。若其中某条与本目录冲突，**以本目录为准**，并请在评审里写明你否定的是哪一句。

## 要写进文档、不许事后编造的产品决策

1. **一条聊天。** 本机中间层只分发。它不替 Agent 回答，也不在 Agent 看到句子之前把话分成「搜索」或「电脑」。
2. **四种能力，同一窗口：** 聊天、经 ECS 上 OpenHands 改代码、文档、以及人能看、能接管的 ECS 桌面电脑使用。
3. **三台机器必须分开说：** 笔记本上的页、ECS、以及一切不是本产品的东西（公开网页、别人的云、评测用的 mock）。
4. **Settings 的语言就是回复语言。** 默认简体中文，和 SSH 设置一起写在 `~/.openbot`。只记私钥**路径**，不存、不回显私钥正文。
5. **桌面是 16:10 卡片。** 只画帧缓冲，不要 noVNC 工具条。双击放大；再双击 / 收起 / Escape 回到小卡。VNC 只走本机环回。
6. **PR #7 保持草稿。** 不合并，不改打到 `main`。

## 阶段怎么过

- 每个阶段先写**现在会失败**的测试，再改代码。测试先绿、设计后补，本阶段作废。
- 第 2、3、4 阶段**必须重跑更早阶段的评测**。更早有一条红，本阶段不得标绿。
- 现场页验收只看笔记本上的 `http://127.0.0.1:3847/`（或当次 `openbot serve` 的环回端口）。不要把公网地址、PEM、session key 写进仓库、评测记录或本目录。

## 当前实现和决策打架的地方（索引）

这些是仓库里现在能打开的事实，不是目标：

- `src/thread.ts` 的 `runThreadTurn` 在交接之前用 `isClockAsk` / `isVagueCodingAsk` / `needsLookup` 本地回答。
- `src/eval-set.ts` 的 `shownForCase` 对时钟和 `lookupRequired` 走同一套本地口吻。
- `evals/chat-layer/cases/todays-time.json`、`what-is-grok-bot.json`、`change-code.json` 按「中间层先拦」打分。

阶段 1 必须把代码和评测改到与「只分发」一致。阶段 2–4 在阶段 1 的评测全绿之前不得开工标绿。

## 三台机器（全阶段共用）

| 名字 | 是什么 | 不是什么 |
|------|--------|----------|
| 笔记本页 | 人打开的 OpenBot 页，聊天 + 电脑卡片，听本机环回 | 不是 ECS，不是 Agent 本体 |
| ECS | 用户自己的 Linux 主机：OpenHands Agent Server + 桌面 | 不是笔记本浏览器，不是公开网站 |
| 不是产品 | 搜索引擎、百科、示例域名、CI mock、他人云主机 | 不许写成「OpenBot 的第三台电脑」 |

评审若认为还应有第四台机器（例如单独的「本机 Agent 进程」），请直接否定本节，不要默默加进某阶段设计。
