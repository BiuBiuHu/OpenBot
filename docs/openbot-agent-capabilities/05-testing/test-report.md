# OpenBot 智能体能力 · 测试报告

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 占位 | 先有主文档 | — |
| v0.2 | 2026-10-01 | 回填 94 绿与现场 `/api/chat` | 合入门禁 | **漏测。** 用的是另一句「看看 … 这个文档讲了什么」，且 `read-public-doc.json` **自编了一段正文**。那次绿不能覆盖用户后打的原句。 |
| v0.3 | 2026-10-01 | 七句现场门禁；真抓/真实 raw 文件 | 活页原句被搜成 HTTPS；用户要求先测已写需求 | 本文件记录改代码前的活页分与改后的 suite |
| v0.4 | 2026-10-01 | 回填用户 Mac 活页七句全过 | 实验室 eval 之后，用户用本分支源码 `710549b` 对 `POST /api/chat` 复验 | 允许合入 `main`；仍不部署 |
| v0.5 | 2026-10-01 | 活页三处：分栏、交接终态、仓库 URL / 这是啥 | main `0d5eb94` 之后新失败 | 先红后绿；七句旧门禁必须保持绿 |

## 1. 当前决策

- 当前采用的方案：`evals/chat-layer/cases/` 七句现场原句为门禁；文档案必须 `readPublicDocument` 或 `fixtures/chapter3.md`（真实文件，不是为断言编的两句）。
- 被拒绝的替代方案：自编 `document.text` 让 shown 对上「用户记忆」。
- 未解决问题：不部署。云 VM 到不了用户 Mac / ECS；用户会把本分支拉到本机再打活页原句。

## 2. 需求盘点与用例

| 需求 ID | 现场原句 / 来源 | 评测 id | 改前活页（用户 0b445aa 页） | 说明 |
|---------|-----------------|---------|------------------------------|------|
| REQ-DOC-004 | `https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md 这个讲的是什么?` | `read-public-doc-exact` | FAIL：网上查过了。HTTPS… | 上一轮没有这句 |
| REQ-DOC-001 | `看看 https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md 这个文档讲了什么?` | `read-public-doc` | FAIL：50s 无 token | 上一轮用自编正文绿 |
| REQ-CHAT 时钟 | `今天的时间是什么时候?` | `todays-time` | FAIL：网上查过了。今天開始是人類。 | 补问号 |
| REQ 改代码口吻 | `你能帮我改代码吗?` | `change-code` | FAIL：先不背说明书… | 补问号 |
| REQ 改代码口吻 | `改代码` | `change-code-bare` | FAIL：先不背说明书… | 新增 |
| REQ-CHAT-001 | `你是谁?` | `who-are-you` | PASS：我是 OpenBot… | 保持绿 |
| REQ-CAP-004 | `Grok Bot 是什么` | `what-is-grok-bot` | FAIL：繁体 機器人/智慧 | 夹具改为现场繁体摘录 |
| REQ-DOC-002 | 同上文档句 | 上两案 must-not 超时套话 | 活页 2 无 token | |
| REQ-DOC-003 | blob→raw | TC-DOC-002/006 + fixture | — | |
| REQ-CAP-001 | 单输入 | TC-UI / 无 mode | — | 无新 UI |
| REQ-CODE-001 | 具名改文件 | 无 | 本轮不做 | 用户禁止新开 |
| REQ-WSDOC-001 | 工作区文稿 | 无 | 本轮不做 | |
| REQ-DESK-001 | 桌面 | 既有 desktop 测试 | 本轮不改 | |
| REQ-DESK-002 | 分栏独立、画面铺满 | TC-DESK-003 布局断言 | 改前：composer 盖住气泡、右侧窄条 | |
| REQ-DOC-005 | `那这个项目 https://github.com/bojieli/ai-agent-book 讲了什么?` | `repo-is-not-a-chapter` | 改前 FAIL：我看过了。模型选型可参考这篇指南。 | 仓库 HTML 壳 |
| REQ-CHAT-002 | `这是啥?` | `whats-this-is-computer` | 改前 FAIL：先不背说明书… | 含糊改代码套话误用 |
| REQ-HANDOFF-001 | 远端 >60s 仍非终态后完成 | `handoff-waits-until-terminal` + 假客户端 | 改前 FAIL：这台电脑这轮没在时限里跑完 | `handoff.ts` 默认 60_000 |

改代码前活页总分（用户对正在看的页 POST `/api/chat`）：**1 pass / 6 fail**。

## 3. 环节核心内容

- 环境：本地 Node，分支 `cursor/live-layout-handoff-74e9`，基线 `origin/main` = `0d5eb94`。
- 改代码前三条新评测（同一套 `shownForCase` / 假客户端，未改口吻与交接前）：
  1. `repo-is-not-a-chapter` **FAIL** shown=`我看过了。模型选型可参考 这篇指南。`
  2. `whats-this-is-computer` **FAIL** shown=`先不背说明书。你具体想让这台电脑做什么？`
  3. `handoff-waits-until-terminal` **FAIL** shown=`这台电脑这轮没在时限里跑完。你再说一次就行。`
  假设成立：`runHandoffTurn` 默认 `timeoutMs = 60_000`，`voiceChatReply` 在 `timeout`/`running` 时用时限套话盖掉远端正文。
- 改后命令：
  - `npx tsc --noEmit`：通过
  - `npm test`：102 pass / 0 fail
  - `npx tsx src/cli.ts eval`：
    1. `read-public-doc-exact` **pass**
    2. `read-public-doc` **pass**
    3. `todays-time` **pass**
    4. `change-code` **pass**
    5. `change-code-bare` **pass**
    6. `who-are-you` **pass**
    7. `what-is-grok-bot` **pass**
    8. `repo-is-not-a-chapter` **pass**（这个仓库是「深入理解 AI Agent…」；无 模型选型 / 这一章）
    9. `whats-this-is-computer` **pass**（无「先不背说明书」）
    10. `handoff-waits-until-terminal` **pass**（仓库已经下好了；无时限套话）
    另：`analyze-other-product` `links-render` `timeout-is-short` 仍 pass
- 云 VM 不能打用户 Mac 活页；用户会把本分支拉到本机再跑那几句。
- `529490a` 用户 Mac 活页：文本路径过（仓库 README、chapter3、时钟、你是谁、改代码）。**分栏仍失败**：1280×800 空会话截图里 composer 贴左列上方，电脑卡是右上短条。根因是 `#banner{display:none}` 让 `main` 落到 `auto` 行。本轮改为 `body` 纵向 flex + `main flex:1 1 0`。本机 1280×800 空会话复拍：输入框钉在左列底，电脑列铺满。用户会再截一次再合。
- 环境：本地 Node，分支 `cursor/live-chat-eval-gate-74e9`，基线 `origin/main` = `0b445aa`。
- 上一轮漏测（必须写进报告）：v0.2 绿跑的句子是「看看 … 这个文档讲了什么?」，JSON 里还塞了自编 `# 用户记忆和知识库` 两句。**不是**用户后打的「… 这个讲的是什么?」，也**没有**走真抓。所以那次绿不能证明活页。
- 命令与结果（本分支）：
  - `npx tsc --noEmit`：通过
  - `npm test`：96 pass / 0 fail
  - `npx tsx src/cli.ts eval` 七句门禁：
    1. `read-public-doc-exact` **pass**（我看过了 / 用户记忆和知识库；无 HTTPS）
    2. `read-public-doc` **pass**（同上，真抓 raw）
    3. `todays-time` **pass**（现在是 … 上海；无搜索 / CST）
    4. `change-code` **pass**（可以。说一下改哪个文件…）
    5. `change-code-bare` **pass**
    6. `who-are-you` **pass**
    7. `what-is-grok-bot` **pass**（简体「机器人」；无 機器人/智慧）
    另：`analyze-other-product` `links-render` `timeout-is-short` 仍 pass
- 改代码前活页：1 pass / 6 fail（见上表）。改后实验室 suite：上列全 pass。
- **实验室之后的活页（用户 Mac，跑本分支源码 `710549b`，`POST /api/chat`，不是实验室 eval）：七句全过。**
  1. 现场原句「…chapter3.md 这个讲的是什么?」→ 我看过了。这一章是「用户记忆和知识库」。…
  2. 「看看 … 这个文档讲了什么?」→ 同一文档短答，无超时
  3. 「今天的时间是什么时候?」→ 现在是 2026年10月2日星期五 00:11（上海）。
  4. 「你能帮我改代码吗?」→ 可以。说一下改哪个文件、想改成什么样。
  5. 「改代码」→ 同上
  6. 「你是谁?」→ 仍是 OpenBot
  7. 「Grok Bot 是什么」→ 简体，无 機器人 / 智慧

## 4. 未解决问题

- 不部署。无生产环境。
