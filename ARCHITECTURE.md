# Architecture (index)

OpenBot is a **local Agent** (think / orchestration companion) plus a **remote runtime that has the computer**. v0 remote runtime is **OpenHands Agent Server** (dependency / plugin, not a fork). A self-built `openbot-agent` is deferred. See [docs/openbot-mvp/03-architecture/runtime-decision-v0.md](docs/openbot-mvp/03-architecture/runtime-decision-v0.md).

The user talks in **one thread**. Default: plan, clarify, and draft with the local Agent (laptop BYOK). When the work needs the host (shell, files, later browser), the local Agent **proposes a handoff**; the user confirms if policy requires it. The remote agent executes; events stream back into the **same thread**; the local Agent wraps up.

This is **not** three equal chat modes the user switches between. Group rooms stay v0.5.

The remote process **thinks and executes** (task queue, BYOK model loop, tools, approval gates). Handed-off task state lives on **remote disk** so that work survives closing the laptop. Local planning stops when the laptop sleeps — that is expected.

It is not a hosted Firecracker fleet. Desktop / VNC / a live visible screen is an OpenBot **extension** (same BYO machine, beside OH — not an OH fork). It is **not** required to ship v0, but it is a near-term backlog item so the product is not “OH-only forever.” A worker that only runs shell jobs is **not** the Agent.

Canonical design:

- **[docs/openbot-mvp/03-architecture/runtime-decision-v0.md](docs/openbot-mvp/03-architecture/runtime-decision-v0.md)** — v0 remote runtime lock
- **[docs/openbot-mvp/03-architecture/architecture.md](docs/openbot-mvp/03-architecture/architecture.md)** — layers, handoff flow, process table, task lifecycle
- **[docs/openbot-mvp/03-architecture/remote-agent.md](docs/openbot-mvp/03-architecture/remote-agent.md)** — handoff UX, state machine, later native `/v1/tasks` sketch
- **[docs/openbot-mvp/06-ops/openhands-agent-server-trial.md](docs/openbot-mvp/06-ops/openhands-agent-server-trial.md)** — OH Agent Server install / tunnel (PR#3)

```text
[ One thread ]
   you  →  local Agent (plan / clarify / draft)
              │
              │  handoff_proposal  (confirm if policy says so)
              v
        [ remote runtime v0=OpenHands Agent Server : has the computer ]
              │
              │  events back into the same thread
              v
           local Agent wraps up
```

- Bind / bootstrap: still SSH. SSH is not the command channel.
- Persist: v0 = `openhands-agent-server` (see trial ops). PR#1 still uses systemd-user → tmux → nohup `openbot-worker`. Native `openbot-agent` is later / optional.
- Group rooms (v0.5) must not block the v0 handoff path.
