# OpenHands Agent Server 试装（2C4G 阿里云 ECS）

本文件是 **v0 远端 runtime** 的试装 / 运维笔记（随 PR#3 落地）。产品决策：OH Agent Server 是 dependency / plugin，不是整仓 fork，也不是产品控制台。见 [runtime-decision-v0.md](../03-architecture/runtime-decision-v0.md)。交接 UX 仍见 [remote-agent.md](../03-architecture/remote-agent.md)。

现场已在 **2026-09-21** 于 Ubuntu 24.04、2C4G 阿里云 ECS 复现。下文命令用占位符 `<ECS_HOST>`、`<SSH_IDENTITY>`，**不**把某台公网 IP、PEM 路径或会话密钥写成规范值。

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-21 | 2C4G ECS 试装 runbook：uv / 阿里云 PyPI / systemd / SSH 隧道 | 在用户 BYO 主机上摸 OpenHands Agent Server 手感，对照自建 `openbot-agent` | 仅文档；不改应用代码；不把 OH 升格为产品内核 |
| v0.2 | 2026-09-22 | 回写：选 OH 作 v0 远端 runtime；native 延后 | 用户锁定；出货速度 | §10 不再悬空；链到 runtime-decision-v0.md |

## 1. 当前决策

- OpenHands Agent Server 是用户自有 Linux 上的 **v0 远端执行后端**（dependency / remote runtime plugin）。
- 本仓库 **不** fork OH，也 **不** 用 OH 控制台当产品隐喻。用户语言仍是「这台机器就是我的电脑」。
- 本机壳：规划、BYOK、SSH bind、同一线程交接。远端循环先用本文的进程。自建 `openbot-agent` **延后**。
- 试装目的：在同一类 2C4G 主机上锁定安装成本、内存、探活、隧道与安全边界，供 v0 adapter 复用。
- **禁止**在无鉴权时把 Agent Server 绑到 `0.0.0.0`。只听 `127.0.0.1`；本机用 SSH 本地转发到达。
- 密钥只落在主机 `EnvironmentFile`（`chmod 600`），**永不入库、不贴聊天**。

## 2. 与本仓库的关系

| | v0（已锁定） | 以后 optional native |
|--|--------------|----------------------|
| 进程 | `openhands-agent-server` | `openbot-agent` |
| 角色 | 拥有电脑的远端循环（思考 + 执行） | 并列的自建 runtime |
| 监听 | `127.0.0.1:8000` | `127.0.0.1`（产品端口见架构文） |
| 到达方式 | SSH bind / 本地转发 | 同上 |
| 产品地位 | **v0 远端 runtime plugin** | 延后；不挡 v0 |

同一台主机可以同时存在 PR#1 的 `openbot-worker`、本 runtime、以及以后的 native agent。它们 **不是** 同一个产品进程，也不共用 token。卸载 OH 不等于卸载 OpenBot 本机壳。

OH **不能**替换 [remote-agent.md](../03-architecture/remote-agent.md) 的交接流（同一线程、先问再动手）。调研里已拒绝把 OpenHands 编码控制台当产品主隐喻，见 `00-research/competitor-research.md`。

## 3. 前置

| 项 | 试装现场 | 说明 |
|----|----------|------|
| 发行版 | Ubuntu 24.04 | 其他发行版未验证 |
| 规格 | 2C4G 阿里云 ECS | venv 约 500MB+；装包时内存紧 |
| 交换分区 | **先做 ≥2G swap**（现场用 `/swapfile`） | 不先做 swap，pip/uv 解析时容易 OOM 或假死 |
| Python | **≥ 3.12**；现场系统有 `/usr/bin/python3.12` | 默认 `uv venv` 曾选中 3.11 → 必须 `--python /usr/bin/python3.12` |
| 包管理 | `uv` + `uv pip install` | 不要先走系统 pip 当主路径 |
| PyPI | **阿里云镜像** | 默认源 / 清华源从此 ECS 会 **挂起** |
| 安装目录 | `/opt/openhands-agent` | 现场按 root 装；后续应改非 root |
| 软件包 | `openhands-sdk` `openhands-tools` `openhands-workspace` `openhands-agent-server==1.49.2` | 版本以本次试装为准，升级另记 |

镜像（现场可用）：

```text
https://mirrors.aliyun.com/pypi/simple/
--trusted-host mirrors.aliyun.com
```

swap 骨架（若 `swapon --show` 为空或远小于 2G）：

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
# 开机仍要：把下面一行写入 /etc/fstab（先确认尚未存在）
# /swapfile none swap sw 0 0
```

`uv` 未装时按官方安装器装到用户目录，再保证 `PATH` 含 `$HOME/.local/bin`。

## 4. 安装脚本骨架

在 **ECS 上**执行。脚本不写入真实密钥；密钥用 `openssl` 当场生成。生成后只留在 `/opt/openhands-agent/env`，不要 `cat` 到聊天或工单。

```bash
#!/usr/bin/env bash
# OpenHands Agent Server trial — 2C4G Ubuntu 24.04
# 不是 openbot-agent。勿把 --host 改成 0.0.0.0。
set -euo pipefail

OH_ROOT=/opt/openhands-agent
PY=/usr/bin/python3.12
INDEX=https://mirrors.aliyun.com/pypi/simple/
TRUST=mirrors.aliyun.com

if [[ ! -x "$PY" ]]; then
  echo "需要 $PY（OpenHands 要求 Python >= 3.12）" >&2
  exit 1
fi

if [[ ! -s /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
fi
swapon /swapfile 2>/dev/null || true

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

mkdir -p "$OH_ROOT"
cd "$OH_ROOT"
uv venv --python "$PY" .venv

uv pip install \
  --python "$OH_ROOT/.venv/bin/python" \
  --index-url "$INDEX" \
  --trusted-host "$TRUST" \
  openhands-sdk \
  openhands-tools \
  openhands-workspace \
  'openhands-agent-server==1.49.2'

if [[ ! -f "$OH_ROOT/env" ]]; then
  umask 077
  cat > "$OH_ROOT/env" <<EOF
OH_SESSION_API_KEYS_0=$(openssl rand -hex 32)
OH_SECRET_KEY=$(openssl rand -hex 32)
EOF
  chmod 600 "$OH_ROOT/env"
fi

install -m 644 /dev/stdin /etc/systemd/system/openhands-agent-server.service <<'UNIT'
[Unit]
Description=OpenHands Agent Server (trial, not openbot-agent)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/openhands-agent
EnvironmentFile=/opt/openhands-agent/env
ExecStart=/opt/openhands-agent/.venv/bin/python -m openhands.agent_server --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now openhands-agent-server
```

装完用 §6 探活，不要把 `env` 内容回显到终端历史能被随手复制的地方。

## 5. systemd 单元

单元名：`openhands-agent-server`。`EnvironmentFile=/opt/openhands-agent/env`。

现场 `ExecStart`：

```text
/opt/openhands-agent/.venv/bin/python -m openhands.agent_server --host 127.0.0.1 --port 8000
```

`env` 至少包含（值用 `openssl rand -hex 32` 生成，**示例不是真实密钥**）：

```bash
OH_SESSION_API_KEYS_0=<openssl-hex>
OH_SECRET_KEY=<openssl-hex>
```

```bash
chmod 600 /opt/openhands-agent/env
# 不要 git add；不要贴到 Issue / PR / 聊天
```

试装按 **root + system unit** 复现（安装目录在 `/opt`）。这会关掉 Chromium 沙箱，见 §8。后续若保留 OH，应改为专用非 root 用户与对应目录权限。

改 `env` 或单元后：

```bash
systemctl daemon-reload
systemctl restart openhands-agent-server
```

## 6. 探活与 journalctl

在 **ECS 本机**（或已建立 §7 隧道的笔记本）：

```bash
systemctl status openhands-agent-server --no-pager
curl -sS http://127.0.0.1:8000/health
journalctl -u openhands-agent-server -n 80 --no-pager
```

探活成功时应看到：

```json
{"status":"ok"}
```

现场日志里出现过、**不阻断**探活的项：

| 观察 | 处理 |
|------|------|
| VSCode server 二进制缺失 → VSCode 被禁用 | 试装可忽略；本产品也不依赖 OH 的 VSCode |
| Chromium / Playwright 已在环境里 | 记下即可；OpenBot v0 不把浏览工具当 Agent |
| 以 root 运行 → Chromium sandbox 被关闭 | 安全债，见 §8；不要当成“已经隔离” |

`curl` 失败时先看 `journalctl` 是 OOM、绑错地址，还是 `env` 权限，而不是把监听改成 `0.0.0.0`。

## 7. SSH 隧道

Agent Server 只听回环。从笔记本到达：

```bash
ssh -i <SSH_IDENTITY> -L 8000:127.0.0.1:8000 root@<ECS_HOST>
```

隧道起来后，笔记本上同样：

```bash
curl -sS http://127.0.0.1:8000/health
```

`<SSH_IDENTITY>` 是本机私钥路径；`<ECS_HOST>` 是该次主机名或 IP。二者都不要写进仓库当“官方地址”。合上笔记本只应拆隧道，不应杀掉 ECS 上的 `openhands-agent-server`（与 OpenBot persist 同一原则）。

不要用 `-R` 把 8000 暴露回别的网，也不要在云安全组放行 8000。

## 8. 安全边界

- **只绑 `127.0.0.1`**。无鉴权时绑 `0.0.0.0` 等于把会话面推到公网。安全组“暂时打开”也不构成鉴权。
- 到达路径只有 SSH 本地转发（§7）。不要给 8000 做公网 DNAT / Nginx 反代，除非另有独立鉴权方案（本 trial **不做**）。
- `OH_SESSION_API_KEYS_0` 与 `OH_SECRET_KEY` 是主机本地秘密。生成后只留在 `/opt/openhands-agent/env`（`chmod 600`）。轮换：重写文件并 `systemctl restart`。
- **禁止**把 PEM 全文、`env`、session key、具体公网 IP 贴进 git、PR、聊天或本文件。
- 试装以 root 跑：进程权限 = 整机；Chromium sandbox 会被关掉。这 **不是** 隔离。后续优先非 root。
- 审批门、OH 自己的工具沙箱都 **不能** 替代“不要对公网暴露”。
- 本 trial 与 OpenBot 的 worker token / bind token 分开。不要复用同一串。

## 9. 卸载 / 停服

停服但保留文件：

```bash
systemctl disable --now openhands-agent-server
```

卸干净（不删系统 swap，除非你确定没有别人在用 `/swapfile`）：

```bash
systemctl disable --now openhands-agent-server
rm -f /etc/systemd/system/openhands-agent-server.service
systemctl daemon-reload
rm -rf /opt/openhands-agent
```

卸载 OH **不等于**卸载 OpenBot。`openbot-worker`、本机 `~/.openbot/`、主机 workspace 走 [ops-runbook.md](ops-runbook.md)。以后 optional native `openbot-agent` 也不因卸载 OH 而自动出现。

## 10. 决策出口

**已锁定（2026-09-22）**：选 **B 的加强版** —— OpenHands Agent Server 是 **v0 默认远端 runtime**（plugin / dependency），不是丢掉，也不是整仓 fork。自建 `openbot-agent` 延后为 optional native。全文：[runtime-decision-v0.md](../03-architecture/runtime-decision-v0.md)。本机 adapter：backlog BL-016。

历史对照表（不再悬空）：

| 选项 | 含义 | 状态 |
|------|------|------|
| **A. 丢掉** | OH 只用来对照，不进主路径 | **未选** |
| **B. runtime plugin** | 保留为远端执行后端 | **已选（v0 默认）** |

无论当时 A 还是 B，下面几条仍成立：

- 用户语言仍是“这台机器就是我的电脑”，不是“这次任务跑在哪个 OpenHands backend”。
- 本机 Agent 交接协议仍以 [remote-agent.md](../03-architecture/remote-agent.md) 为准。
- 不要把 OH 控制台、VSCode 集成或 Playwright 说成 OpenBot 已交付能力。
- 不得无鉴权绑 `0.0.0.0`。

## 11. 未解决问题

- 非 root 用户、目录权限、以及 root 关闭 Chromium sandbox 的残留风险。
- 本机壳 adapter（BL-016）薄切片已落地：`npx openbot oh health` / `oh run`，确认交接 → `POST /api/conversations`。笔记：[oh-runtime-adapter.md](oh-runtime-adapter.md)。同一线程回流仍属 BL-011。
- 以后是否再做 native `openbot-agent`（BL-010）—— 不挡 v0。
