// Bridge outputs declare their item members — cinatra-ai/email-drafting-agent#49.
//
// The runtime asks the model for exactly the shape a bridge node declares. An
// object level with no declared members is sent CLOSED and EMPTY (the strict
// structured-output contract has no open map), so an answer carries nothing
// inside it and the review gate surfaces unfielded entries.
//
// Issue #49 named one output of this pack measured that way on the pinned set:
// the `draft` node's `draftBundle`, declared `{"type":"object","json_schema":
// {"items":{"type":"object"}}}` — undeclared at `draftBundle` and at
// `draftBundle[]`. The node's own system prompt already spells the shape out,
// so the declaration this suite pins is that prompt's shape, member for member.
//
// The walk below mirrors the host loader's own derivation pass
// (`_declared_members` / `_declared_items` / `_declared_types` /
// `_strict_declared_subschema` / `_output_property_json_schema` in
// `docker/wayflow/agent_loader.py`): both agentspec spellings, the branch
// keywords, and the array-without-items case.
//
// Every assertion below fails on the declaration this pack shipped at
// b3261b1c829c7323ff7d6269647fe121c135dbd5 and passes here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));

const LLM_BRIDGE_PATH = "/api/llm-bridge";
const BRANCH_KEYWORDS = ["anyOf", "oneOf", "allOf"];

/** True when an ApiNode `url` addresses the host's LLM bridge. */
const targetsLlmBridge = (url) =>
  typeof url === "string" && url.endsWith(LLM_BRIDGE_PATH);

/** The member map a declaration carries, in EITHER agentspec spelling. */
function declaredMembers(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  let members = node.properties;
  if (!members || typeof members !== "object" || Array.isArray(members)) {
    const nested = node.json_schema;
    members =
      nested && typeof nested === "object" && !Array.isArray(nested)
        ? nested.properties
        : undefined;
  }
  if (!members || typeof members !== "object" || Array.isArray(members)) return null;
  // An EMPTY map is not a declaration of members.
  return Object.keys(members).length > 0 ? members : null;
}

/** The item declaration a declaration carries, in EITHER spelling. */
function declaredItems(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
  if (node.items !== undefined && node.items !== null) return node.items;
  const nested = node.json_schema;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested.items
    : undefined;
}

/** Every type a declaration names, in EITHER spelling. */
function declaredTypes(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  const declared = node.type;
  if (typeof declared === "string") return [declared];
  if (Array.isArray(declared)) return declared.filter((e) => typeof e === "string");
  return [];
}

/** Walk one declared subschema, collecting the levels the request cannot promise. */
function walkSubschema(node, path, freeForm) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const members = declaredMembers(node);
  if (members !== null) {
    for (const [name, member] of Object.entries(members))
      walkSubschema(member, `${path}.${name}`, freeForm);
  } else if (declaredTypes(node).includes("object")) {
    freeForm.push(path);
  }
  for (const keyword of BRANCH_KEYWORDS) {
    const branches = node[keyword];
    if (Array.isArray(branches))
      branches.forEach((branch, index) =>
        walkSubschema(branch, `${path}|${keyword}[${index}]`, freeForm),
      );
  }
  const items = declaredItems(node);
  if (Array.isArray(items)) {
    items.forEach((item, index) => walkSubschema(item, `${path}[${index}]`, freeForm));
  } else if (items !== undefined && items !== null) {
    walkSubschema(items, `${path}[]`, freeForm);
  } else if (declaredTypes(node).includes("array")) {
    freeForm.push(`${path}[]`);
  }
}

/** The free-form levels of ONE declared output property. */
function freeFormLevels(prop) {
  const freeForm = [];
  if (!prop || typeof prop !== "object") return freeForm;
  const { title, type } = prop;
  if (typeof title !== "string" || !title) return freeForm;
  if (typeof type !== "string" || !type) return freeForm;
  const members = declaredMembers(prop);
  if (members !== null) {
    for (const [name, member] of Object.entries(members))
      walkSubschema(member, `${title}.${name}`, freeForm);
  } else if (type === "object") {
    freeForm.push(title);
  }
  const items = declaredItems(prop);
  if (Array.isArray(items)) {
    items.forEach((item, index) => walkSubschema(item, `${title}[${index}]`, freeForm));
  } else if (items !== undefined && items !== null) {
    walkSubschema(items, `${title}[]`, freeForm);
  } else if (type === "array") {
    freeForm.push(`${title}[]`);
  }
  return freeForm;
}

/** Every ApiNode of this flow that addresses the LLM bridge, embedded copies included. */
function bridgeNodes(node, found = []) {
  if (Array.isArray(node)) {
    for (const value of node) bridgeNodes(value, found);
  } else if (node && typeof node === "object") {
    if (node.component_type === "ApiNode" && targetsLlmBridge(node.url)) found.push(node);
    for (const value of Object.values(node)) bridgeNodes(value, found);
  }
  return found;
}

const nodes = bridgeNodes(oas);
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const outputs = (id) => nodeById.get(id)?.outputs ?? [];
const output = (id, title) => outputs(id).find((o) => o?.title === title);

/** A shape is intentionally open only where its own description records that. */
const FREE_FORM_WORDS = [
  "free-form",
  "free form",
  "freeform",
  "arbitrary",
  "unstructured",
  "no fixed shape",
  "opaque",
];
const recordsIntent = (prop) =>
  typeof prop?.description === "string" &&
  FREE_FORM_WORDS.some((word) => prop.description.toLowerCase().includes(word));

/** The shape the `draft` node's own system prompt spells out for draftBundle. */
function promptShape() {
  const system = nodeById.get("draft")?.data?.system;
  assert.equal(typeof system, "string", "the draft node carries a system prompt");
  const line = system.match(/^- "draftBundle": (.+)$/m);
  assert.ok(line, "the prompt spells the draftBundle shape out on its own line");
  const spelled = line[1];
  const emailBlock = spelled.match(/\[\{(.*?)\}\]/);
  assert.ok(emailBlock, "the prompt spells the drafted-email item out");
  const keysOf = (text) => [...text.matchAll(/"([A-Za-z0-9_]+)":/g)].map((m) => m[1]);
  return {
    top: keysOf(spelled.replace(/\[\{.*?\}\]/, "[]")),
    email: keysOf(`{${emailBlock[1]}}`),
  };
}

test("no bridge output of this flow leaves a level without declared members", () => {
  assert.ok(nodes.length > 0, "the flow carries at least one bridge node");
  const open = [];
  for (const node of nodes)
    for (const prop of node.outputs ?? []) {
      const levels = freeFormLevels(prop);
      if (levels.length > 0 && !recordsIntent(prop))
        open.push(`${node.id} / ${prop.title}: ${levels.join(", ")}`);
    }
  assert.deepEqual(
    open,
    [],
    "every bridge output declares its members, or records in its own description that the shape is intentionally free-form",
  );
});

test("the draft node's draftBundle declares the members its consumers read", () => {
  // `draftBundle` was the free-form object of #49 (cinatra/oas.json:304 on the
  // pinned set): `json_schema.items = {"type":"object"}`, no members anywhere.
  const bundle = output("draft", "draftBundle");
  assert.ok(bundle, "the flow carries the draft bridge node's draftBundle output");
  assert.equal(bundle.type, "object");
  assert.equal(
    declaredItems(bundle),
    undefined,
    "an object output carries no `items` — the stray item declaration is gone",
  );
  const members = declaredMembers(bundle);
  assert.ok(members, "draftBundle declares its members");
  assert.deepEqual(Object.keys(members).sort(), ["draftedEmails", "summary"]);
  assert.equal(members.summary.type, "string");
  assert.equal(members.draftedEmails.type, "array");

  const item = declaredItems(members.draftedEmails);
  assert.ok(item, "the drafted-email list declares its item shape");
  const fields = declaredMembers(item);
  assert.ok(fields, "the drafted-email item declares its members");
  assert.deepEqual(Object.keys(fields).sort(), [
    "body",
    "recipientEmail",
    "recipientId",
    "recipientName",
    "subject",
  ]);
  for (const [name, field] of Object.entries(fields))
    assert.equal(field.type, "string", `${name} is declared a string`);
});

test("the declared members are the shape the node's own system prompt spells out", () => {
  const spelled = promptShape();
  const bundle = output("draft", "draftBundle");
  const members = declaredMembers(bundle);
  assert.deepEqual(Object.keys(members).sort(), [...spelled.top].sort());
  assert.deepEqual(
    Object.keys(declaredMembers(declaredItems(members.draftedEmails))).sort(),
    [...spelled.email].sort(),
  );
});

test("the scalar outputs alongside draftBundle stay declared scalars", () => {
  assert.equal(output("draft", "draftBundleTitle").type, "string");
  assert.equal(output("draft", "draftBundleDocument").type, "string");
  assert.deepEqual(freeFormLevels(output("draft", "draftBundleTitle")), []);
  assert.deepEqual(freeFormLevels(output("draft", "draftBundleDocument")), []);
});
