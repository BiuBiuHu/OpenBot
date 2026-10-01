# 本机客户端对接已运行的 OpenHands

远端 **OpenHands Agent Server 已经在你的主机上跑着**（systemd `openhands-agent-server`，本机环回探活 `{"status":"ok"}`）。本仓库只提供本机壳：一条聊天线程，发给这台电脑就直接对话，最终答复回流到同一窗口。

不要把公网 IP、SSH 私钥、session key、模型 key 写进仓库或 PR。

## 1. 笔记本上开隧道

Agent Server 只听主机 `127.0.0.1:8000`。另开一个终端：

```bash
ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host
```

本机应能：`curl -sS http://127.0.0.1:8000/health` → `{"status":"ok"}`。

## 2. 配置（二选一）

环境变量：

```bash
export OH_BASE_URL=http://127.0.0.1:8000
export OH_SESSION_API_KEY=   # 主机 EnvironmentFile 里的 session key，请求头 X-Session-API-Key
```

或写入 **不会进 git** 的文件（仓库 `.env` 已 gitignore，也可用 `~/.openbot/.env`）：

```bash
OH_BASE_URL=http://127.0.0.1:8000
OH_SESSION_API_KEY=
```

`OPENHANDS_BASE_URL` / `OPENHANDS_API_KEY` 仍是别名。缺本机 `OPENAI_API_KEY` 没关系，闲聊会跳过，走远端交接。

**不要用本机 `OPENAI_MODEL` / 空的 `OPENAI_API_KEY` 去覆盖主机已配好的 LLM。** Agent Server 1.49.2 要求请求里带 `agent.llm`：默认只发 `model=deepseek/deepseek-chat`、不带 key，让主机环境给 DeepSeek 凭证；只有 `OH_LLM_MODEL` / 非空 `OH_LLM_API_KEY` 才会改。不必 unset 或藏起 `~/.openbot/.env`：进程或文件里空的 `OPENAI_API_KEY` 都不算本机模型已配置，默认仍走远端 DeepSeek。

## 3. 从干净 checkout 跑起来

```bash
git clone <this-repo>
cd OpenBot
npm install
npx openbot oh health
npx openbot serve
```

- 探活：`npx openbot oh health` 应打印 `OpenHands http://127.0.0.1:8000 ok`。
- UI：打开 `http://127.0.0.1:3847/`。顶栏看 OH 绿灯。输入任务就会直接发给 OpenHands，同一线程里是 You / Assistant，气泡里只显示最终答复，不堆 remote 状态卡。
- 试连页：`http://127.0.0.1:3847/oh-test`。
- CLI 同一路径：`npx openbot chat '在工作区写一份 uname 记录'`（`oh run` 仍是已确认交接）。

不必 `openbot bind`。PR#1 worker 仍在，只是这条路径用不到。

## 4. 实验室 vs 你的 ECS

| 这边已经测过 | 还需要你在自己笔记本 + ECS 上做 |
|--------------|----------------------------------|
| mock HTTP：health、建会话、事件映射、直发对话、`/api/chat` SSE、CLI `oh health` / `chat` | 真隧道打到已部署的 Agent Server |
| `npx tsc --noEmit` 与 `npm test` | 真 session key、真远端模型循环、任务跑到 finished |

没有真实 ECS 的 CI。不要把 live 测试标绿。
