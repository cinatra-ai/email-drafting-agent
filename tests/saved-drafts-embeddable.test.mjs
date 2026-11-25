// cinatra#3089 / cinatra#4154 part C: the drafting agent's own consent that an
// agent embedding its flow (the Email Outreach Agent) may run `saved_drafts`
// from this package at its embedded copy of the read step.
//
// The host reads `cinatra.tools[].embeddable` as an OWN data property of the
// tool entry, and only the JSON boolean `true` is consent. A missing key or an
// own `false` means not embeddable (the entry is accepted, the embedded call is
// refused as not embeddable); inherited values are ignored; only an own
// non-boolean value invalidates the declaration list. So this asserts the
// shipped manifest declares exactly that, on exactly that one tool, and that
// the flow's tool calls name that tool and no other tool of this package.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const flow = JSON.parse(readFileSync(join(root, "cinatra/oas.json"), "utf8"));
const tools = pkg.cinatra?.tools ?? [];

const calledToolNames = (node, found = []) => {
  if (Array.isArray(node)) node.forEach((n) => calledToolNames(n, found));
  else if (node && typeof node === "object") {
    if (node.component_type === "ApiNode" && node.data?.tool === "extension_tool") found.push(node.data.input?.name);
    Object.values(node).forEach((n) => calledToolNames(n, found));
  }
  return found;
};

test("cinatra.tools declares saved_drafts once, at the shipped module", () => {
  const entries = tools.filter((t) => t.name === "saved_drafts");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].module, "./cinatra/tools/saved-drafts.mjs");
});

test("saved_drafts declares embeddable as the own JSON boolean true", () => {
  const entry = tools.find((t) => t.name === "saved_drafts");
  assert.ok(entry, "saved_drafts is declared");
  assert.ok(
    Object.prototype.hasOwnProperty.call(entry, "embeddable"),
    "embeddable is an own key of the tool entry",
  );
  assert.strictEqual(entry.embeddable, true);
});

test("a tool entry carries only name, module and the embeddable flag", () => {
  for (const entry of tools) {
    for (const key of Object.keys(entry)) {
      assert.ok(["name", "module", "embeddable"].includes(key), `unexpected key ${key}`);
    }
    if ("embeddable" in entry) assert.equal(typeof entry.embeddable, "boolean");
  }
});

test("the flow calls exactly the one tool the manifest marks embeddable", () => {
  const called = calledToolNames(flow);
  assert.deepEqual(called, ["saved_drafts"]);
  assert.deepEqual(
    tools.filter((t) => t.embeddable === true).map((t) => t.name),
    called,
  );
});
