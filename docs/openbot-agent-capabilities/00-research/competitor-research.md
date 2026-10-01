# OpenBot 智能体能力 · 竞品与开源调研

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 首版：公开文档 URL 读取 + 四能力边界 | opc-skills 要求非平凡实现前先调研；现场失败把「带链接的文档问句」送进 OpenHands 电脑任务并超时 | 本增量采用本机 HTTP 抓取 + GitHub raw 改写，拒绝把读公开页交给 ECS 浏览器 |

## 1. 当前决策

- 当前采用：笔记本上的 OpenBot 主服务用 Node 内置 `fetch` 读公开 `http(s)` 页；GitHub `blob` 页改写成 `raw.githubusercontent.com`；用标题和前两句人话回答；语言服从 Settings。不新增 npm 依赖，不走 Playwright，不把这一问交给 OpenHands BrowserTool。
- 被拒绝：把「看看这个文档讲了什么」当 ECS 电脑任务（现场已超时）；用搜索 snippet 冒充读过正文；引入 `mcp-server-fetch` / Playwright / readability 库；把公开网页写成「用户的文档库」。
- 调研日期：2026-10-01。
- 旧卷宗：`docs/phases/` 与 `docs/openbot-mvp/` 只作历史。本 feature 与它们冲突时，以本目录为准。

## 2. 环节核心内容

### 2.1 产品能力对照

| 方案 | 人贴公开文档 URL 时做什么 | 谁出网 | 来源 | 适用性 | 决策 |
|------|---------------------------|--------|------|--------|------|
| Claude `web_fetch` | 对话里出现过的 URL 由服务端抓正文，再由模型总结 | 平台 | [Claude web fetch](https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-fetch-tool) | 模式对：指定页才抓，开放常识题不抓 | **借鉴触发条件**。不接 Anthropic 工具，不把抓取放到 ECS。 |
| OpenHands BrowserTool | Agent 在远端浏览器打开页、点、抽内容 | Agent 主机 | [Agent browser use](https://docs.openhands.dev/sdk/guides/agent-browser-use) | 适合「在电脑上操作网页」 | **拒绝作为本增量路径**。现场已证明这类问句当电脑任务会空超时。阶段 4 电脑使用可再讨论浏览器。 |
| `mcp-server-fetch` / GitHub MCP | 给 Agent 配 fetch/GitHub 插件 | Agent 进程 | OpenHands 插件文档 | 多一层 MCP 与 token | **拒绝**。本增量只要公开 HTTP，不要 GitHub token。 |
| markdown-fetch 类 skill | URL → 干净 Markdown 再总结 | 调用方 | [markdown-fetch](https://github.com/ckorhonen/claude-skills/blob/main/skills/markdown-fetch/SKILL.md) | 重渲染、多后端 | **拒绝引入**。GitHub 原始 `.md` 用 raw 即可；HTML 用已有 `stripHtml`。 |
| 本仓库已有 `searchWeb` / `browsePublicPage` | 「是什么」走搜索；搜索空再让 OH 开 Bing | 本机 HTTP，最后才 ECS | `src/web-search.ts`、`src/page-browse.ts` | 百科定义题适用 | **保留给查找**。文档问句不得落入查找，也不得落入 `browsePublicPage`。 |
| 本仓库已有 `page-browse` | 让 OpenHands 开搜索页 | ECS | 同上 | 最后手段 | **文档路径禁用**。 |

### 2.2 通用模式

1. **指定页才抓。** Claude：对话里有具体 URL / 点名某篇才 fetch；「REST 最佳实践」不抓。OpenBot：句子里有公开 URL，并且是「看看 / 讲了什么 / 这个文档 / `.md`」才走文档路径。
2. **抓取与电脑操作分开。** 读公开页是 HTTP；在 ECS 桌面上点浏览器是电脑使用。两者不要混成一个超时任务。
3. **GitHub blob 是 HTML 壳。** 行业惯例读 `raw.githubusercontent.com`，不要解析仓库页面工具条。
4. **短答、用设定语言。** 竞品长文总结仍是人话。OpenBot 已有「几句、Settings 语言、丢掉 OH 说明书」的口吻，文档路径沿用。

### 2.3 自研边界

- 复用：`node:http` 主服务、`fetch`、`stripHtml`、`voiceChatReply` 语言层、`~/.openbot` 配置。
- 自研：`isDocumentReadAsk`、`readableDocumentUrl`、`extractDocumentFacts`、`voiceFromDocument`、`path: "document"`。这是产品分流，不是通用抓取框架。
- 后续可替换：若公开页大量是 JS 壳，再评估 Readability 或受控浏览器；替换点是 `readPublicDocument`，不得把分流改回 OH 电脑任务。

## 3. 风险

- 硬编码某一章关键词（用户记忆 / RAG）会让评测只过这一篇。抽取必须泛化（标题 + 本章/本文句 + 前两句）。
- 私有仓库、登录墙、付费墙：本增量只承诺公开页；读不成说一句「这个链接我没读成」，不要超时套话。
- 不得把公网主机、PEM、session key 写进评测或文档。

## 4. 未解决问题

- 上传本地文件、ECS 工作区文稿读写：仍是后续能力，见 backlog，不在本增量实现。
- 需登录的文档、PDF 二进制：未承诺。
