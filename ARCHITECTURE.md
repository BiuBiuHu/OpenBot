# Architecture (index)

OpenBot is a **locally installed** control plane plus a **persistent worker on your Linux host**.

It is not a hosted Firecracker fleet and does not provide desktop / pixel computer-use in v0.

The canonical design (layers, mermaid call graphs, API, anti-corruption rules) lives in:

**[docs/openbot-mvp/03-architecture/architecture.md](docs/openbot-mvp/03-architecture/architecture.md)**

```text
[ Web UI / CLI ] --> [ Control plane :3847 ]
                          |  BYOK LLM (laptop only)
                          |  approval gate
                          v
                    [ ssh -L tunnel ]
                          v
                    [ worker.py 127.0.0.1:3848 ]
                          v
                    [ your host: shell, workspace, jobs ]
```

- Bind: `src/ssh.ts` + `worker/bootstrap.sh`
- Persist: systemd-user → tmux → nohup
- Remote: `worker/worker.py` jobs + `src/worker-client.ts`
- Chat: `src/agent.ts` (OpenAI-compatible tools execute on the host)
