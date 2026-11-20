---
description: Run the available BrowserDeck checks and report exact results
---

Run the checks that actually exist in `package.json`, in this order where available:

1. Relevant unit tests first.
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test:unit`
5. `npm run test:e2e` when the phase touches native views, sessions, IPC, layout synchronization, or persistence.
6. `npm run build`

Do not invent scripts or claim a check ran when it did not. Report each command with its result (pass/fail/skipped/unavailable), summarize failures with the relevant output, and list any checks that require manual GUI verification.
