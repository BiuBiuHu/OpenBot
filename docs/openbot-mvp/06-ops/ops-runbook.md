# OpenBot MVP 运维手册

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 用户自托管手册 | 产品是本地安装，不是云项目 | 巡检命令针对 worker |

## 1. 当前决策

- 运行模式：笔记本上的控制面（可关）+ 用户 Linux 主机上的 worker（应常驻）。
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
```

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

## 8. 未解决问题

- 多机、自动升级。
