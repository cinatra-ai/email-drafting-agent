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
