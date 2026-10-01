# OpenBot 智能体能力 · 变更影响

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 首版。单仓、无迁移、无发布 | 编码前影响面盘点 | 只动 OpenBot 本机聊天层与评测 |
| v0.2 | 2026-10-01 | 页面分栏、handoff 轮询、仓库 README | 活页三处 | `/api/chat` 不再默认 60s 放弃 |

## 1. 当前结论

- 影响范围：单仓库 `BiuBiuHu/OpenBot`。模块：`thread`、`chat-voice`、`page-read`、`eval-set`、chat-layer 评测、本 feature 文档。`docs/phases/` 仅加替代声明。
- 是否跨 repo：否。
- 是否改接口契约：否。`POST /api/chat` 入参出参不变。
- 是否需要迁移：否。
- 是否影响客户端版本：无独立客户端包。本机 `tsx` 页热读同源文件。
- 回滚复杂度：低。还原本分支 commit。

## 2. 受影响对象

| 对象 | 是否影响 | 说明 | 验证方式 |
|------|----------|------|----------|
| repo/模块 | 是 | OpenBot `src/thread.ts` 等 | `npm test` |
| 页面/客户端 | 弱 | 同一输入框，shown 文案变 | 聊天路径测试；可选环回发送 |
| API/契约 | 否 | 无新字段 | 读 `server.ts` |
| 数据表/迁移 | 否 | 无库 | 不适用 |
| 缓存/队列/定时任务 | 否 | 无 | 不适用 |
| 环境变量/配置 | 否 | 仍用 `~/.openbot` 语言 | 已有 config/language 测试不回归 |
| 对象存储/第三方 | 是（出网） | 公开 HTTP GET | 单测注入 fetch；可选 raw GitHub |
| 预发/线上发布 | 否 | 用户禁止部署 | release-plan 不批准 |

## 3. 接口和兼容性

- 新增接口：无 HTTP。新增内部函数 `readPublicDocument` / `isDocumentReadAsk`。
- 修改接口：`ThreadTurnResult.path` 增加 `"document"`。仅测试与内部使用。
- 删除接口：无。
- 错误码变化：无。
- 旧客户端兼容：旧页仍 POST message，能吃到新分流。
- feature flag：无。

## 4. 数据和迁移

- 数据模型变化：仅内存 `PublicDocument`。
- 迁移命令：无。
- 幂等策略：每句独立 GET。
- 回滚策略：git revert。
- 数据校验：评测禁止密钥。

## 5. 风险和回滚

| 风险 | 影响 | 预防措施 | 回滚方式 |
|------|------|----------|----------|
| 文档问句误伤查找/交接 | 其它评测红 | 先匹配 document，lookup 排除 document | 去掉 document 分支 |
| GitHub HTML 壳当正文 | 答非所问 | blob→raw | 还原改写函数 |
| 章节关键词写死 | 只过 chapter3 | 泛化抽取 | 改 `extractDocumentFacts` |
| 把工作区文档当已交付 | 范围说谎 | backlog 明确未做 | 文档回滚表述 |

## 6. 验证责任

| 验证项 | 负责环节 | 证据路径 |
|--------|----------|----------|
| 单元/评测 | 研发/QA | `05-testing/test-report.md` |
| 文档问句不创建 OH 会话 | 研发 | `tests/chat-voice.test.ts` |
| 旧用例回归 | QA | `npx tsx --test tests/eval-set.test.ts` |
| 发布 | DevOps | **不执行** |
