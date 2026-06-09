# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Cinatra LLM Bridge:**
- Service: Cinatra internal LLM proxy (`{{CINATRA_BASE_URL}}/api/llm-bridge`)
  - Used by: `draft` node (`ApiNode`) in `cinatra/oas.json`
  - HTTP method: POST
  - Auth: platform-injected via `CINATRA_BASE_URL` runtime template variable
  - Preferred provider: `openai`
  - Preferred model: `gpt-5.5`
  - Payload fields: `system`, `user`, `agent_id`, `agent_run_id`, `cinatra_llm`

**Cinatra Object Store (MCP tools):**
- Service: Cinatra platform object persistence, accessed via MCP tool calls in the agent skill
  - `objects_get` — fetches a recipients bundle by UUID ref (`confirmedRecipientsRef`); type `@cinatra-ai/campaigns:recipients`
  - `objects_save` — persists the generated draft bundle; type hint `@cinatra-ai/campaigns:email-draft-bundle`; returns a UUID (`draftBundleRef`)
  - Defined in: `skills/email-drafting/SKILL.md`

## Data Storage

**Databases:**
- None directly — all data persistence goes through the Cinatra object store via `objects_save` / `objects_get` MCP tools

**File Storage:**
- Not applicable

**Caching:**
- None detected

## Authentication & Identity

**Auth Provider:**
- Cinatra platform (host-managed)
  - Implementation: runtime injects `CINATRA_BASE_URL` and agent identity; no explicit OAuth or API-key management in this repo

## Monitoring & Observability

**Error Tracking:**
- Not detected in this repo; assumed to be handled by the Cinatra platform runtime

**Logs:**
- Not applicable — no application logging code present (content-only extension)

## CI/CD & Deployment

**Hosting:**
- Cinatra AI platform (cloud) — agent is registered and executed by the platform, not self-hosted

**CI Pipeline:**
- GitHub Actions — `.github/workflows/ci.yml` (push/PR to `main`)
  - Runs on `ubuntu-latest`, Node 24, pnpm via corepack
  - Jobs: `build` (classify, install, typecheck, test, pack dry-run) and `kind-gates` (OAS validation via `extension-kind-gate.mjs`)
- Release pipeline: `.github/workflows/release.yml` (contents not read; file present)

## Environment Configuration

**Required env vars:**
- `CINATRA_BASE_URL` — injected at runtime by the Cinatra platform; used to resolve the LLM bridge URL in `cinatra/oas.json`

**Secrets location:**
- `.npmrc` present — note existence only, contents not read; likely contains registry auth token for `@cinatra-ai` scoped packages

## Webhooks & Callbacks

**Incoming:**
- None — the agent is invoked by the Cinatra orchestrator, not via inbound webhooks

**Outgoing:**
- HTTP POST to `{{CINATRA_BASE_URL}}/api/llm-bridge` (via `ApiNode` in `cinatra/oas.json`)

## Agent-to-Agent Dependencies

**Runtime agent dependencies** (declared in `package.json` under `cinatra.agentDependencies`):
- `@cinatra-ai/reviewer-agent` `^0.1.0` — provides the HITL reviewer UI (`@cinatra-ai/reviewer-agent:drafts-output` renderer); the `approval_gate` node in `cinatra/oas.json` surfaces a human review screen before the flow ends
- `@cinatra-ai/auditor-agent` `^0.1.1` — declared as required runtime dependency; role is auditing/logging of agent actions within the platform

---

*Integration audit: 2026-06-09*
