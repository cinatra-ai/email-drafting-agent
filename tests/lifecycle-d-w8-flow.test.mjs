// W8 (cinatra#3096) item 8 — the campaign id as optional plumbing, not a hidden requirement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra/oas.json"), "utf8"));
const start = oas.$referenced_components.start;

test("(8) nothing hidden is also demanded: every hidden input carries a default", () => {
  const hidden = start.metadata.cinatra.hidden ?? [];
  assert.ok(hidden.includes("campaignId"), "the campaign id stopped being plumbing");
  for (const title of hidden) {
    const field = start.inputs.find((i) => i.title === title);
    assert.notEqual(field.default, undefined, `the hidden input "${title}" has no default, so a dispatch is refused for it`);
    const flowLevel = oas.inputs.find((i) => i.title === title);
    assert.notEqual(flowLevel.default, undefined, `the flow input "${title}" has no default`);
  }
});

test("(8) the campaign id is not listed as required", () => {
  assert.ok(!(start.metadata.cinatra.required ?? []).includes("campaignId"));
});

// W8 (cinatra#3096) items 10 and 19, and the runtime loader's two mount rules.
//
// (10) The drafting review is the one pause this agent has, and it is declared:
// one input step carrying the approval flag, the flow naming its renderer, and
// the manifest claiming the gate.
//
// (19) A run that ends closes with a plain sentence - how many drafts were
// reviewed and saved, or that no email was drafted - never with the raw values
// the run hands on.
//
// The last two arms re-state the runtime loader's two mount rules over this
// flow, as cinatra-ai/email-outreach-agent holds them in its own suite: (A)
// every input a step requires has a source on every path that reaches it, and
// (B) an OutputMessageNode declares only inputs its template reads.

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const refs = oas.$referenced_components;
const nodesOfType = (type) => Object.values(refs).filter((n) => n.component_type === type);
const controlEdges = (oas.control_flow_connections ?? []).map((e) => ({
  from: e.from_node.$component_ref,
  to: e.to_node.$component_ref,
}));
const hasEdge = (from, to) => controlEdges.some((e) => e.from === from && e.to === to);
const dataEdges = (oas.data_flow_connections ?? []).map((e) => [
  e.source_node.$component_ref + "." + e.source_output,
  e.destination_node.$component_ref + "." + e.destination_input,
]);
const countDataEdges = (from, to) => dataEdges.filter(([f, t]) => f === from && t === to).length;
const outsideComment = (message) => String(message ?? "").replace(/\{#[\s\S]*?#\}/g, "");

test("(10) the drafting review is declared and exists", () => {
  const pauses = nodesOfType("InputMessageNode");
  assert.deepEqual(pauses.map((n) => n.id), ["approval_gate"]);
  assert.deepEqual(oas.metadata.cinatra.hitlScreens, [refs.approval_gate.metadata.cinatra.renderer]);
  assert.equal(refs.approval_gate.metadata?.cinatra?.requiresApproval, true, "the drafting review is not declared as a pause");
  assert.equal(pkg.cinatra.hasApprovalGates, true, "the manifest denies the pause its flow has");
});

test("(19) the run ends in plain language, never in the envelope", () => {
  const summary = refs.drafting_summary;
  assert.ok(summary, "the run has no closing statement");
  assert.equal(summary.component_type, "OutputMessageNode");
  assert.ok(oas.nodes.some((n) => n.$component_ref === "drafting_summary"), "the closing statement is not a step of the flow");
  assert.ok(hasEdge("apply", "drafting_summary"), "the run's last step does not pass the closing statement");
  assert.ok(hasEdge("drafting_summary", "end"), "the closing statement does not lead to the end");
  assert.ok(!hasEdge("apply", "end"), "the run still jumps straight to its end");
  assert.deepEqual(
    refs.end.outputs.map((o) => o.title),
    ["draftBundle", "draftBundleTitle", "draftBundleDocument", "userResponse"],
    "the end node no longer carries the values the run hands on",
  );
});

test("(19) an empty drafting run ends in plain language", () => {
  const summary = refs.drafting_summary;
  assert.ok(summary, "the run has no closing statement");
  const message = String(summary.message ?? "");
  assert.equal(
    message,
    "{# pyagentspec-input-hint (do not remove): {{ reviewedBundle }} #}" +
      "{% if not reviewedBundle or not reviewedBundle.draftedEmails %}No emails were drafted in this run: " +
      "there were no recipients to write to, or no draft could be written for them." +
      "{% else %}{{ reviewedBundle.draftedEmails | length }} email drafts were reviewed and saved.{% endif %}",
    "each outcome does not reach its own sentence: nothing drafted, drafts saved",
  );
  assert.match(message, /no emails were drafted/i, "an empty drafting run has no plain-language ending");
  assert.match(message, /reviewed and saved/i, "a run with drafts has no plain-language ending");
  assert.match(outsideComment(message), /\breviewedBundle\b/, "the sentence never reads the reviewed bundle");
  assert.equal(summary.metadata?.cinatra?.purpose, "plain-language-drafting-ending");
  assert.deepEqual(summary.inputs, [{ title: "reviewedBundle", type: "object", default: null }]);
  assert.equal(countDataEdges("apply.reviewedBundle", "drafting_summary.reviewedBundle"), 1);
});

/** The inputs a node CONSUMES: an EndNode names them under `outputs`, every
 *  other node declares `inputs`. */
function consumedInputs(node) {
  if (node.component_type === "EndNode") return node.outputs ?? [];
  return node.inputs ?? [];
}

/** Walk the flow the way the runtime loader does, returning each input it
 *  would demand from the StartStep. */
function unsourcedInputs() {
  const steps = new Map();
  for (const ref of oas.nodes ?? []) steps.set(ref.$component_ref, refs[ref.$component_ref]);
  const beginId = oas.start_node.$component_ref;
  const startTitles = new Set((steps.get(beginId)?.inputs ?? []).map((i) => i.title));
  const flowDataEdges = (oas.data_flow_connections ?? []).map((e) => ({
    from: e.source_node.$component_ref,
    key: `${e.destination_node.$component_ref}.${e.destination_input}`,
  }));
  const successors = (id) => controlEdges.filter((e) => e.from === id).map((e) => e.to);

  const violations = [];
  const visited = new Map();
  const queue = [[beginId, new Set()]];
  while (queue.length > 0) {
    const [id, incoming] = queue.pop();
    let produced = incoming;
    if (visited.has(id)) {
      const seen = visited.get(id);
      if ([...seen].every((k) => produced.has(k))) continue;
      produced = new Set([...produced].filter((k) => seen.has(k)));
    }
    visited.set(id, produced);

    const node = steps.get(id);
    if (!node) continue;
    if (id !== beginId) {
      for (const descriptor of consumedInputs(node)) {
        const key = `${id}.${descriptor.title}`;
        if (produced.has(key)) continue;
        if (Object.hasOwn(descriptor, "default")) continue;
        if (startTitles.has(descriptor.title)) continue;
        violations.push(key);
      }
    }

    const next = new Set(produced);
    for (const edge of flowDataEdges) if (edge.from === id) next.add(edge.key);
    for (const child of successors(id)) queue.push([child, new Set(next)]);
  }
  return violations;
}

test("every required step input has a source on every path that reaches it", () => {
  const found = unsourcedInputs();
  assert.deepEqual(
    found,
    [],
    "the runtime refuses to mount a flow whose step requires an input the StartStep does not carry: " + found.join(", "),
  );
});

test("an output message declares only inputs its template reads", () => {
  const offenders = [];
  for (const node of nodesOfType("OutputMessageNode")) {
    const rendered = outsideComment(node.message);
    for (const { title } of node.inputs ?? []) {
      if (!new RegExp(`\\b${title}\\b`).test(rendered)) offenders.push(`${node.id}.${title}`);
    }
  }
  assert.deepEqual(offenders, [], "the runtime rejects an input the template never reads: " + offenders.join(", "));
});
