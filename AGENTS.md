# orchat — repository conventions

- Package manager: pnpm. Install with `pnpm install --frozen-lockfile`. Never edit `pnpm-lock.yaml` by hand.
- The only quality gate is `pnpm check` (tsc for client + server, then `node --test test/*.test.ts`). Run it before you finish.
- Stack: Hono + oRPC + Drizzle (server, `src/server`), React 19 + TanStack Router/Query + Tailwind v4 + shadcn/ui (client, `src/client`), shared types in `src/shared`.
- UI text is Japanese. Keep it Japanese; do not translate existing strings.
- shadcn components live in `src/client/components/ui/`; use them instead of hand-rolling. `cn()` is in `src/client/lib/utils.ts`.
- Tests: `test/*.test.ts`, node:test + `node:assert/strict`, pure unit tests, no DB/network. Add a test when you change logic in `src/shared` or `src/server`.
- `dev/mock-oidc/*.pem|*.p12` and `.env` are local secrets; never commit them.
- If `AGENTS.local.md` exists next to this file, read it too (gitignored, machine-specific notes).
