# @letter/node

Official Node.js client for **[letter.app](https://letter.app)** — onboarding
email drip campaigns for product teams.

```bash
pnpm add @letter/node
# or: npm install @letter/node
# or: yarn add @letter/node
```

Requires Node **20+**. Ships as ESM with TypeScript types.

## Quick start

```ts
import { Letter } from "@letter/node";

const letter = new Letter({
  apiKey: process.env.LETTER_API_KEY!, // from Dashboard → Settings → API keys
});

// Long-running server: enqueue, fire-and-forget, auto-batched.
letter.track({
  userId: user.id,
  event: "Workspace Created",
  properties: { workspaceId: workspace.id },
});

// Required before process exit so no events are lost.
await letter.close();
```

In serverless / edge handlers, set `flushAt: 1` and use the `*Sync` methods (or
`await letter.flush()` at the end of each handler):

```ts
const letter = new Letter({ apiKey: process.env.LETTER_API_KEY!, flushAt: 1 });

await letter.trackSync({ userId, event: "Checkout Started" });
```

## What it does

- **Auto-batching** — calls are queued and flushed every 100ms or 50 events.
- **Retries** — `429` waits `Retry-After`, `5xx` and network errors back off
  exponentially with jitter, up to `maxRetries` (default 3).
- **Idempotent** — every `track` gets a UUID `messageId` so retries are
  deduplicated server-side.
- **Typed** — full TypeScript signatures for every method.

## Full documentation

The complete reference, including all constructor options, methods, retry
behavior, and the underlying HTTP API, lives at:

- **SDK reference:** <https://letter.app/docs/node-sdk>
- **Ingestion API:** <https://letter.app/docs/api>

## License

MIT — see [LICENSE](./LICENSE).
