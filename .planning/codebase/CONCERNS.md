# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**OAS inputs / SKILL.md inputs are out of sync:**
- Issue: `cinatra/oas.json` declares `campaignId` (UUID) and `confirmedRecipients` (array) as its two primary inputs and wires `campaignId` through every DataFlowEdge. `skills/email-drafting/SKILL.md` explicitly states "There is NO `campaignId`" and instead expects `confirmedRecipientsRef` (a UUID object ref), `offeringCompanyWebsite`, `callToAction`, and `senderName`. These two contracts describe different data models: the OAS passes a raw recipients array; the skill expects an object-store ref fetched via `objects_get`.
- Files: `cinatra/oas.json`, `skills/email-drafting/SKILL.md`
- Impact: An orchestrator wiring the agent from the OAS surface will pass `campaignId` + `confirmedRecipients` (array), but the underlying LLM instruction expects `confirmedRecipientsRef` and additional scalar fields. The agent will silently draft with incomplete context or fail to call `objects_get`/`objects_save` as intended.
- Fix approach: Reconcile the two contracts — either update `cinatra/oas.json` inputs to match SKILL.md's expected fields (`confirmedRecipientsRef`, `offeringCompanyWebsite`, `callToAction`, `senderName`) and remove `campaignId`, or update SKILL.md to reflect the actual OAS-driven interface.

**`draftBundleRef` output missing from OAS:**
- Issue: SKILL.md STEP 4 specifies the agent should return `{ "draftBundleRef": "<objectId>", "summary": "..." }`, but `cinatra/oas.json` exposes a `draftBundle` (object) output — not a `draftBundleRef` (UUID string). The draft node system prompt asks for a full `draftedEmails` array returned inline, bypassing `objects_save` entirely.
- Files: `cinatra/oas.json` (`draft` node system prompt, `end` node outputs), `skills/email-drafting/SKILL.md`
- Impact: Downstream flows expecting a `draftBundleRef` UUID to pass into the next subflow via DataFlowEdge will receive an oversized inline object instead. Object-store persistence is skipped.
- Fix approach: Add a `draftBundleRef` (string/uuid) output to the OAS end node, update the draft node system prompt to call `objects_save` and return only the ref, mirroring SKILL.md STEP 3-4.

**`agentspec_version` references a non-existent model:**
- Issue: `cinatra/oas.json` `cinatra_llm.preferredModel` is set to `"gpt-5.5"`. As of this analysis, no such model exists in OpenAI's public API.
- Files: `cinatra/oas.json` (line ~215)
- Impact: At runtime the LLM bridge will likely reject or fall back silently, producing unpredictable behavior. If the bridge has no fallback, all drafting calls will fail.
- Fix approach: Replace `"gpt-5.5"` with a known, available model identifier (e.g., `"gpt-4o"` or `"gpt-4.1"`).

**`tsconfig.json` declares a `src/` root that does not exist:**
- Issue: `tsconfig.json` sets `"rootDir": "src"` and `"include": ["src/**/*.ts", "src/**/*.tsx"]`, but there is no `src/` directory in the repo. The repo contains only `cinatra/oas.json`, `skills/`, and `extension-kind-gate.mjs` (a plain `.mjs` file outside `src/`).
- Files: `tsconfig.json`
- Impact: Running `tsc` standalone would emit TS18003 "No inputs found." The CI workflow handles this gracefully by detecting no tracked `.ts` files and skipping typecheck, but the config is misleading and would fail if any TypeScript were added without a matching `src/` directory.
- Fix approach: Either remove `tsconfig.json` (content-only extension needs none) or update it to reflect the actual file layout if TypeScript sources are added in future.

**`package.json` missing `peerDependencies` / `peerDependenciesMeta` for runtime agent deps:**
- Issue: `package.json` declares `@cinatra-ai/auditor-agent` and `@cinatra-ai/reviewer-agent` under `cinatra.dependencies` and `cinatra.agentDependencies`, but not under `peerDependencies` / `peerDependenciesMeta`. The CI classify step checks for first-party deps in `peerDependencies` to determine source-mirror vs standalone mode and would classify this repo as "standalone" (exit code 1), triggering a full install that will fail because no lockfile is committed and the private registry is unreachable.
- Files: `package.json`, `.github/workflows/ci.yml` (classify step)
- Impact: CI may attempt `pnpm install --no-frozen-lockfile` in an environment without registry access, causing a build failure on every PR from a fork.
- Fix approach: Add `peerDependencies` entries for `@cinatra-ai/auditor-agent` and `@cinatra-ai/reviewer-agent` with `peerDependenciesMeta` marking them `optional: true`, matching the pattern the CI classify step expects.

## Known Bugs

**`approval_gate` renderer references a non-existent surface ID:**
- Symptoms: The `approval_gate` node in `cinatra/oas.json` sets `"renderer": "@cinatra-ai/reviewer-agent:drafts-output"` but `metadata.cinatra.hitlScreens` at the top level only registers `"@cinatra-ai/reviewer-agent:output"`. The two identifiers differ (`drafts-output` vs `output`).
- Files: `cinatra/oas.json` (top-level `metadata.cinatra.hitlScreens`, `approval_gate` node `metadata.cinatra.renderer`)
- Trigger: Any HITL (human-in-the-loop) render pass that resolves screens via `hitlScreens`.
- Workaround: None confirmed. The marketplace-side validator would catch this at publish/install.

## Security Considerations

**Recipient PII passed as inline template variable:**
- Risk: The OAS `draft` node user prompt includes `{{ confirmedRecipients }}` — a full array of recipient objects — interpolated inline into the LLM request body. If recipients contain email addresses, phone numbers, or other PII, the entire array is transmitted to the LLM provider (OpenAI) in plaintext.
- Files: `cinatra/oas.json` (`draft` node `data.user`)
- Current mitigation: None observed. The SKILL.md approach (fetching via `objects_get` and operating per-recipient) would reduce the blast radius by fetching only what is needed.
- Recommendations: Scope PII transmitted to the LLM to the minimum required fields (name, title, company). Do not pass raw recipient arrays wholesale.

**`.npmrc` present — existence noted:**
- Risk: `.npmrc` may contain a registry auth token for `@cinatra-ai/*` scoped packages.
- Files: `.npmrc`
- Current mitigation: Not read. Ensure this file is in `.gitignore` or contains only the registry URL (no token) before committing to a public mirror.

## Performance Bottlenecks

**Single LLM call for entire recipient list:**
- Problem: The `draft` node passes the full `confirmedRecipients` array in one LLM call. For large campaigns this produces a very long prompt + long JSON output, increasing latency and raising the probability of truncation or JSON parse failure.
- Files: `cinatra/oas.json` (`draft` node system/user prompts)
- Cause: Batch-at-once design rather than per-recipient calls.
- Improvement path: Iterate per recipient (as SKILL.md describes) or implement chunked batching with intermediate `objects_save` calls.

## Fragile Areas

**`extension-kind-gate.mjs` light XML parser:**
- Files: `extension-kind-gate.mjs` (`validateBpmnSanity`, lines ~200–279)
- Why fragile: The BPMN sanity checker is a regex-based tag-balance walk, not a true XML parser. It explicitly strips comments, CDATA, and PIs before walking, but complex namespace-prefix rebinding, deeply nested CDATA, or non-ASCII element names could defeat the regex (`tagRe`). The code acknowledges it is not a full XML parser.
- Safe modification: Add unit tests for edge cases (default namespace, unprefixed elements, single-quoted xmlns, nested namespaces) before extending the validator.
- Test coverage: No tests exist for `extension-kind-gate.mjs` in this repo. The monorepo is assumed to own tests, but they are not present here.

**OAS JSON is the sole source of agent behavior — no validation beyond banned-primitive scan:**
- Files: `cinatra/oas.json`
- Why fragile: The CI gate (`extension-kind-gate.mjs`) only checks for retired CRM primitive names in LLM-visible strings. It does not validate: required output fields, DataFlowEdge source/destination alignment, node reference integrity (`$component_ref` targets exist), or JSON Schema correctness of input/output types. Structural regressions in the OAS would pass CI and only be caught marketplace-side.
- Safe modification: Add structural OAS validation steps (node ref integrity, edge alignment) to the kind gate before publishing.

## Scaling Limits

**Single-recipient-array LLM call:**
- Current capacity: Effective only for small recipient lists (< ~20 recipients before prompt length and output token limits are reached).
- Limit: GPT context window and output token limit. Large campaigns will produce truncated or malformed JSON.
- Scaling path: Implement per-recipient iteration as documented in SKILL.md STEP 2, or chunk recipients and merge draft bundles.

## Dependencies at Risk

**`@cinatra-ai/auditor-agent` and `@cinatra-ai/reviewer-agent` pinned with `"*"` semver range:**
- Risk: `cinatra.dependencies[*].versionConstraint.range` is `"*"` for both runtime agent dependencies, meaning any published version is accepted. A breaking change in either dependency would be silently consumed.
- Files: `package.json`
- Impact: Runtime behavior of the auditor and reviewer sub-agents is unconstrained.
- Migration plan: Pin to a specific semver range (e.g., `"^0.1.0"`) matching the `cinatra.agentDependencies` entries that already use `"^0.1.0"` / `"^0.1.1"` — the two sections are currently inconsistent.

## Missing Critical Features

**No per-recipient personalization fields in OAS inputs:**
- Problem: The OAS accepts `confirmedRecipients` as `array<object>` with no schema for recipient fields. There are no `offeringCompanyWebsite`, `callToAction`, or `senderName` inputs, which SKILL.md considers required for quality drafts.
- Blocks: Generating drafts personalized beyond the recipient array itself (sender identity, offering context, CTA) without those fields being injected through some other mechanism not visible in the OAS.

**No error handling or partial-failure recovery in the draft flow:**
- Problem: The OAS flow has no conditional branches, retry edges, or error nodes. If the `draft` ApiNode call fails (LLM error, timeout, malformed JSON response), the flow terminates with no user-visible error and no way to retry.
- Blocks: Reliable operation in production; operators have no signal distinguishing a successful empty draft from a silent failure.

## Test Coverage Gaps

**No tests in this repo:**
- What's not tested: `extension-kind-gate.mjs` — `validateAgent`, `validateBpmnSanity`, `validateWorkflowPackageShape`, `parseArgs`, `findWorkflowSidecars`, `runGate`. The OAS structure and SKILL.md instructions are also untested.
- Files: `extension-kind-gate.mjs` (all exported functions)
- Risk: Regressions in the gate logic (e.g., the BPMN XML parser, banned-primitive regex patterns) go undetected until a false-positive or false-negative occurs in CI on a real extension repo.
- Priority: High — this file is the sole CI enforcement mechanism for all extracted agent/workflow repos.

---

*Concerns audit: 2026-06-09*
