# OpenBot

> **SSH your own machine. The agent gets a computer — you keep the keys.**
>
> 用 SSH 挂上你自己的机器；Agent 拥有一台电脑，钥匙在你手里。

开源、BYOK。体验对齐 Grok Bot 的核心隐喻（**持久电脑 + 聊天遥控**），但电脑是**用户的**，不是托管 Firecracker，也不是像素桌面对等。

Working title was HostPC; product name is **OpenBot**.

本仓库按 [opc-skills](https://github.com/BiuBiuHu/opc-skills) 交付。MVP 主文档在 [`docs/openbot-mvp/`](docs/openbot-mvp/)。

---

## Why this exists

Chat-only assistants stop when you close the laptop. Hosted “agent PCs” work, but lock you into someone else’s VM and token meter.

OpenBot’s bet:

1. A **remote execution environment** is the useful part of Grok Bot.
2. That environment should be **your machine** (VPS, mini PC, spare laptop) via SSH.
3. Models use **your API keys**.
4. Ship something people can clone, try on a **2C4G headless** box, and talk about.

---

## One-line pitch

**Grok-like agent PC, bring your own host + bring your own key.**

和 Grok Bot 对齐的是「有一台一直在线的电脑」；不对齐的是托管与账单。

---

## vs related products

| | Computer means | Who owns the host | Tokens |
| --- | --- | --- | --- |
| **Grok Bot** | Persistent cloud PC | Platform | Subscription |
| **OpenHands** | Task backend / sandbox | Often you, but product = coding console | BYOK |
| **Local computer-use** | The laptop in front of you | You | BYOK |
| **OpenBot** | **Long-lived agent PC over SSH** | **You** | **BYOK** |

OpenHands can attach a remote box; OpenBot’s product language is different: **this host is my computer**, not “which backend runs this coding task.”

---

## Experience bar (Grok-aligned, OSS-honest)

**Align on purpose**

- Chat as the remote control
- Work survives closing the laptop
- Files and job state live on the host
- Risky actions ask before running

**Defer (don’t fake Grok parity day one)**

- Full desktop / pixel computer-use
- Hosted Firecracker isolation
- Polished mobile + Auto Review depth

MVP truth: *bind SSH → leave a job running → lid down → reopen and see result or approval.*

---

## Install (vertical slice)

Requires **Node 20+** on the laptop, and **Python 3 + bash** on the Linux host. The worker has **zero pip deps**.

```bash
git clone https://github.com/BiuBiuHu/OpenBot.git
cd OpenBot
npm install
npm run build

npx openbot init --host YOUR_VPS --user ubuntu --identity ~/.ssh/id_ed25519
# Optional chat: copy .env.example → ~/.openbot/.env and set OPENAI_API_KEY
npx openbot bind
npx openbot run 'uname -a'
npx openbot serve          # http://127.0.0.1:3847
```

`uname -a` is executed by the **remote worker**, not the browser and not as a fake local stub.

Secrets live in `~/.openbot` (mode `0600`). Never commit them. See `.env.example`.

---

## Persist after you close the laptop

`openbot bind` copies `worker/worker.py` over SSH and starts it with, in order:

1. **systemd --user** `openbot-worker.service` (enables linger when possible)
2. **tmux** session `openbot-worker`
3. **nohup** + `~/.openbot-worker/worker.pid`

Jobs and logs stay under `~/.openbot-worker/jobs` on the host. Closing the UI only drops the SSH tunnel.

```bash
npx openbot status
# on the host:
systemctl --user status openbot-worker.service
# or: tmux ls | grep openbot-worker
```

Details: [`docs/openbot-mvp/06-ops/ops-runbook.md`](docs/openbot-mvp/06-ops/ops-runbook.md).

---

## Approval gate

Destructive or privileged commands (`rm -rf`, `sudo`, reboot, pipe-to-shell, …) pause until you approve in the UI or TTY. This is a product gate, **not** a sandbox.

---

## Shape

```text
[ Phone / Desktop ]  --chat / approve-->  [ Control plane on your laptop ]
                                               |
                                          SSH tunnel
                                               |
                                        [ Your machine ]
                                   worker · files · jobs · shell
                                 (no desktop in v0)
```

Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/openbot-mvp/03-architecture/architecture.md`](docs/openbot-mvp/03-architecture/architecture.md).

---

## Community goal

Not “beat Grok Bot.”
**Be the obvious open answer when someone asks:** *can I get a Grok-like agent PC on my own VPS?*

---

## Status

Runnable MVP vertical slice. Positioning + implementation live in this repo.

License: [MIT](LICENSE).
