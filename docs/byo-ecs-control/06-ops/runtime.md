# Bot runtime 安装与测试

## 0. 版本历史

v0.1 / 2026-11-20：新增独立运行时。保留安派仓库独立，单用户测试入口 `/bot`。

## 1. 当前决策

运行时入口 `dist/bot/main.js` 只依赖 Node 内置模块及本项目 OH client/events，不安装 Pi、浏览器或安派代码。HTTP 仅监听 loopback，所有接口需 Bearer service-token。OpenHands 仍须单独安装。SSH 与 runtime 身份双重校验；不暴露公网服务。

## 2. 安装

在本仓库安装构建依赖后运行 `node scripts/build-bot.mjs <commit>`，产出 `dist/openbot-runtime-<commit>.tar.gz`；脚本只打包指定提交的最小运行时。将可追溯 commit 的构建产物 `dist/bot/`、`dist/oh-client.js`、`dist/oh-events.js` 和含 `{"type":"module"}` 的 package.json 置于 ECS 独立版本目录。配置：

- `BOT_PORT` 默认 3850。
- `BOT_DATA_DIR` 独立持久目录，禁止放进 Agent 工作区。
- `BOT_WORKSPACE` 绝对路径，专用测试目录。
- `OH_BASE_URL` 默认 ECS loopback 8000。
- `OH_SESSION_API_KEY` 或现有服务环境中的 `OH_SESSION_API_KEYS_0`。
- `OH_LLM_MODEL/OH_LLM_API_KEY/OH_LLM_BASE_URL` 可选，遵循现有 OH provider 配置。

启动 `node dist/bot/main.js`，建议由 systemd 监管，运行用户需有工作区权限。首次启动生成 mode 0600 的 service-token；通过现有安全 SSH 获取并填入本地 `/bot`。不向聊天、仓库或日志输出密钥。

本机 `npm run dev -- --port 3847` → `/bot`；SSH 配置沿用旧 Settings。首次输入 Bot token，随后只点恢复连接。转发使用临时空闲端口，禁止误用本机遗留服务。

## 3. 保证与限制

任务持久化在远端，客户端断连后继续执行。独立运行时重启后读取已记录 conversationId，查询 OH；不重发 create。若 runtime 在 create 之后、记录 ID 之前崩溃，按预分配 UUID 查询；缺失则 interrupted，人工核对，不自动重复执行。

工作区串行执行，暂停/等待审批会保持队列。文件 API 只读预览/列表，写入通过自然语言任务由 OH 工具完成，默认 AlwaysConfirm。审批展示真实 ActionEvent 后允许/拒绝。暂停是 OH 的 pause，不宣称杀掉任意后台子进程。

目前为单用户专用主机信任边界；文件路径检查不是任意 shell 的安全沙箱。旧 OH 若以 root 运行，批准命令可影响整机，测试仅使用专用目录。不要将此版本直接作为多租户公网服务。

## 4. 回滚

停止本次独立 runtime 服务，恢复上一构建版本；保留 BOT_DATA_DIR 和 workspace。不修改、重启、卸载既有 OpenHands，不改安全组。任务产生的文件需要单独处理，切换版本不撤销 shell 副作用。
