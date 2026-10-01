# OpenBot 智能体能力 · 实施计划

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 首版。文档 + 公开文档 URL | 用户放弃审核并要求从同步后的 main 开新分支 | 不堆在 `cursor/local-oh-client-74e9` |

## 1. 当前决策

- 当前实施策略：`implementation-loop`。用户已写明文档落地后不要停在 awaiting-user-review。测完可合默认分支。禁止部署。
- 当前阶段划分：① 保存旧 WIP 并从 `origin/main` 开 `cursor/openbot-agent-capabilities-74e9` ② 写本目录主文档 ③ 补齐 document 路径测试与 eval ④ 本地验证 ⑤ 中文 PR，通过后合 `main`。
- 当前依赖关系：依赖 `main` @ `c43e14d`（已含桌面与聊天层）。不依赖未合并的 74e9 堆叠。

## 2. 项目发现

- 相关 repo：`BiuBiuHu/OpenBot`（本工作区 `/workspace`）。
- 包管理器：npm（`package-lock.json`）。
- 启动命令：`npm run dev` / `npx tsx src/cli.ts serve`。
- 测试命令：`npm test`（`tsx --test tests/*.test.ts`）。
- lint/typecheck 命令：`npx tsc --noEmit`（`npm run build`）。
- dev server 和端口：默认 3847，占用则换环回端口。只写 `127.0.0.1`。
- 环境变量样例：`.env.example`；真实密钥只在本机 `~/.openbot/.env`，禁止打印。
- 当前分支：`cursor/openbot-agent-capabilities-74e9`（从同步后 `origin/main` 创建）。
- 未提交改动：文档与测试在本计划执行中写入。

## 3. 保存点

- 保存方式：Git commit。
- commit/stash/patch：
  - 原 WIP 保存：`cursor/read-public-doc-74e9` 的 `73c5b40`（`wip: fetch public document URLs in the chat layer`）。
  - 新分支基线：`origin/main` = `c43e14d`。
  - cherry-pick 后：`d6bdfef`（同一补丁）。
- 回滚方式：`git revert` 本 feature 提交；或把工作区重置回 `c43e14d`。

## 4. 变更清单

| 模块/文件 | 改动 | 原因 | 验证方式 |
|-----------|------|------|----------|
| `docs/openbot-agent-capabilities/**` | 一类一份主文档 | opc-skills | 目录与模板章节齐全 |
| `docs/phases/README.md` | 声明已被替代 | 避免双决策源 | 读文件 |
| `src/page-read.ts` | 抓取、blob→raw、问句识别 | REQ-DOC-* | 新单测 |
| `src/chat-voice.ts` | `voiceFromDocument`；lookup 排除文档 | 口吻 | 单测 |
| `src/thread.ts` | `path: "document"` | 分流 | thread 单测 |
| `src/eval-set.ts` | documentRequired 打分 | 评测 | eval-set 测试 |
| `evals/chat-layer/cases/read-public-doc.json` | 现场原句 | 回归 | suite IDs |
| `tests/*.test.ts` | TC-DOC-* | 先锁行为 | `npm test` |

## 5. 执行顺序

| 阶段 | 任务 | 退出条件 | 失败处理 |
|------|------|----------|----------|
| 1 | 保存 WIP、同步 main、开分支 | 新分支父提交=`origin/main` | 停，不从 74e9 堆叠 |
| 2 | 写全套主文档 | 一类一份，中文，含版本历史/决策/未解决问题 | 补缺，不开始乱改无关模块 |
| 3 | 泛化抽取 + 评测 + 测试 | `npm test` 绿，含 `read-public-doc` | 读失败再改，不叠加无关功能 |
| 4 | 证据与自审 | evidence/code-review/test-report 回填 | 缺证据不宣称完成 |
| 5 | 中文 PR；测试绿则合 `main` | PR 链到本目录；未部署 | 合入失败则保持 PR open |

## 6. 自动执行循环

- 每轮修改：文档或 document 路径相关文件。
- 最小验证：先 `npx tsx --test tests/eval-set.test.ts tests/chat-voice.test.ts`，再全量 `npm test`。
- 失败归因：读断言，定位 page-read / voice / eval ID 列表。
- 复验方式：同一命令重跑。
- 证据写入：`04-engineering/evidence-manifest.md`、`05-testing/test-report.md`。

未执行：全量跨仓、预发、生产。原因：单仓本机工具，用户禁止部署。

## 7. 兼容、迁移与回滚

无协议迁移。旧评测必须继续绿。回滚不影响桌面与 SSH。

## 8. 风险与未解决问题

- `extractDocumentFacts` 若保留 chapter3 专词，评测作弊。本轮改为泛化。
- 真实出网抓 GitHub 受网络影响；单测必须以注入 fetch / 本地 HTTP 为准。
