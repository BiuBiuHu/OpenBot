# OpenBot MVP 变更影响分析

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 首次影响面 | 空仓库只剩定位 README | 单 repo 从 0 到可运行 MVP |
| v0.2 | 2026-09-20 | 架构目标改为远端 Agent + 会话面 | 文档 PR，不改运行时代码 | 下一支实现才动协议；本 PR 无迁移 |
| v0.3 | 2026-09-21 | 补本机 LLM 会话模式 | 文档 only | 默认聊天不再隐含远端任务 |
| v0.4 | 2026-09-21 | 改为交接流 | 文档 only | 去掉三个对等 mode |
| v0.5 | 2026-09-22 | v0 远端 runtime 定为 OH Agent Server | 文档 only | 实现改为 adapter，不先自建 agent |
| v0.6 | 2026-09-22 | 补扩展层（桌面/VNC） | 文档 only | 近端 backlog；不改运行时 |
| v0.7 | 2026-09-22 | Phase 1 OH adapter | 代码 PR | 本机壳多 HTTP 客户端 + CLI；不删 worker |

## 1. 当前结论

- 影响范围：本轮 **代码 + 短文档**。新增 `src/oh-client.ts` / `src/handoff.ts`，扩展 config / CLI / `/api/status` / `/api/handoffs`。PR#1 worker 路径不动。
- 是否跨 repo：否。
- 是否改接口契约：控制面新增交接 stub；worker `/v1/jobs` 仍有效。OH 侧打的是 Agent Server `/health` 与 `/api/conversations*`。
- 是否需要迁移：否。旧 `~/.openbot/config.json` 缺 `openhands` 时 `loadConfig` 填默认值。
- 是否影响客户端版本：CLI 新子命令；旧 `run`/`chat`/`serve` 行为不变。
- 回滚复杂度：低。还原本 PR 的 git 即可。worker 单元不受影响。

## 2. 受影响对象

| 对象 | 是否影响 | 说明 | 验证方式 |
|------|----------|------|----------|
| repo/模块 | 是 | 新增 src/、worker/、docs/ | diff + 构建 |
| 页面/客户端 | 是 | 单页遥控台 | 浏览器/HTTP |
| API/契约 | 是 | 新建控制面与 worker API | 测试 |
| 数据表/迁移 | 否 | 无 SQL | 不适用 |
| 缓存/队列/定时任务 | 否 | 无 Redis/cron | 不适用 |
| 环境变量/配置 | 是 | `~/.openbot`、`.env.example` | 配置测试 |
| 对象存储/第三方 | 部分 | 仅用户 BYOK HTTP | 无 key 路径 |
| 预发/线上发布 | 否 | 非托管 SaaS | 见 release-plan |

## 3. 接口和兼容性

- 新增接口：见架构 API 表。
- 修改/删除接口：无。
- 错误码变化：无历史。
- 旧客户端兼容：无。
- feature flag：无。

## 4. 数据和迁移

- 数据模型变化：新建本地 json + 远端 job 文件。
- 迁移命令：无。
- 幂等策略：`bind` 可重复；token 已存在则复用。
- 回滚策略：停服务、删目录。
- 数据校验：job json 读失败则跳过该文件。

## 5. 风险和回滚

| 风险 | 影响 | 预防措施 | 回滚方式 |
|------|------|----------|----------|
| 危险命令误跑 | 用户主机受损 | 审批门 + TTY/UI 确认 | 拒绝执行 |
| 密钥入库 | 泄露 | gitignore、0600、扫描 | 轮换 key |
| 把本机当远端 | 验收造假 | 无 token 失败；SSH probe | 修代码 |
| 2C4G 装不上 Node | 主机负担 | worker 只要 python3 | 保持零 pip |

## 6. 验证责任

| 验证项 | 负责环节 | 证据路径 |
|--------|----------|----------|
| 单测审批/worker/config | 研发 | `05-testing/test-report.md` |
| 安装构建 | 研发 | evidence-manifest |
| UI 功能页 | 联调 | integration-report |
| 发布到 GitHub main | 用户审批后 | release-plan |
