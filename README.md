# OpenBot

> **SSH your own machine. The agent gets a computer — you keep the keys.**
>
> 用 SSH 挂上你自己的机器；Agent 拥有一台电脑，钥匙在你手里。

开源、BYOK。体验对齐 [Grok Bot](https://cursor.com) 的核心隐喻（持久电脑 + 聊天遥控），但电脑是用户的，不是托管 Firecracker。

Working title was HostPC; product name is **OpenBot**.

---

## Why this exists

Chat-only assistants stop when you close the laptop. Hosted “agent PCs” work, but lock you into someone else’s VM and token meter.

OpenBot’s bet:

1. A **remote execution environment** is the useful part of Grok Bot.  
2. That environment should be **your machine** (VPS, mini PC, spare laptop) via SSH.  
3. Models use **your API keys**.  
4. Ship something people can clone, try on a 2C4G box, and talk about — community attention first, company later.

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

## Principles

1. **Host first** — Onboarding = connect SSH, not pick a skin.  
2. **BYOK** — No token resale.  
3. **2C4G default** — Headless worker; browser phase 2.  
4. **Approval on the wire** — Dangerous commands wait.  
5. **Open by default** — Trust comes from readable code on *your* host.  
6. **Thin vertical later** — Skills/marketplace after the host metaphor works.

---

## MVP scope

1. **Bind** — SSH key → “my computer”  
2. **Persist** — Worker on the remote host  
3. **Remote** — Chat dispatch + streamed output + approval gate  

Non-goals v0: team admin, marketplace, Firecracker fleet, coding-IDE war with OpenHands.

---

## Shape

```text
[ Phone / Desktop ]  --chat / approve-->  [ Control plane ]
                                               |
                                          SSH + worker
                                               |
                                        [ Your machine ]
                                   files · jobs · shell
                                 (browser optional later)
```

---

## Community goal

Not “beat Grok Bot.”  
**Be the obvious open answer when someone asks:** *can I get a Grok-like agent PC on my own VPS?*

Success metrics (first 90 days): cloneable MVP, clear README metaphor, demos on a real 2C4G host, issues/PRs from strangers.

---

## Status

Positioning locked. Implementation not public yet.

License: TBD (lean MIT or Apache-2.0).  
Repo name suggestion if `OpenBot` is taken: `openbot-pc` / `openbot-host`.
