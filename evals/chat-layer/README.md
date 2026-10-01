# Chat-layer eval set

Durable cases for the voice the person sees. Replay is local: fixtures in `cases/`, scorer in `src/eval-set.ts`.

Each case records:

- `userMessage`
- `remote.rawReply` (what OpenHands dumped — never shown as-is)
- `remote.status` / `remote.conversationId` (fixture ids, not live hosts)
- `expect` for the short `shown` reply

Run:

```bash
npx openbot eval
```

Writes `~/.openbot/evals/chat-layer-<time>.json` (mode 0600). Live chat appends `~/.openbot/evals/live.jsonl` with the shown reply and conversation id only. No host IPs, PEM, or session keys.

Cases that came from the live laptop:

| id | must not happen |
|----|-----------------|
| `who-are-you` | canned OpenHands self-intro |
| `analyze-other-product` | that same intro for grokbot |
| `timeout-is-short` | raw `conversation timed out while running` plus an investigation log |
| `links-render` | angle-bracket URLs left unclickable |
| `what-is-grok-bot` | canned intro, bare “I don't know”, empty 「还没找到」, or an English source paragraph for a Chinese question |
| `todays-time` | search snippet or a CST clock that claims it has no real time |
| `change-code` | 「先不背说明书。你具体想让这台电脑做什么？」 for a coding request |
| `read-public-doc` | 把公开文档 URL 当电脑任务，只回超时套话 |
