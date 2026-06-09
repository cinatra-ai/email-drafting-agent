# Testing Patterns

**Analysis Date:** 2026-06-09

## Repository Context

This is a content-only Cinatra agent extension (source mirror). It has no `src/` TypeScript sources and no local test files. Tests for this repo's logic run inside the Cinatra monorepo — the CI workflow explicitly skips standalone testing for source mirrors:

```yaml
# from .github/workflows/ci.yml
- name: Test
  run: |
    if [ "$first_party" = "1" ]; then
      echo "Skipping standalone tests (host-internal @cinatra-ai/* peers — the cinatra monorepo runs these)."
      exit 0
    fi
    corepack pnpm test --if-present
```

## Test Framework

**Runner:** Not applicable — no local test runner configured.

**Assertion Library:** Not applicable.

**Run Commands:**
```bash
# Standalone gate validation (the only locally runnable check):
node extension-kind-gate.mjs --package-root .

# In CI (via GitHub Actions):
# - Full test suite runs in the Cinatra monorepo, not here
# - `corepack pnpm test --if-present` is the contract for standalone repos
```

## What IS Tested Locally (Gate Script)

The only locally executable validation is `extension-kind-gate.mjs`, which runs as a CI job step. It validates:

1. **Agent OAS scan** — `cinatra/oas.json` parses as valid JSON and contains no retired CRM primitives in LLM-visible fields (`system`, `user`, `description`)
2. **Retired primitive patterns** — checks against `BANNED_PRIMITIVES` list (e.g., `contacts_list`, `accounts_get`) and `BANNED_TYPEHINTS`
3. **Workflow shape** (not applicable here — this repo is `kind: "agent"`, not `kind: "workflow"`)

The gate functions are **pure and exported**, meaning they are designed for unit testing in the monorepo:
- `extension-kind-gate.mjs` exports: `parseArgs`, `validateAgent`, `validateWorkflowPackageShape`, `validateBpmnSanity`, `findWorkflowSidecars`, `validateWorkflow`, `runGate`

## Test File Organization

**Location:** No test files exist in this repo.

**Naming:** Not applicable.

**Structure:** Not applicable — all tests live in the Cinatra monorepo alongside the extraction tooling that generates this repo.

## Mocking

**Framework:** Not applicable locally.

**Approach in monorepo tests (inferred from gate design):**
- Gate functions are pure (accept strings/paths, return `string[]`) — they can be tested without mocking file I/O by passing synthetic inputs directly
- `validateBpmnSanity(xml: string)` and `validateWorkflowPackageShape(pkg: object)` take pre-parsed data, so no `fs` mocking is needed for those

## Fixtures and Factories

**Test Data:** Not applicable locally.

**Pattern inferred from gate exports:**
- `validateAgent(packageRoot)` would be tested by creating temp directories with synthetic `cinatra/oas.json` fixtures
- `validateBpmnSanity(xml)` would be tested with inline XML strings (pure function)

## Coverage

**Requirements:** Not enforced in this repo.

**View Coverage:** Not applicable.

## Test Types

**Unit Tests:** Not present locally. Gate functions are designed for unit testing in the monorepo (pure functions, named exports).

**Integration Tests:** CI serves as the integration gate — `node extension-kind-gate.mjs --package-root .` runs against the actual repo artifacts on every push/PR.

**E2E Tests:** Not applicable.

## CI Gate as Functional Test

The `.github/workflows/ci.yml` `kind-gates` job is the functional equivalent of a test suite for this repo's content:

```yaml
- name: Agent OAS validation gate
  run: node extension-kind-gate.mjs --package-root .
```

This validates `cinatra/oas.json` for:
- JSON parse validity
- Absence of retired CRM primitives in LLM-visible prompt strings
- Absence of banned typeHints (`@cinatra-ai/entity-accounts:account`, `@cinatra-ai/entity-contacts:contact`)

Exit code 0 = pass, exit code 1 = violations found.

## Adding Tests

If TypeScript sources are added to `src/`:
- Add a `test` script to `package.json`
- The CI will automatically run `corepack pnpm test --if-present` for standalone repos (those without `@cinatra-ai/*` peers)
- Gate functions in `extension-kind-gate.mjs` can be imported directly in test files since they are named ES module exports

---

*Testing analysis: 2026-06-09*
