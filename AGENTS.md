# Rules for coding agents

Read this file, `ROADMAP.md`, `docs/ARCHITECTURE.md` and `docs/SECURITY.md` before touching code.
If anything here conflicts with a request in a single task, stop and ask the human.

## How to work

1. Work on **one roadmap step at a time**, in order. Steps marked `(parallel ok)` may be done out of order.
2. Before starting a step, restate its **Done when** list in your plan. You are finished only when every item is true.
3. Keep changes scoped to the step. If you find unrelated problems, add them to `ROADMAP.md` under
   **Backlog** instead of fixing them silently.
4. After finishing a step:
   - `pnpm typecheck && pnpm test && pnpm lint` must pass.
   - If you touched UI or views, run `pnpm dev` and go through the step's manual checks.
   - Tick the step's checkbox in `ROADMAP.md` and add a one-line entry to `CHANGELOG.md`.
   - If you made a choice another agent must respect (library, pattern, file format), add an entry to
     `docs/DECISIONS.md`.
5. Leave unfinished work as `// TODO(ROADMAP x.y): what is missing` so it can be found with grep.
6. Never delete or weaken a test to make it pass. Fix the code or explain in the PR why the test was wrong.

## Where code goes

| Kind of code | Location | Rule |
| --- | --- | --- |
| Layout math, app catalog, privacy settings, workspace model | `packages/core` | Pure TypeScript. **No** `electron`, `node:*`, DOM or React imports. It will be reused on mobile. |
| Window, native views, sessions, network filters, file storage | `apps/desktop/src/main` | Node + Electron. The only place with privileges. |
| Bridge between UI and main | `apps/desktop/src/preload` | Tiny. Only named functions, never raw `ipcRenderer`. |
| UI types shared by preload/main/renderer | `apps/desktop/src/shared` | Types and constants only. |
| The app's own interface (rail, tiles, launcher, menus) | `apps/desktop/src/renderer` | React. No Node access. Talks to main only via `window.aio`. |

## Adding an IPC channel (checklist)

1. Add the channel name and types to `src/shared/ipc.ts` (including the `AioApi` interface).
2. Add a zod schema in `src/main/ipc/schemas.ts`.
3. Add the handler in `src/main/ipc/handlers.ts` using `fromUi()` / `guard()` and the schema.
4. Expose a named function in `src/preload/index.ts`.
5. Add a unit test for the schema (valid and invalid payloads).

## Network request hooks

Electron allows only one listener per `webRequest` event per session. **Never** call
`session.webRequest.*` directly. Add a `RequestFilter` to the pipeline in
`src/main/privacy/requestPipeline.ts` (see `shields.ts` for examples).

## Style

- TypeScript strict. No `any`; use `unknown` and narrow.
- Functions in `packages/core` are pure and return new objects.
- UI copy: sentence case, plain verbs ("Open app", "Split right"), errors say what happened and what to do.
- New dependencies need a line in `docs/DECISIONS.md` explaining why. Prefer none.

## Security invariants (never break these)

See `docs/SECURITY.md` for the full list. The short version:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` on every
  window and view. ESLint enforces this.
- Web app views get no Node, no access to `window.aio`, and no IPC.
- Every IPC payload is validated with zod in main and every sender is checked with `fromUi()`.
- Each app keeps its own session partition. Never share sessions between apps.
- Only `http(s)` URLs are ever loaded or passed to `shell.openExternal`.
- No telemetry, analytics or crash upload in this app, ever, unless the user opts in explicitly.
