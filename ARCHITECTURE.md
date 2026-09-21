# Architecture (index)

OpenBot is a **local Agent** (think / orchestration companion) plus a **systemd-resident `openbot-agent` that has the computer**.

The user talks in **one thread**. Default: plan, clarify, and draft with the local Agent (laptop BYOK). When the work needs the host (shell, files, later browser), the local Agent **proposes a handoff**; the user confirms if policy requires it. The remote agent executes; events stream back into the **same thread**; the local Agent wraps up.

This is **not** three equal chat modes the user switches between. Group rooms stay v0.5.

The remote process **thinks and executes** (task queue, BYOK model loop, tools, approval gates). Handed-off task state lives on **remote disk** so that work survives closing the laptop. Local planning stops when the laptop sleeps — that is expected.

It is not a hosted Firecracker fleet. It does not provide desktop / pixel computer-use in v0. A worker that only runs shell jobs is **not** the Agent; computer-use is a later **plugin**.

Canonical design:

- **[docs/openbot-mvp/03-architecture/architecture.md](docs/openbot-mvp/03-architecture/architecture.md)** — layers, handoff flow, process table, task lifecycle
- **[docs/openbot-mvp/03-architecture/remote-agent.md](docs/openbot-mvp/03-architecture/remote-agent.md)** — `/v1/tasks` sketch, state machine, `handoff_proposal`

```text
[ One thread ]
   you  →  local Agent (plan / clarify / draft)
              │
              │  handoff_proposal  (confirm if policy says so)
              v
        [ openbot-agent : has the computer ]
              │
              │  events back into the same thread
              v
           local Agent wraps up
```

- Bind / bootstrap: still SSH. SSH is not the command channel.
- Persist: systemd-user → tmux → nohup (`openbot-worker` evolves to `openbot-agent`).
- Group rooms (v0.5) must not block the single-process remote core.
