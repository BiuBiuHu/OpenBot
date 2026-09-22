# OpenBot MVP 运维手册

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 用户自托管手册 | 产品是本地安装，不是云项目 | 巡检命令针对 worker |
| v0.2 | 2026-09-20 | 指向目标进程名 openbot-agent | 架构已确认，实现未搬 | 下列命令仍描述 PR#1 现场 |
| v0.3 | 2026-09-21 | 链到 OpenHands Agent Server 试装笔记 | 2C4G ECS 摸手感，对照自建内核 | 不改变 OpenBot 巡检命令 |
| v0.4 | 2026-09-22 | v0 远端 runtime 定为 OH Agent Server | 用户锁定 | 试装笔记升为 v0 运维路径；native 延后 |
| v0.5 | 2026-09-22 | 本机壳 OH adapter 探活 / `oh run` | Phase 1 代码 | 见 [oh-runtime-adapter.md](oh-runtime-adapter.md) |

## 1. 当前决策

- 运行模式（**现场 / PR#1**）：笔记本上的控制面（可关）+ 用户 Linux 主机上的 worker（应常驻）。下面巡检命令仍描述这条现场路径。
- 运行模式（**v0 目标**）：本机瘦客户端 + 主机上的 **OpenHands Agent Server**（思考+执行，应常驻）。决策：[runtime-decision-v0.md](../03-architecture/runtime-decision-v0.md)。交接：[remote-agent.md](../03-architecture/remote-agent.md)。
- 自建 `openbot-agent` **延后**，不是 v0 运维对象。
- OpenHands 装、探活、隧道、卸载见 [openhands-agent-server-trial.md](openhands-agent-server-trial.md)（PR#3）。只听 `127.0.0.1`，经 `ssh -L` 到达。
- 无托管预发/生产项目。运维对象是**用户自己的主机**。

## 2. 环境隔离

| 位置 | 内容 | 禁止 |
|------|------|------|
| 笔记本 `~/.openbot/` | config、`.env`、token 副本 | 提交到 git |
| 主机 `~/.openbot-worker/` | worker、token、jobs、log | 对公网暴露 3848 |
| 主机 `~/openbot-workspace` | Agent 文件 | 当作沙箱 |

## 3. 安装与日常命令

```bash
git clone https://github.com/BiuBiuHu/OpenBot.git
cd OpenBot
npm install
npm run build
npx openbot init --host <IP> --user <USER> --identity ~/.ssh/id_ed25519
# 编辑 ~/.openbot/.env 写入 OPENAI_API_KEY（聊天需要）
npx openbot bind
npx openbot status
npx openbot run 'uname -a'
npx openbot serve

# v0 OH runtime（先开隧道，再探活）
# ssh -i <SSH_IDENTITY> -L 8000:127.0.0.1:8000 <USER>@<ECS_HOST>
# ~/.openbot/.env: OPENHANDS_BASE_URL=http://127.0.0.1:8000  OPENHANDS_API_KEY=<OH_SESSION_API_KEYS_0>
npx openbot oh health
npx openbot oh run '在工作区写一份 uname 记录'
```

本机指向已隧道的 OH：[oh-runtime-adapter.md](oh-runtime-adapter.md)。试装全文：[openhands-agent-server-trial.md](openhands-agent-server-trial.md)。

## 4. Persist 巡检

优先 systemd 用户单元：

```bash
systemctl --user status openbot-worker.service
journalctl --user -u openbot-worker.service -n 50
loginctl enable-linger "$USER"   # 登出后仍活
```

降级：

```bash
tmux ls | grep openbot-worker
# 或
cat ~/.openbot-worker/persist_method
tail -n 50 ~/.openbot-worker/worker.log
curl -sS http://127.0.0.1:3848/health
```

合上笔记本只应杀死隧道，不应杀死上述进程。

## 5. 回滚与故障

| 症状 | 归因 | 动作 |
|------|------|------|
| bind 失败 | SSH/python3 | 看远端日志；确认 BatchMode 密钥 |
| serve 红灯 | 隧道/worker 死 | 再 bind；检查 persist |
| 聊天失败 | 无 key / 供应商 | Run 仍应可用 |
| 危险命令卡住 | 等待审批 | UI/TTY 批准或拒绝 |

停 worker：

```bash
systemctl --user disable --now openbot-worker.service
tmux kill-session -t openbot-worker
kill "$(cat ~/.openbot-worker/worker.pid)"
```

## 6. 安全边界

- Worker token 当主机本地秘密。
- 审批门不是隔离器。
- 不要把 3848 映射到 0.0.0.0。

## 7. 告警

v0 无中心告警。用户自己看 `worker.log` 与 job 状态。

## 8. OpenHands Agent Server（v0 远端 runtime）

完整步骤、systemd、SSH 隧道与已锁定决策：[openhands-agent-server-trial.md](openhands-agent-server-trial.md)。

- 只听 `127.0.0.1:8000`，经 `ssh -L 8000:127.0.0.1:8000` 到达。禁止无鉴权绑 `0.0.0.0`。
- 探活：`curl -sS http://127.0.0.1:8000/health` → `{"status":"ok"}`；或本机 `npx openbot oh health`（adapter）。
- 停服：`systemctl disable --now openhands-agent-server`。这不影响 `openbot-worker` / 以后的 native `openbot-agent`。

## 9. 未解决问题

- 多机、自动升级。
- 完整同一线程回流 / 本机收尾（BL-011）。`openbot status` 与 `/api/status` 已带 OH 探活。
