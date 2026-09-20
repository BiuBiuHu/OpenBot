# OpenBot MVP Code Review 自审

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 实现后自审 | opc-skills 本地自审门禁 | 供中文 Code PR 引用 |

## 1. 当前结论

- 审查范围：`cursor/openbot-mvp-a7b3` 相对 `origin/main`。
- 正式 PR：创建后回填链接。
- 生产发布：不在本次（见 release-plan）。

## 2. Diff 自审

| 检查 | 结果 |
|------|------|
| 无关文件 / 密钥 / `.env` 实体 | 只允许 `.env.example`；config 默认 `~/.openbot` |
| 客户端直连 worker | UI 只请求 `/api/*` |
| Worker 不读模型 key | `worker.py` 无 OPENAI |
| 未 bind 不假装成功 | `serve`/`run` 要求 token |
| 错误处理 | SSH/bootstrap/LLM 失败有原文 |
| 性能 | 2C4G：stdlib worker，无浏览器 |
| 迁移 | 无 |
| 测试缺口 | 真实 VPS / 真实 LLM 未测，已记录 |

## 3. 风险

- 审批是启发式，不是沙箱。
- `StrictHostKeyChecking=accept-new` 适合个人安装，不适合高对抗环境。

## 4. 回滚

恢复 `main` 上的定位 README；用户停掉远端 worker。
