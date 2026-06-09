<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌──────────────────────────────────────────────────────────────┐
│                  Cinatra Platform Orchestrator                │
│         (external caller — wires inputs via campaign flow)   │
└────────────────────────────┬─────────────────────────────────┘
                             │ campaignId, confirmedRecipients,
                             │ agent_run_id
                             ▼
┌──────────────────────────────────────────────────────────────┐
│              Email Drafting Flow  (cinatra/oas.json)          │
│                                                              │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────────┐   │
│  │  start   │──▶│    draft     │──▶│  approval_gate    │   │
│  │ StartNode│   │  ApiNode     │   │ InputMessageNode  │   │
│  │          │   │ /llm-bridge  │   │ (HITL review)     │   │
│  └──────────┘   └──────┬───────┘   └────────┬──────────┘   │
│                        │                    │               │
│                        ▼                    ▼               │
│                  ┌──────────────────────────────────┐       │
│                  │            end  EndNode           │       │
│                  │  draftBundle + userResponse       │       │
│                  └──────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│       CINATRA_BASE_URL /api/llm-bridge  (OpenAI gpt-5.5)     │
│       MCP tools: objects_get, objects_save                   │
└──────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `start` (StartNode) | Receives and validates flow inputs (`campaignId`, `confirmedRecipients`, `agent_run_id`) | `cinatra/oas.json` → `$referenced_components.start` |
| `draft` (ApiNode) | Calls `/api/llm-bridge` to generate personalized email drafts via LLM (gpt-5.5) | `cinatra/oas.json` → `$referenced_components.draft` |
| `approval_gate` (InputMessageNode) | Pauses flow for human-in-the-loop (HITL) review; renders via `@cinatra-ai/reviewer-agent:drafts-output` | `cinatra/oas.json` → `$referenced_components.approval_gate` |
| `end` (EndNode) | Emits `draftBundle` object and `userResponse` string to the orchestrator | `cinatra/oas.json` → `$referenced_components.end` |
| SKILL.md agent | Declarative LLM prompt instructions for step-by-step MCP-based draft generation | `skills/email-drafting/SKILL.md` |
| extension-kind-gate | CI self-contained validator: scans `cinatra/oas.json` for retired CRM primitives | `extension-kind-gate.mjs` |

## Pattern Overview

**Overall:** Cinatra OAS Flow — a declarative directed graph of typed nodes (Start → ApiNode → InputMessageNode → End) with explicit ControlFlowEdges and DataFlowEdges. The LLM agent logic is expressed as a prompt in the `draft` ApiNode; no imperative code drives the email generation at runtime.

**Key Characteristics:**
- All node wiring (control flow + data flow) is declared in `cinatra/oas.json` — no runtime routing code exists in this repo.
- The agent skill (`skills/email-drafting/SKILL.md`) provides the extended LLM instructions and MCP tool usage (`objects_get`, `objects_save`) for the full multi-step variant.
- Human-in-the-loop approval is mandatory before the flow terminates: the `approval_gate` node has `requiresApproval: true`.
- The repo ships no TypeScript source files (`src/` is declared in `tsconfig.json` but is empty/absent); all logic is declarative JSON + Markdown.

## Layers

**Flow Definition Layer:**
- Purpose: Declarative specification of the agent's runtime behavior — nodes, edges, inputs, outputs, LLM prompt, and HITL gate.
- Location: `cinatra/oas.json`
- Contains: StartNode, ApiNode, InputMessageNode, EndNode, ControlFlowEdges, DataFlowEdges.
- Depends on: Cinatra Platform runtime (`CINATRA_BASE_URL`), OpenAI (`gpt-5.5`).
- Used by: Cinatra marketplace / orchestrator at runtime.

**Agent Skill Layer:**
- Purpose: Declarative prompt instructions describing the four-step MCP-based draft generation process.
- Location: `skills/email-drafting/SKILL.md`
- Contains: Step-by-step instructions for `objects_get`, per-recipient personalisation, `objects_save`, and output format.
- Depends on: MCP tools `objects_get` and `objects_save` injected by the runtime.
- Used by: The LLM at inference time (mounted as a skill).

**CI Gate Layer:**
- Purpose: Zero-dependency pre-publish sanity validation — scans OAS for retired CRM primitives and validates package shape.
- Location: `extension-kind-gate.mjs`
- Contains: `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`.
- Depends on: Node.js builtins only (`fs`, `path`).
- Used by: `.github/workflows/ci.yml` (`kind-gates` job).

## Data Flow

### Primary Request Path

1. **Orchestrator injects inputs** — `campaignId` (UUID), `confirmedRecipients` (array), `agent_run_id` → `start` node (`cinatra/oas.json` `$referenced_components.start`)
2. **DataFlowEdges propagate inputs** → `draft` ApiNode (`cinatra/oas.json` `data_flow_connections`)
3. **`draft` ApiNode POST** → `CINATRA_BASE_URL/api/llm-bridge` with system + user prompts and `agent_id: "email-drafting"` (`cinatra/oas.json` `$referenced_components.draft`)
4. **LLM responds** with `{ draftedEmails: [...], summary: "..." }` → `draftBundle` output of `draft` node
5. **`draftBundle` DataFlowEdge** → `end` node (`cinatra/oas.json` `data_flow_connections` `draft_to_end_draftBundle`)
6. **`approval_gate` InputMessageNode** receives control flow from `draft`; renders HITL review screen via `@cinatra-ai/reviewer-agent:drafts-output`
7. **User approves / responds** → `userResponse` string → `end` node
8. **`end` node emits** `draftBundle` + `userResponse` to calling orchestrator

### MCP-Based Skill Path (skill variant)

1. LLM receives mounted `skills/email-drafting/SKILL.md` instructions
2. Calls `objects_get` with `confirmedRecipientsRef` to fetch recipients bundle
3. Generates one email per recipient using campaign context fields
4. Calls `objects_save` with `typeHint: "@cinatra-ai/campaigns:email-draft-bundle"` and `rawData.drafts`
5. Returns `{ draftBundleRef: "<uuid>", summary: "..." }` for orchestrator wiring via DataFlowEdge

**State Management:**
- No local state. All persistence is via MCP `objects_save` / `objects_get` (external object store). Flow state is owned by the Cinatra platform runtime.

## Key Abstractions

**OAS Flow (cinatra/oas.json):**
- Purpose: Machine-readable agent flow definition consumed by the Cinatra marketplace and runtime.
- Examples: `cinatra/oas.json`
- Pattern: `agentspec_version: "26.1.0"`, `component_type: "Flow"`, nodes + edges as `$referenced_components`.

**SKILL.md:**
- Purpose: Declarative LLM prompt instructions, mounted at inference time as a skill.
- Examples: `skills/email-drafting/SKILL.md`
- Pattern: YAML front matter (`name`, `description`) + Markdown sections (Inputs, Steps, Draft quality standards, MCP tools).

**Agent dependency declaration:**
- Purpose: Declares runtime agent dependencies (`@cinatra-ai/auditor-agent`, `@cinatra-ai/reviewer-agent`) so the orchestrator can resolve them.
- Examples: `package.json` → `cinatra.dependencies` array
- Pattern: `{ packageName, edgeType: "runtime", versionConstraint, requirement, kind }`.

## Entry Points

**Flow Entry:**
- Location: `cinatra/oas.json` → `start_node: { $component_ref: "start" }`
- Triggers: Cinatra orchestrator invokes the flow with `campaignId` + `confirmedRecipients`.
- Responsibilities: Validates required inputs (`campaignId` required, others hidden/injected).

**CI Gate Entry:**
- Location: `extension-kind-gate.mjs` → `main()` (invoked when `process.argv[1]` matches the script path)
- Triggers: `node extension-kind-gate.mjs --package-root .` in `.github/workflows/ci.yml`
- Responsibilities: Reads `package.json`, dispatches to `validateAgent` or `validateWorkflow`, exits 0/1.

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop (CI gate only; runtime flow execution is managed by the Cinatra platform).
- **Global state:** None. The CI gate is purely functional (reads files, returns error arrays).
- **Circular imports:** None — `extension-kind-gate.mjs` imports only Node builtins.
- **No standalone install:** This repo declares `@cinatra-ai/auditor-agent` and `@cinatra-ai/reviewer-agent` as runtime agent dependencies (not npm peerDependencies). CI skips `pnpm install` because first-party `@cinatra-ai/*` packages resolve only in the monorepo.
- **No TypeScript sources:** `tsconfig.json` declares `rootDir: "src"` but no `src/` exists. CI detects this as a content-only extension and skips typechecking.

## Anti-Patterns

### Direct use of retired CRM primitives in OAS prompt strings

**What happens:** Adding `contacts_list`, `accounts_get`, or similar retired tool names to the `system` or `user` fields of an ApiNode.
**Why it's wrong:** The `extension-kind-gate.mjs` `BANNED_PRIMITIVES` list will fail CI; these primitives are retired in favour of the `crm_*` facade.
**Do this instead:** Use `crm_account_search` / `crm_contact_search`, or route through `objects_get`/`objects_save` with the appropriate type hint (as shown in `skills/email-drafting/SKILL.md`).

### Inline workflow definition in package.json

**What happens:** Placing flow definition JSON inside `package.json` under `cinatra.workflow`.
**Why it's wrong:** `validateWorkflowPackageShape` in `extension-kind-gate.mjs` (line 174) explicitly rejects this pattern.
**Do this instead:** Ship the flow as a `cinatra/oas.json` (agent) or `cinatra/workflow.bpmn` (workflow) sidecar.

## Error Handling

**Strategy:** The CI gate uses a pure functional pattern — all validators return `string[]` error arrays; no exceptions escape. The `main()` function prints errors and calls `process.exit(1)`.

**Patterns:**
- `validateAgent`, `validateWorkflow`, `validateBpmnSanity` all return early with a populated error array on first fatal parse failure.
- `walkLlmStrings` is defensive — skips null/non-object nodes silently.
- Runtime flow errors are handled by the Cinatra platform (not in this repo).

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` in `extension-kind-gate.mjs` only; no structured logging.
**Validation:** All validation is static (pre-publish CI) via `extension-kind-gate.mjs`. Runtime input validation is owned by the Cinatra platform.
**Authentication:** Not applicable to this repo. The `draft` ApiNode uses `CINATRA_BASE_URL` (platform-injected); no auth tokens are stored here.

---

*Architecture analysis: 2026-06-09*
