# Coding Conventions

**Analysis Date:** 2026-06-09

## Repository Type

This is a content-only Cinatra agent extension. The primary logic is declared in `skills/email-drafting/SKILL.md` (a structured prompt/behavior specification), and the CI gate is implemented in `extension-kind-gate.mjs`. There is no `src/` directory and no application TypeScript source — the repo is a source mirror for the Cinatra monorepo.

## Naming Patterns

**Files:**
- Gate scripts use camelCase with `.mjs` extension: `extension-kind-gate.mjs`
- Cinatra artifacts use kebab-case directory names: `skills/email-drafting/`
- Skill definitions use `SKILL.md` (uppercase filename) in their skill subdirectory

**Functions:**
- camelCase: `parseArgs`, `validateAgent`, `validateWorkflow`, `runGate`, `walkLlmStrings`, `scanOasString`, `findWorkflowSidecars`, `validateBpmnSanity`, `validateWorkflowPackageShape`
- Verb-first naming: `validate*`, `find*`, `scan*`, `walk*`, `run*`

**Variables:**
- camelCase for local variables and parameters: `packageRoot`, `oasPath`, `bpmnPath`, `openTags`
- UPPER_SNAKE_CASE for module-level constants: `LLM_VISIBLE_FIELDS`, `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, `BPMN_MODEL_NS`, `WORKFLOW_PACKAGE_NAME_RE`

**Types:**
- No custom TypeScript types declared (the gate is plain `.mjs`, not `.ts`)
- TypeScript config (`tsconfig.json`) is present but targets a `src/` directory that does not exist — it is a scaffold for future TypeScript sources

## Code Style

**Formatting:**
- No Prettier or ESLint config file detected in the repo root
- Code uses 2-space indentation consistently in `extension-kind-gate.mjs`
- Single-quoted strings preferred in inline Node.js snippets in CI YAML
- Double-quoted strings used in the main `.mjs` file

**Linting:**
- No `.eslintrc*` or `biome.json` detected
- Formatting rules are enforced upstream in the Cinatra monorepo, not in this extracted repo

## Module System

- `"type": "module"` in `package.json` — ES module format throughout
- `extension-kind-gate.mjs` uses named ES module imports: `import { readFileSync, existsSync, readdirSync } from "node:fs"`
- `node:` prefix on all built-in imports: `node:fs`, `node:path`
- Functions are exported as named exports for testability: `export function validateAgent(...)`, `export function runGate(...)`
- Entry point guard pattern used: checks `invokedDirectly` before calling `main()`

## Import Organization

**Order (in `extension-kind-gate.mjs`):**
1. Node built-ins with `node:` prefix (`node:fs`, `node:path`)
2. No third-party or internal imports (zero-dependency by design)

**Path Aliases:**
- Not applicable — zero-dependency module, no aliases

## Error Handling

**Pattern:** Pure functions return `string[]` error arrays; callers accumulate and display.
- `validateAgent(packageRoot)` returns `string[]`
- `validateWorkflow(packageRoot)` returns `string[]`
- `runGate(packageRoot)` returns `{ kind, errors }`
- `main()` collects errors and calls `process.exit(1)` if any exist
- All file I/O wrapped in `try/catch` with descriptive messages: `errors.push(\`could not read package.json: ${err.message}\`)`
- Early returns used when an error makes further checks meaningless (e.g., parse failure aborts OAS scan)

## Logging

**Framework:** `console.log` / `console.error` (no logging library)

**Patterns:**
- Success: `console.log("✓ extension-kind-gate: ...")` to stdout
- Errors: `console.error("✗ extension-kind-gate: ...")` to stderr with bullet-point list

## Comments

**When to Comment:**
- File-level block comments explain purpose, scope, usage, and exit codes (see top of `extension-kind-gate.mjs`)
- Section dividers use `// ----------` with descriptive section names
- Inline comments explain non-obvious decisions (e.g., why `npx` is used instead of `pnpm dlx`)
- CI YAML steps have detailed comments explaining the skip/run logic and rationale

**JSDoc:**
- JSDoc-style block comments used on exported functions, describing purpose, purity, and return contract
- Example: `/** Validate an agent extension at packageRoot. Pure: returns string[] errors. */`

## Function Design

**Size:** Functions are small and single-purpose. Each validation concern is its own function.

**Parameters:** Prefer simple scalar inputs (`packageRoot: string`, `xml: string`). Functions that need parsed data receive parsed data (not paths), enabling unit testing without file I/O.

**Return Values:** Pure functions return data (arrays or objects). Side effects (file reads, console output) are isolated to `main()` and I/O wrapper functions.

## Skill/Prompt Conventions (SKILL.md)

**Format:** YAML front matter (`name`, `description`) followed by structured Markdown sections.

**Step structure:** Numbered `STEP N —` headings with explicit tool calls and JSON examples.

**Constraints expressed as negatives:** "Do NOT include", "never quote verbatim", "never paste verbatim" — rules are stated explicitly.

**Output contract:** Final step always specifies exact JSON output shape.

## CI Conventions

**Repo classification:** CI inline Node.js script classifies the repo as "source mirror" (has `@cinatra-ai/*` optional peers) vs. "standalone" before deciding whether to install/typecheck/test.

**Gate script:** `extension-kind-gate.mjs` is the canonical kind-specific validation gate; it must remain zero-dependency and self-contained.

**Package shape rules:**
- First-party packages (`@cinatra-ai/*`, `@cinatra/*`) must only appear as `peerDependencies` marked `peerDependenciesMeta[pkg].optional: true`
- No first-party packages in `dependencies`, `devDependencies`, or `optionalDependencies`

---

*Convention analysis: 2026-06-09*
