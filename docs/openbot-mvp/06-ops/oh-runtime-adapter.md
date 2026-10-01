# OpenHands runtime adapter（Phase 1）

本机薄客户端怎么经 **SSH 本地转发** 跟已试装的 OpenHands Agent Server 说话。产品决策仍是：[runtime-decision-v0.md](../03-architecture/runtime-decision-v0.md)。装机 / systemd / 卸载：[openhands-agent-server-trial.md](openhands-agent-server-trial.md)。

这不是 OH 控制台，也不是 fork。用户语言仍是「这台机器就是我的电脑」。

## 1. 隧道

Agent Server 只听主机 `127.0.0.1:8000`。笔记本上先开本地转发：

```bash
ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host
```

不要把 8000 对公网暴露，也不要无鉴权绑 `0.0.0.0`。合上笔记本只应拆隧道，不应杀掉主机上的 `openhands-agent-server`。

## 2. 本机配置

复制 [`.env.example`](../../../.env.example) 到 `~/.openbot/.env`（`chmod 600`）：

```bash
OH_BASE_URL=http://127.0.0.1:8000
OH_SESSION_API_KEY=
# 别名：OPENHANDS_BASE_URL / OPENHANDS_API_KEY
```

`OH_SESSION_API_KEY` 只用于请求头 `X-Session-API-Key`。不要写进 git。1.49.2 必须带 `agent.llm`：默认 `model=deepseek/deepseek-chat`、不带 `api_key`，主机 BYOK 自己补；`OH_LLM_MODEL` / 非空 `OH_LLM_API_KEY` 才覆盖。本机用法见 [local-client.md](local-client.md)。

## 3. 探活与交接 stub

```bash
npx openbot oh health
# 或
npx openbot runtime health

npx openbot oh conversations
npx openbot oh run '在工作区写一份 uname 记录'
```

`oh run` 就是**已确认的交接**：创建一个 OH conversation（`POST /api/conversations`，`initial_message` = goal），轮询 `execution_status`，打印 id / 状态 / 事件 snippet。

控制面（`openbot serve`，UI 仍粗糙）：

| 方法 | 路径 | 含义 |
|------|------|------|
| GET | `/api/status` | 现有 worker 探活 + `openhands.ok` |
| POST | `/api/handoffs` | `{goal}` 提案；`{goal, allow:true}` 直接投递 |
| POST | `/api/handoffs/:id` | `{allow:true\|false}` 确认或拒绝（与审批卡同一套确认隐喻） |

未确认不创建远端会话。没有第三个聊天 mode。

## 3.1 Web 遥控台（先连远端）

```bash
# 只要隧道 + session key。不必先 bind worker。
npx openbot serve
# 打开 http://127.0.0.1:3847/
```

聊天没有模式开关：发一条消息就 `POST /api/chat` 创建或续上 OH conversation。Settings 保存主机 / 用户 / 私钥路径到 `~/.openbot` 并尝试开隧道。同一线程是 You / Assistant，只显示最终答复。`/api/handoffs/stream` 同样直发。`/api/run` 仍是 PR#1 worker 逃生口，主 UI 不再露出。本机规划 Agent 仍属 Phase 2。

## 4. 代码位置

| 文件 | 职责 |
|------|------|
| `src/oh-client.ts` | HTTP 客户端：health / create / get / list / events / poll |
| `src/oh-events.ts` | OH 事件 → 最终答复 `token`；独白是 `thought`；状态更新不进气泡 |
| `src/handoff.ts` | This computer 直发：创建或续会话 + 事件回流 |
| `src/thread.ts` | 一条线程：无 key / forceHandoff → OH；有 key 可本机闲聊 |
| `src/config.ts` | `openhands.*`；`OH_BASE_URL` / `OH_SESSION_API_KEY` 优先 |
| `src/cli.ts` | `serve` / `chat` / `oh` / `runtime` |
| `worker/worker.py` | **保留**。PR#1 执行原语对照，本 PR 不删、不改成 openbot-agent |

类型按 OpenHands Agent Server OpenAPI 对齐，但本地自持、字段缺失不崩。

## 5. 在你自己的笔记本上试（推荐）

不要在云 Agent 里填真实 IP / PEM。在**你的电脑**上：

```bash
# 终端 A：隧道
ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host

# 终端 B：本机壳
cd /path/to/OpenBot
# OH_BASE_URL / OH_SESSION_API_KEY 或 ~/.openbot/.env
npx openbot serve
```

浏览器打开 **http://127.0.0.1:3847/oh-test**（会话台首页也有「本机试连」）。

1. 点 **探活 OpenHands** → 应绿灯，`{"status":"ok"}`。
2. 改一条 goal，点 **我确认，发给远端** → 创建 conversation 并轮询 snippet。

页面只经本机壳 `127.0.0.1:3847` 转发，不让浏览器直打 8000（避免 CORS，key 也不进页面）。

## 6. 手工打真实 ECS（CLI）

1. 主机按 [试装笔记](openhands-agent-server-trial.md) 跑着 `openhands-agent-server`。
2. 笔记本 `ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host`。
3. `curl -sS http://127.0.0.1:8000/health` → `{"status":"ok"}`。
4. 写入 `OH_SESSION_API_KEY`（= 主机 session key）。
5. `npx openbot oh health`，再 `npx openbot oh run '…'`。

单元测试只打本地 mock HTTP，不连真实 ECS。
