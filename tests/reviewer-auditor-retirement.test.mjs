// ---------------------------------------------------------------------------
// Reviewer/auditor retirement + hold-preservation lock for this flow.
//
//     node --test tests/
//
// This flow migrated OFF the retired @cinatra-ai/reviewer-agent and
// @cinatra-ai/auditor-agent onto CORE artifact-lifecycle interception
// (cinatra#2047 row 8 / cinatra#1796). Two things have to stay true together,
// and each half is a separate failure mode:
//
//   A. RETIREMENT — no reference to either retired agent survives anywhere in
//      the shipped manifest or flow definition (exact-identity, the same grep
//      shape the core acceptance row runs), and no reviewer-namespaced gate id
//      lingers as dead metadata.
//
//   B. HOLD PRESERVED — removing the pins must NOT quietly remove the user's
//      control point. The flow's own `approval_gate` InputMessageNode is the
//      mid-run hold: the operator reads the generated drafts, edits them, and
//      approves or rejects BEFORE the reviewed drafts are applied. (The `draft`
//      node deliberately persists a PRE-GATE bundle record first, so the gate
//      has something re-entrant to load and update — the operator's decision
//      still governs everything downstream of it.) Its answer is also
//      load-bearing beyond the pause — the downstream persist primitive
//      (`email_outreach_initial_drafts_update`) is a run-scoped PERSIST tool
//      that fails closed without answered-gate provenance minted at that
//      operator answer, and the operator's edits travel to it as the gate's
//      `userResponse` → `resumePayload`. So the gate, its renderer, its
//      hitlScreens entry, and its data edge into the persist node are all
//      asserted here: a future cleanup that deletes the gate "because core
//      reviews artifacts now" would silently drop both the hold and the edits.
//
// Zero-dependency by design (Node builtins only), mirroring
// `extension-kind-gate.mjs`: this repo's CI runs unauthenticated, before the
// @cinatra-ai registry is reachable.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = join(ROOT, "package.json");
const OAS_PATH = join(ROOT, "cinatra", "oas.json");
const README_PATH = join(ROOT, "README.md");

const pkgText = readFileSync(PKG_PATH, "utf8");
const oasText = readFileSync(OAS_PATH, "utf8");
const pkg = JSON.parse(pkgText);
const oas = JSON.parse(oasText);

/** The retired agents, by EXACT package identity (substring lookalikes such as
 * `code-reviewer-agent` are excluded by the leading scope). */
const RETIRED_AGENTS = ["@cinatra-ai/reviewer-agent", "@cinatra-ai/auditor-agent"];

/** Everything `npm pack` ships to a user: the `files` entry (`cinatra/`) plus
 * the README npm always includes. Stale install/troubleshooting prose naming a
 * retired agent is a user-visible defect, not a cosmetic one — and the agent's
 * own instructions now live INSIDE `cinatra/oas.json` (the skill bundle was
 * folded into the `draft` node's system prompt), so the OAS scan covers them. */
const PUBLISHED_TEXT_FILES = [PKG_PATH, OAS_PATH, README_PATH];

const GATE_ID = "approval_gate";
const DRAFT_ID = "draft";
const PERSIST_ID = "apply";
const refs = oas.$referenced_components ?? {};
const gate = refs[GATE_ID];
const gateMeta = gate?.metadata?.cinatra ?? {};
const controlEdges = oas.control_flow_connections ?? [];
const dataEdges = oas.data_flow_connections ?? [];

const hasControlEdge = (from, to) =>
  controlEdges.some((e) => e.from_node?.$component_ref === from && e.to_node?.$component_ref === to);

// ---------------------------------------------------------------------------
// A. Retirement
// ---------------------------------------------------------------------------

test("A1: no PUBLISHED file names a retired agent (manifest, flow, README)", () => {
  for (const file of PUBLISHED_TEXT_FILES) {
    const text = readFileSync(file, "utf8");
    for (const name of RETIRED_AGENTS) {
      assert.ok(!text.includes(name), `${file} still references ${name}`);
    }
  }
});

test("A2: the README no longer tells a user to install or debug a retired agent", () => {
  const readme = readFileSync(README_PATH, "utf8");
  assert.ok(
    !/(auditor|reviewer)[- ]agent/i.test(readme),
    "README.md still names a reviewer/auditor agent in its install or troubleshooting guidance",
  );
});

test("A3: no declared dependency edge on a retired agent", () => {
  const declared = (pkg.cinatra?.dependencies ?? []).map((d) => d.packageName);
  for (const name of RETIRED_AGENTS) {
    assert.ok(!declared.includes(name), `cinatra.dependencies still requires ${name}`);
  }
  // The legacy sub-agent map is gone with its last entry — an empty map would
  // still be read by the orchestrator readiness gate, so it must be ABSENT.
  assert.equal(
    pkg.cinatra?.agentDependencies,
    undefined,
    "cinatra.agentDependencies must be absent — this flow invokes no sub-agent",
  );
  // Retired agents must not reappear through an npm dependency edge either.
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of RETIRED_AGENTS) {
      assert.ok(!(pkg[field] ?? {})[name], `package.json ${field} still requires ${name}`);
    }
  }
});

test("A4: no reviewer/auditor-namespaced gate id survives as dead metadata", () => {
  // `a2uiSurfaceId` is inert on an InputMessageNode gate (the compiler never
  // copies it onto the compiled step, so it can never be the resolution key) —
  // which is exactly why a stale reviewer value could rot here unnoticed. The
  // pattern covers BOTH spellings that existed: the bare `reviewer:` surface
  // namespace and a fully-qualified retired-package gate id.
  const STALE_NS = /(^reviewer[:@])|reviewer-agent|auditor-agent/i;
  for (const [id, node] of Object.entries(refs)) {
    const surface = node?.metadata?.cinatra?.a2uiSurfaceId;
    assert.ok(
      surface === undefined || !STALE_NS.test(surface),
      `node "${id}" still pins the retired surface id "${surface}"`,
    );
  }
  for (const screen of oas.metadata?.cinatra?.hitlScreens ?? []) {
    assert.ok(
      !STALE_NS.test(screen),
      `metadata.cinatra.hitlScreens still pins the retired screen "${screen}"`,
    );
  }
});

test("A5: no embedded reviewer/auditor invocation node or branch remains", () => {
  for (const [id, node] of Object.entries(refs)) {
    assert.ok(
      !/reviewer|auditor/i.test(id),
      `referenced component "${id}" looks like an embedded reviewer/auditor step`,
    );
    assert.ok(
      !/reviewer|auditor/i.test(String(node?.template ?? "")),
      `node "${id}" templates a reviewer/auditor child flow`,
    );
  }
  for (const edge of controlEdges) {
    const target = edge?.to_node?.$component_ref ?? "";
    assert.ok(
      !/reviewer|auditor/i.test(target),
      `control-flow edge "${edge?.name}" targets "${target}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// B. Hold preserved — the user keeps the same approve/reject opportunity
// ---------------------------------------------------------------------------

test("B1: the mid-run operator gate still exists and still holds the run", () => {
  assert.ok(gate, `the "${GATE_ID}" node is missing — the mid-run hold is gone`);
  assert.equal(gate.component_type, "InputMessageNode");
  assert.equal(gateMeta.requiresApproval, true, "the gate no longer requires approval");
  assert.equal(gateMeta.riskClass, "approval");
  // A node the flow does not LIST is never executed, however well-formed it is.
  assert.ok(
    (oas.nodes ?? []).some((n) => n.$component_ref === GATE_ID),
    `"${GATE_ID}" is defined but no longer listed in the flow's nodes`,
  );
  assert.equal(
    pkg.cinatra?.hasApprovalGates,
    true,
    "the manifest must keep declaring that this flow carries an approval gate",
  );
});

test("B2: the gate renders through this pack's own renderer, declared as a HITL screen", () => {
  const renderer = gateMeta.renderer;
  assert.equal(typeof renderer, "string");
  assert.ok(renderer.startsWith(`${pkg.name}:`), `gate renderer "${renderer}" is not pack-namespaced`);
  // The gate's own `renderer` is the resolution key; `hitlScreens` is the
  // flow-level declaration the host and MCP discovery read to classify this
  // pause as a HITL screen. They must name the same id or the flow advertises a
  // screen it does not render.
  assert.ok(
    (oas.metadata?.cinatra?.hitlScreens ?? []).includes(renderer),
    `metadata.cinatra.hitlScreens must list the gate renderer "${renderer}"`,
  );
  // The renderer needs the gate's INPUTS surfaced to it, or the operator gets a
  // decision prompt with no drafts to read or edit.
  assert.equal(gateMeta.surfaceGateInputs, true, "the gate no longer surfaces its inputs to the renderer");
});

test("B3: the gate still holds the run between drafting and the persist step", () => {
  assert.ok(
    hasControlEdge(DRAFT_ID, GATE_ID),
    `no control-flow edge ${DRAFT_ID} → ${GATE_ID} — the drafts no longer reach the hold`,
  );
  assert.ok(
    hasControlEdge(GATE_ID, PERSIST_ID),
    `no control-flow edge ${GATE_ID} → ${PERSIST_ID} — the hold no longer precedes the persist`,
  );
  // The hold must not be short-circuited by an edge that skips it.
  assert.ok(
    !hasControlEdge(DRAFT_ID, PERSIST_ID),
    `a ${DRAFT_ID} → ${PERSIST_ID} edge bypasses the operator gate`,
  );
});

test("B4: the operator reads the drafts, and their decision + edits reach the persist step", () => {
  // Match on the FULL (node, port) tuple, so an added parallel edge between the
  // same two nodes can never make this read the wrong edge and fail spuriously.
  const hasDataEdge = (from, out, to, into) =>
    dataEdges.some(
      (e) =>
        e.source_node?.$component_ref === from &&
        e.source_output === out &&
        e.destination_node?.$component_ref === to &&
        e.destination_input === into,
    );

  // Inbound: the generated bundle is what the operator is shown.
  assert.ok(
    hasDataEdge(DRAFT_ID, "draftBundle", GATE_ID, "draftBundle"),
    "the generated drafts no longer flow into the gate",
  );

  // Outbound: the operator's answer (decision + per-recipient edits) is what the
  // persist step applies.
  assert.ok(
    hasDataEdge(GATE_ID, "userResponse", PERSIST_ID, "resumePayload"),
    "the gate's answer no longer feeds the persist node as its resume payload",
  );

  // The persist primitive is answered-gate-provenance bound: it consumes the
  // resume payload of the very gate answer that authorized it.
  const persist = refs[PERSIST_ID];
  assert.equal(persist?.data?.tool, "email_outreach_initial_drafts_update");
  assert.equal(persist?.data?.input?.resumePayloadJson, "{{ resumePayload }}");
});

test("B5: the produced artifact binding core reviews on is intact", () => {
  // Core interception opens the run-embedded review gate off the durable
  // artifact this flow materializes — the declarative EndNode binding is what
  // routes the write through the enumerated `createSemanticArtifact` emitter.
  const declared = pkg.cinatra?.produces ?? [];
  assert.ok(declared.length > 0, "cinatra.produces declares no artifact production");
  const bindings = (refs.end?.outputs ?? [])
    .map((o) => o?.cinatra?.artifact)
    .filter(Boolean);
  for (const { extension, objectTypeId } of declared) {
    assert.ok(
      bindings.some((b) => b.extension === extension && b.objectTypeId === objectTypeId),
      `no EndNode artifact binding materializes the declared production ${extension} / ${objectTypeId}`,
    );
  }
  // The reviewed content — not the pre-gate draft — is what gets materialized.
  const bound = bindings.find((b) => b.extension === "@cinatra-ai/email-artifacts");
  assert.ok(bound, "the email-artifacts binding is missing");
  assert.equal(bound.contentFrom, "draftBundleDocument");
  assert.ok(
    dataEdges.some(
      (e) =>
        e.source_node?.$component_ref === PERSIST_ID &&
        e.destination_node?.$component_ref === "end" &&
        e.destination_input === bound.contentFrom,
    ),
    `the materialized "${bound.contentFrom}" no longer comes from the reviewed output of "${PERSIST_ID}"`,
  );
});
