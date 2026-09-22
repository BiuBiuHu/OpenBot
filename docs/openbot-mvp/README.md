# Feature `openbot-mvp`

opc-skills 文档根。Feature name：`openbot-mvp`。Project root：本仓库。

目标运行时（**v0**）：本机 **Agent**（规划/编排）交接给远端 **OpenHands Agent Server**（拥有电脑）。一条线程，不是三个 mode。本仓库自建本机壳 + adapter，**不**为 v0 自建 `openbot-agent`。OH 是 dependency / plugin，不是整仓 fork。自建 native agent 延后。群组后置。决策：[03-architecture/runtime-decision-v0.md](03-architecture/runtime-decision-v0.md)。细节从 `03-architecture/` 读起。

| 目录 | 主文档 |
|------|--------|
| 00-research | [competitor-research.md](00-research/competitor-research.md) |
| 01-product | [PRD.md](01-product/PRD.md)、[requirement-validation.md](01-product/requirement-validation.md) |
| 02-ui | [markdown-prototype.md](02-ui/markdown-prototype.md) |
| 03-architecture | [architecture.md](03-architecture/architecture.md)、[remote-agent.md](03-architecture/remote-agent.md)、[runtime-decision-v0.md](03-architecture/runtime-decision-v0.md) |
| 04-engineering | implementation-plan / change-impact / evidence / code-review / backlog |
| 05-testing | test-strategy / test-cases.json / test-report / integration-report |
| 06-ops | [ops-runbook.md](06-ops/ops-runbook.md)、[release-plan.md](06-ops/release-plan.md)、[openhands-agent-server-trial.md](06-ops/openhands-agent-server-trial.md)（v0 远端 runtime 试装，PR#3） |
