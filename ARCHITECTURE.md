# Architecture (index)

OpenBot is a **thin local client** plus a **systemd-resident `openbot-agent` on your Linux host**.

The remote process **thinks and executes** (task queue, BYOK model loop, tools, approval gates). Task state lives on **remote disk** so work survives closing the laptop.

It is not a hosted Firecracker fleet. It does not provide desktop / pixel computer-use in v0. A worker that only runs shell jobs is **not** the Agent; computer-use is a later **plugin**, not the Agent.

Canonical design:

- **[docs/openbot-mvp/03-architecture/architecture.md](docs/openbot-mvp/03-architecture/architecture.md)** — layers, migration from PR#1, process table, task lifecycle
- **[docs/openbot-mvp/03-architecture/remote-agent.md](docs/openbot-mvp/03-architecture/remote-agent.md)** — `/v1/tasks` sketch, state machine, 1:1 and group chat mapping

```text
[ Web / CLI chat ]
   1:1 thread or (v0.5) room
            |
            v
[ Thin client :3847 ]  -- create task / subscribe events / approve --
            |
     SSH bind / optional tunnel
            |
            v
[ openbot-agent  127.0.0.1 ]  -- BYOK LLM --
        |            |
     tools        approvals
   shell+files    (product gate)
        |
        v
[ host disk: tasks · events · workspace · secrets ]
```

- Bind / bootstrap: still SSH (`src/ssh.ts` + host bootstrap). SSH is not the command channel.
- Persist: systemd-user → tmux → nohup (process name evolves from `openbot-worker` to `openbot-agent`).
- Chat: local UI is the conversation surface; the remote agent is the runtime. v0 = 1:1 with one named agent; v0.5 = group rooms. Group chat must not block the single-process agent core.
