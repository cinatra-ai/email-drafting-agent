# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript — configured via `tsconfig.json`, targeting `ES2023`, with strict mode enabled; sources expected under `src/` (no `src/` directory present — this is a content-only agent extension with no tracked TypeScript sources)

**Secondary:**
- JavaScript (ESM) — `extension-kind-gate.mjs` is a self-contained Node.js validation script using only Node builtins

## Runtime

**Environment:**
- Node.js 24 (required by CI in `.github/workflows/ci.yml`)

**Package Manager:**
- pnpm (via corepack — `corepack enable` in CI)
- Lockfile: not committed (CI uses `--no-frozen-lockfile`; `.npmrc` present)

## Frameworks

**Core:**
- Cinatra Agent Framework (agentspec_version `26.1.0`) — the agent flow is defined declaratively in `cinatra/oas.json` as a `Flow` component type with `StartNode`, `ApiNode`, `InputMessageNode`, and `EndNode` nodes
- No application web framework (Express, Fastify, etc.) — this is a content-only extension; runtime is provided by the Cinatra platform

**Testing:**
- Not applicable — no test files present; CI skips tests for this source-mirror repo (monorepo runs tests)

**Build/Dev:**
- TypeScript compiler (`tsc`) — configured in `tsconfig.json`, `outDir: dist`, `rootDir: src`
- No bundler detected

## Key Dependencies

**Critical:**
- `@cinatra-ai/auditor-agent` `^0.1.1` — runtime agent dependency declared in `package.json` under `cinatra.agentDependencies`; not a npm dep, resolved by the Cinatra platform
- `@cinatra-ai/reviewer-agent` `^0.1.0` — runtime agent dependency; provides the `@cinatra-ai/reviewer-agent:drafts-output` renderer for the HITL approval screen

**Infrastructure:**
- No npm `dependencies` or `devDependencies` declared — all Cinatra platform packages are host-internal and resolved only within the monorepo workspace

## Configuration

**Environment:**
- `CINATRA_BASE_URL` — runtime-injected template variable used in `cinatra/oas.json` (`ApiNode.url: "{{CINATRA_BASE_URL}}/api/llm-bridge"`); not an npm env var
- `.npmrc` present — note existence only, contents not read

**Build:**
- `tsconfig.json` — standalone strict TypeScript config; targets ESNext modules, bundler module resolution, JSX react-jsx, emits to `dist/`
- `package.json` — ESM package (`"type": "module"`), version `0.1.0`, Apache-2.0 license

## Platform Requirements

**Development:**
- Node.js 24+
- pnpm (via corepack)
- This repo is a source mirror; full install and typecheck run only within the Cinatra monorepo workspace

**Production:**
- Cinatra AI platform (cloud-hosted); agent is deployed/executed by the Cinatra runtime, not as a standalone Node process

---

*Stack analysis: 2026-06-09*
