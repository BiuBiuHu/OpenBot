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
