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
//      mid-run hold: the run files each saved draft body as its own email body
//      (`file_drafts`) and waits at the gate while the host reviews each body,
//      in draft order, BEFORE anything downstream runs (cinatra-ai/cinatra#3089).
//      The gate is the host's review: it carries the marker
//      `metadata.cinatra.artifactReview.targetsInput` and draws no screen of
//      the pack's own. Nothing is edited in place any more, so no persist step
//      follows it. The gate, its marker, its target edge from the filing step
//      and the road through it are asserted here: a future cleanup that deletes
//      the gate "because core reviews artifacts now" would silently drop the
//      hold.
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
const READ_ID = "read_drafts";
const FILE_ID = "file_drafts";
const AFTER_ID = "drafting_summary";
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

const hasDataEdge = (from, out, to, into) =>
  dataEdges.some(
    (e) =>
      e.source_node?.$component_ref === from &&
      e.source_output === out &&
      e.destination_node?.$component_ref === to &&
      e.destination_input === into,
  );

test("B1: the mid-run operator gate still exists and still holds the run", () => {
  assert.ok(gate, `the "${GATE_ID}" node is missing — the mid-run hold is gone`);
  assert.equal(gate.component_type, "InputMessageNode");
  assert.equal(gateMeta.requiresApproval, true, "the gate no longer requires approval");
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

test("B2: the gate is the host's review of the filed bodies, with no screen of the pack's own", () => {
  const targetsInput = gateMeta.artifactReview?.targetsInput;
  assert.equal(targetsInput, "reviewTargets", "the gate does not carry the host review marker");
  assert.ok(
    (gate.inputs ?? []).some((i) => i.title === targetsInput && i.type === "string"),
    "the marker names no string input of the gate",
  );
  for (const key of ["renderer", "inputRenderers", "gateRenderer"]) {
    assert.equal(Object.hasOwn(gateMeta, key), false, `the gate still names a screen of its own (${key})`);
  }
  assert.ok(!JSON.stringify(gate).includes('"x-renderer"'), "the gate's schema still selects a renderer");
  assert.equal(oas.metadata?.cinatra?.hitlScreens, undefined, "the flow still declares a screen of its own");
  assert.equal(pkg.cinatra?.fieldRenderers, undefined, "the manifest still declares a renderer of its own");
});

test("B3: the gate holds the run between filing the bodies and everything after it", () => {
  assert.ok(
    hasControlEdge(DRAFT_ID, READ_ID) && hasControlEdge(READ_ID, FILE_ID) && hasControlEdge(FILE_ID, GATE_ID),
    `no control-flow road ${DRAFT_ID} → ${READ_ID} → ${FILE_ID} → ${GATE_ID} — the filed bodies no longer reach the hold`,
  );
  assert.ok(hasControlEdge(GATE_ID, AFTER_ID), `no control-flow edge ${GATE_ID} → ${AFTER_ID}`);
  // The hold must not be short-circuited by an edge that skips it.
  for (const from of [DRAFT_ID, READ_ID, FILE_ID]) {
    for (const to of [AFTER_ID, "end"]) {
      assert.ok(!hasControlEdge(from, to), `a ${from} → ${to} edge bypasses the operator gate`);
    }
  }
});

test("B4: the gate reviews exactly the bodies the filing step filed, and nothing is applied after it", () => {
  assert.ok(
    hasDataEdge(FILE_ID, "reviewTargets", GATE_ID, "reviewTargets"),
    "the filed bodies' review targets no longer flow into the gate",
  );
  assert.equal(refs.apply, undefined, "the retired apply step is still defined");
  assert.ok(!(oas.nodes ?? []).some((n) => n.$component_ref === "apply"), "the retired apply step is still listed");
  assert.ok(!oasText.includes("email_outreach_initial_drafts_update"), "the flow still edits the drafts in place");
});

test("B5: the declared production is filed by the list step, and the end hands its bodies on", () => {
  const declared = pkg.cinatra?.produces ?? [];
  assert.deepEqual(declared, [{ extension: "@cinatra-ai/email-artifacts", objectTypeId: "@cinatra-ai/email:body" }]);
  const input = refs[FILE_ID]?.data?.input ?? {};
  assert.equal(refs[FILE_ID]?.data?.tool, "artifact_materialize");
  assert.equal(input.extension, declared[0].extension);
  assert.equal(input.objectTypeId, declared[0].objectTypeId);
  // No end binding files one combined document any more.
  const bindings = (refs.end?.outputs ?? []).map((o) => o?.cinatra?.artifact).filter(Boolean);
  assert.deepEqual(bindings, []);
  assert.ok(
    hasDataEdge(FILE_ID, "artifacts", "end", "approvedBodyArtifacts"),
    "the filed bodies no longer reach the end",
  );
});
