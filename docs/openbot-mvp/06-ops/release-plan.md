# OpenBot MVP 发布方案

## 0. 版本与评审

| 方案版本 | 日期 | 目标环境 | 候选版本 | 变更原因 | 评审状态 | Reviewer |
|----------|------|----------|----------|----------|----------|----------|
| v0.1 | 2026-09-20 | **GitHub 仓库（可克隆分发）** | `cursor/openbot-mvp-a7b3` head | 首个可运行 MVP + opc-skills 文档 | `awaiting-review` | 仓库 owner |

本产品**不是**多服务 SaaS。不存在独立预发域名、生产 alias、Auth callback、Vercel project。  
本次 Code PR 的“发布”= 把可克隆垂直切片合入 `origin/main`。  
**禁止**把本方案解释成已批准托管 Production 部署。Production SaaS 状态：不适用。

发布完整性状态：`discovered` → `impact-mapped` → 停在 `awaiting-review`（Code PR）。无 Preview/Production deployment。

## 1. 发布目标与范围

- 用户结果：克隆后能 bind 自己的机器，并在远端跑 `uname -a`。
- 本次变更：文档 + 控制面 + worker + 测试。
- 明确不在范围：Firecracker、像素桌面、团队版、云托管控制面。
- 成功标准：P0 测试通过；README 安装命令真实；PR 中文。
- 发布完整性参考：opc-skills `references/release-integrity.md`（本仓库无云 deployment，矩阵以“不发布 + 证据”记录不适用系统）。

## 2. 调用链与关联系统盘点

- Runtime entry inventory：本仓库尚未需要独立 inventory；入口是本机 `npx openbot` 与 `http://127.0.0.1:3847`。
- 本次登录入口：无账号登录。
- 本次主服务/BFF URL：本机控制面，非公网。
- Provider callback：无。

### 2.1 双向影响闭包

- 入口向下游：Web/CLI → 控制面 → SSH 隧道 → worker → shell；控制面 → 用户 BYOK。
- 候选仓库：仅 `BiuBiuHu/OpenBot`。扫描：`git diff origin/main...HEAD`。
- 未确认 owner：无。
- 反向复核：无隐藏微服务。

| 序号 | 系统/组件 | 仓库 | 默认分支 | 云项目/运行平台 | 固定域名/入口 | 当前 deployment | 实现/head commit | 默认分支 merge commit | deployment/产物 commit | 已归并默认分支 | 发布决策 | 判断依据 | 上下游依赖 |
|------|-----------|------|----------|---------------|---------------|--------------------|------------------|----------------------|------------------------|------------------|----------|----------|------------|
| 1 | OpenBot 控制面+worker+文档 | BiuBiuHu/OpenBot | main | 用户本机/用户 VPS | 无公网固定域 | 无 | 本分支 HEAD | 待合并 | 不适用（源码分发） | 否 | 发布 | 本 feature 唯一代码仓 | 用户 SSH 主机、可选 BYOK |
| 2 | 独立 Auth | — | — | — | — | — | — | — | — | 不适用 | 不发布（证据） | 架构声明无账号服务；diff 无 Auth | — |
| 3 | 独立 AI 微服务 | — | — | — | — | — | — | — | — | 不适用 | 不发布（证据） | 只用用户 endpoint | 控制面出站 HTTPS |
| 4 | 数据库/OSS/邮件/Worker SaaS | — | — | — | — | — | — | — | — | 不适用 | 不发布（证据） | 无 schema/无 bucket | — |
| 5 | iOS/Android/小程序 | — | — | — | — | — | — | — | — | 不适用 | 不发布（证据） | 无客户端包 | — |

### 2.2 变更来源与发布决策证据

| 系统/仓库 | base commit | head/候选 commit | 代码/API/事件/配置变化 | 依赖或被依赖对象 | 发布决策 | 证据路径/命令 | Owner |
|-----------|-------------|------------------|------------------------|------------------|----------|---------------|-------|
| OpenBot | a377505 | 本分支 HEAD | 新增全部实现 | 用户主机 python3 | 发布 | `git diff a377505...HEAD --stat` | 生湖 / 本 Agent |
| 其它 | — | — | 无 | — | 不发布（证据） | 无其它 repo | — |

## 3. 环境、数据与兼容性

| 系统 | 环境变量/密钥检查 | 数据库 host/schema | Migration/回填 | API/事件兼容 | 缓存/队列/对象存储 | 结论 |
|------|-------------------|--------------------|----------------|-------------|--------------------|------|
| OpenBot | `.env.example` 空 key；真实值在 ~/.openbot | 无 | 无 | 新建 | 无 | 可合入 main |

## 4. 发布顺序与退出条件

| 顺序 | 系统 | 发布动作 | 前置条件 | 发布后验证 | 观察时长/指标 | 失败动作 |
|------|------|----------|----------|------------|---------------|----------|
| 1 | OpenBot | 合并 Code PR 到 main（需 reviewer） | `npm test` 绿 | 第三方按 README clone 构建 | 无流量 SLA | 回退 PR |

无 Preview 云部署。用户在自己电脑验证。

## 5. 测试、监控与证据

- 预发 deployment：不适用。
- 测试报告：`05-testing/test-report.md`
- Code Review/PR：中文 Code PR + `04-engineering/code-review.md`
- 线上 smoke / 回归 / 合成探针：不适用托管生产。用户侧等价 smoke：`npx openbot run 'uname -a'`
- DB after：不适用。
- 回归失败动作：revert merge。

## 6. 回滚方案

| 回滚顺序 | 系统 | 上一稳定版本/deployment | 回滚命令或平台动作 | 数据回滚 | 回滚后验证 | Owner |
|----------|------|-------------------------|--------------------|----------|------------|-------|
| 1 | OpenBot | a377505 定位 README | `git revert` 或关闭未合并 PR | 用户停 worker | README 仍可访问 | owner |

## 7. 发布前评审结论

- 范围完整性：通过（单仓）
- 候选版本可追溯：通过（git）
- Code PR 已归并默认分支：否（本次只开 PR）
- Production deployment 一致：不适用
- 环境隔离：通过（无云项目混用）
- 数据与迁移：通过（无）
- 测试和 CR：见报告回填
- 回滚可执行：通过
- 双向影响闭包完成：通过
- 每个关联系统均有发布决策和证据：通过
- 候选已冻结且变更后会重新审批：Code PR 期间 head 可变，合入前再核一次
- 最终状态：`awaiting-review`
- 审批人和时间：待 owner

## 8. 发布后核销

### 8.1 最终证据门禁

| 证据 | 结果 | 证据路径/摘要 | 不适用理由 |
|------|------|---------------|------------|
| 真实用户或受控真实账号验证 | 待核销 | 实验室 run/测试 | 无托管账号 |
| 低流量合成探针 | 不适用 | | 无生产域名 |
| DB after/副作用检查 | 不适用 | | 无 DB |
| 日志观察窗口 | 不适用 | | 无中心日志 |
| Callback/fixed alias 漂移检查 | 不适用 | | 无 alias |

完整 Release Train **不得**标 `complete`：本次只交付 Code PR，等待 owner 审核合并。

### 8.2 完整性检查

- `scripts/check_release_integrity.sh`：本仓库未引入该脚本（通用 skill 脚本，不把项目事实写回 skill）。合入 main 后用 `git merge-base --is-ancestor` 核销。
- 默认分支 worktree：Agent 在 feature 分支工作，不强制切回 main 覆盖。
