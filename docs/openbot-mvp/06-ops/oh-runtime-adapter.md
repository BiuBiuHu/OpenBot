# OpenHands runtime adapter（Phase 1）

本机薄客户端怎么经 **SSH 本地转发** 跟已试装的 OpenHands Agent Server 说话。产品决策仍是：[runtime-decision-v0.md](../03-architecture/runtime-decision-v0.md)。装机 / systemd / 卸载：[openhands-agent-server-trial.md](openhands-agent-server-trial.md)。

这不是 OH 控制台，也不是 fork。用户语言仍是「这台机器就是我的电脑」。

## 1. 隧道

Agent Server 只听主机 `127.0.0.1:8000`。笔记本上先开本地转发：

```bash
ssh -i <SSH_IDENTITY> -L 8000:127.0.0.1:8000 <USER>@<ECS_HOST>
```

不要把 8000 对公网暴露，也不要无鉴权绑 `0.0.0.0`。合上笔记本只应拆隧道，不应杀掉主机上的 `openhands-agent-server`。

## 2. 本机配置

复制 [`.env.example`](../../../.env.example) 到 `~/.openbot/.env`（`chmod 600`）：

```bash
OPENHANDS_BASE_URL=http://127.0.0.1:8000
OPENHANDS_API_KEY=<与主机 OH_SESSION_API_KEYS_0 相同>
# 等价：OH_SESSION_API_KEY=
```

`OPENHANDS_API_KEY` 只用于请求头 `X-Session-API-Key`。不要写进 git。远端模型循环另用主机 BYOK（`OPENHANDS_LLM_MODEL` / `OPENHANDS_LLM_API_KEY`，可选）。

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

## 4. 代码位置

| 文件 | 职责 |
|------|------|
| `src/oh-client.ts` | HTTP 客户端：health / create / get / list / events / poll |
| `src/handoff.ts` | 交接提案存储 + 确认后 `createConversation` |
| `src/config.ts` | `openhands.*` + 上列环境变量 |
| `src/cli.ts` | `oh` / `runtime` 子命令 |
| `worker/worker.py` | **保留**。PR#1 执行原语对照，本 PR 不删、不改成 openbot-agent |

类型按 OpenHands Agent Server OpenAPI 对齐，但本地自持、字段缺失不崩。

## 5. 手工打真实 ECS

1. 主机按 [试装笔记](openhands-agent-server-trial.md) 跑着 `openhands-agent-server`。
2. 笔记本 `ssh -L 8000:127.0.0.1:8000 …`。
3. `curl -sS http://127.0.0.1:8000/health` → `{"status":"ok"}`。
4. 写入 `OPENHANDS_API_KEY`（= 主机 `OH_SESSION_API_KEYS_0`）。
5. `npx openbot oh health`，再 `npx openbot oh run '…'`。

单元测试只打本地 mock HTTP，不连真实 ECS。
