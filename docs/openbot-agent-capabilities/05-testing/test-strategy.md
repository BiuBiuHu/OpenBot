# OpenBot 智能体能力 · 测试策略

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 首版。最小充分集=文档路径+旧聊天评测 | 风险在分流误判与超时套话，不在全仓无关模块 | 默认不跑发布级全环境；`npm test` 为门禁 |

## 1. 当前决策

- 当前测试范围：必测 document 识别/抓取/口吻/thread 路径、eval `read-public-doc`、全部既有 chat-layer。条件扩展：`tsc --noEmit`。明确不测：SSH 真机、OH 真会话、桌面像素、部署。
- 当前测试优先级：P0 现场原句与「不得超时套话」。
- 当前发布门禁：不发布。代码合入门禁= `npm test` 绿且无密钥。

## 2. 需求到测试追踪

| 需求 ID | 验收标准 | 测试用例 ID | 证据 | 状态 |
|---------|----------|-------------|------|------|
| REQ-DOC-001 | 看看…讲了什么 真抓短答 | TC-DOC-001 EVAL-read-public-doc | 测试报告 | 待测 |
| REQ-DOC-004 | 这个讲的是什么 真抓，不搜 HTTPS | TC-DOC-007 EVAL-read-public-doc-exact | 测试报告 | 待测 |
| REQ-DOC-002 | 无超时套话、无 OH 说明书 | TC-DOC-005 EVAL-read-public-doc | eval | 待测 |
| REQ-DOC-003 | blob→raw | TC-DOC-002 | 单测 | 待测 |
| REQ-CAP-004 | 简体短答，禁繁体 | TC-EVAL-003 what-is-grok-bot | 单测 | 待测 |
| REQ-CHAT-001 | 你是谁 / 超时 / 链接 | who-are-you timeout-is-short links-render | eval-set | 待测 |
| REQ-CAP-001 | 无新 mode | TC-UI 单输入 | 代码+测试 | 待测 |

## 3. 测试范围

### 3.1 涉及系统

- 客户端：本机页只作为聊天入口（本增量无 UI 改动，专项截图非必须；若做环回发送则记一条）。
- 主服务：`runThreadTurn` 文档分支。
- 内部服务：OpenHands **必须不被调用**（mock creates=0）。
- 第三方：公开 HTTP，用注入 fetch 或本地 http 服务器。
- 数据层：不适用。

### 3.2 不涉及系统和原因

- 认证/OAuth：无。
- 预发/生产：用户禁止部署。
- 桌面 noVNC：本增量不改，沿用 main 已有 `tests/desktop.test.ts` 仅作全量 `npm test` 附带回归。
- Worker 审批：不在调用链上。

## 4. 风险驱动测试重点

### 4.1 P0 风险

文档问句被当成电脑任务；GitHub HTML 壳；超时套话；评测作弊（写死 chapter3 专词却答不出别的 `.md`）。

### 4.2 边界值、等价类和状态迁移

- 有 URL +「讲了什么」→ document。
- 有 URL 无文档问法 → 不强制 document（除非 `.md`）。
- 「Grok Bot 是什么」仍 lookup。
- 空正文 / 非 2xx / fetch throw → 读不成。
- 时钟、含糊改代码不变。

### 4.3 决策表和错误猜测

| 句子特征 | 期望 path |
|----------|-----------|
| 看看 + github blob + 讲了什么 | document |
| 是什么 无文档问法 | lookup |
| 改代码 | coding |
| 今天的时间 | clock |
| 把 src/foo.ts 改成 1 | handoff（本增量只断言不是 document/lookup/coding 短路） |

错误猜测：`needsLookup` 把文档句当查找；`COMPUTER_TASK` 的「文件」误伤（本现场句无「文件」）。

## 5. 测试命令和数据

```bash
npx tsx --test tests/page-read.test.ts tests/chat-voice.test.ts tests/eval-set.test.ts
npm test
npx tsc --noEmit
```

夹具：`evals/chat-layer/cases/read-public-doc.json` 内嵌公开章节摘录（不是密钥）。本地 HTTP 夹具端口绑 `127.0.0.1`。

## 6. 测试报告要求

写入 `05-testing/test-report.md`：命令、通过/失败、未跑项、无密钥声明。

## 7. 联调门禁

- 进程和端口拓扑：仅本机测试进程。可选再起 `openbot serve` 环回。
- 环境变量和环境隔离：`OPENBOT_HOME` 用临时目录（eval 测试已如此）。
- 数据库、迁移和写入路径：不适用。
- service-to-service：文档路径禁止 OH。
- 第三方 API 最小验证：可选一次 raw GitHub GET；失败不挡合入，记残余风险。
- 失败归因格式：主服务分流 / 抽取 / 评测 ID / 网络。

## 8. 客户端专项联调（条件启用）

- 是否启用客户端专项门禁：弱启用。无新 UI，但聊天是 C 端路径。
- 启用或不启用原因：分流在服务端；页面只展示 token。以 API/单测为主，环回发送为辅。
- 客户端类型：本机 Web。
- 运行形态：dev / `tsx`。
- API 环境：`127.0.0.1`。
- 关键用户路径：发送现场文档问句。
- 接口契约和错误态：SSE token。
- 缓存/离线/推送/深链影响：无。
- 验证工具和命令：node:test；可选 curl POST（若服务已起）。
- 设备、浏览器、版本或构建号：无强制浏览器。
- 证据路径：test-report。

## 9. 未解决问题

- 无真实 ECS 时不能做「交接对照」现场。本增量以「不调用 OH」为成功，不要求 OH 读页对照。
