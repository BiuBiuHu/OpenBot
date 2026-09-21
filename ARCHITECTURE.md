# Architecture (index)

OpenBot is a **local chat window** plus a **systemd-resident `openbot-agent` on your Linux host**.

The same window has three session modes: **local LLM** (default; laptop BYOK; no VPS tools), **remote Agent 1:1**, and **agent group** (v0.5). Chat is not always an Agent.

The remote process **thinks and executes** (task queue, BYOK model loop, tools, approval gates). Agent task state lives on **remote disk** so that work survives closing the laptop. Local LLM stops when the laptop sleeps — that is expected.

It is not a hosted Firecracker fleet. It does not provide desktop / pixel computer-use in v0. A worker that only runs shell jobs is **not** the Agent; computer-use is a later **plugin**, not the Agent.

Canonical design:

- **[docs/openbot-mvp/03-architecture/architecture.md](docs/openbot-mvp/03-architecture/architecture.md)** — layers, migration from PR#1, process table, task lifecycle
- **[docs/openbot-mvp/03-architecture/remote-agent.md](docs/openbot-mvp/03-architecture/remote-agent.md)** — `/v1/tasks` sketch, state machine, 1:1 and group chat mapping

```text
[ Same chat window ]
   Local LLM (default)          Agent 1:1 / (v0.5) room
   laptop BYOK, no tools        create task / events / approve
            |                              |
            v                       optional SSH tunnel
     [ :3847 NL loop ]                     v
                                   [ openbot-agent ]
                                    tools + approvals
                                   host disk: tasks
```

- Bind / bootstrap: still SSH (`src/ssh.ts` + host bootstrap). SSH is not the command channel.
- Persist: systemd-user → tmux → nohup (process name evolves from `openbot-worker` to `openbot-agent`).
- Chat: one window, three modes. Default = local LLM. Pick an Agent/host or `@mention` to escalate. Group rooms (v0.5) must not block the single-process agent core.
