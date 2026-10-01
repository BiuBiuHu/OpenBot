# OpenBot 智能体能力 · 测试报告

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 占位 | 先有主文档 | — |
| v0.2 | 2026-10-01 | 回填 94 绿与现场 `/api/chat` | 合入门禁 | **漏测。** 用的是另一句「看看 … 这个文档讲了什么」，且 `read-public-doc.json` **自编了一段正文**。那次绿不能覆盖用户后打的原句。 |
| v0.3 | 2026-10-01 | 七句现场门禁；真抓/真实 raw 文件 | 活页原句被搜成 HTTPS；用户要求先测已写需求 | 本文件记录改代码前的活页分与改后的 suite |

## 1. 当前决策

- 当前采用的方案：`evals/chat-layer/cases/` 七句现场原句为门禁；文档案必须 `readPublicDocument` 或 `fixtures/chapter3.md`（真实文件，不是为断言编的两句）。
- 被拒绝的替代方案：自编 `document.text` 让 shown 对上「用户记忆」。
- 未解决问题：不部署；不合入（本轮用户禁止 merge）。

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

改代码前活页总分（用户对正在看的页 POST `/api/chat`）：**1 pass / 6 fail**。

## 3. 环节核心内容

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
- 改代码前活页：1 pass / 6 fail（见上表）。改后 suite：上列全 pass。

## 4. 未解决问题

- 本轮不合入、不部署。
