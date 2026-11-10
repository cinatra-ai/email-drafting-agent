// Every saved draft names its recipient by a key that does not depend on the
// email - cinatra-ai/email-drafting-agent#56.
//
// The recipients review admits a contact without an email address. The draft
// step's prompt spells out the draft bundle the model saves; when a draft
// carries only recipientEmail, a draft for such a contact names no recipient,
// and the read step (saved_drafts) refuses the whole run before the review.
// So the prompt has every draft carry recipientId (the confirmed recipient's
// contactId) and recipientName beside recipientEmail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const system = oas.$referenced_components?.draft?.data?.system;

/** The draft entry of the objects_save structure the prompt spells out. */
const draftEntry = () => {
  const block = system.match(/drafts:\s*\[\s*(\{[^}]*\})\s*\]/);
  assert.ok(block, "the draft step's prompt spells out no drafts list in its objects_save structure");
  return block[1];
};

test("the draft step carries a system prompt", () => {
  assert.equal(typeof system, "string");
});

test("each draft the prompt saves carries recipientId and recipientName beside recipientEmail", () => {
  const entry = draftEntry();
  for (const field of ["recipientId", "recipientName", "recipientEmail", "subject", "body", "status"]) {
    assert.match(entry, new RegExp(`\\b${field}:`), `the saved draft carries no ${field}: ${entry}`);
  }
});

test("the prompt takes recipientId from the confirmed recipient's contactId and keeps a draft for a contact without an email", () => {
  assert.match(system, /recipientId[^.\n]*contactId/, "the prompt does not say recipientId is the recipient's contactId");
  assert.match(
    system,
    /without an email[^\n]*recipientEmail[^\n]*""/,
    "the prompt does not say a recipient without an email gets a draft with an empty recipientEmail",
  );
});
