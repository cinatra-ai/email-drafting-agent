// Each drafted body is filed by the host and reviewed one by one -
// cinatra-ai/cinatra#3089.
//
// The run files one @cinatra-ai/email:body artifact per saved draft through the
// host's `artifact_materialize` LIST MODE (cinatra PR #4783): `content` is the
// JSON array of the saved drafts, and the literal fields `memberContentField`
// and `memberTitleField` name each member's body and subject. The host answers
// `{ artifacts: [{artifactId, representationRevisionId}], reviewTargets }`; the
// review targets feed the host review step (the gate marked
// `metadata.cinatra.artifactReview.targetsInput`), which opens one review per
// body, in draft order (design specs/app-lifecycle-cards.html sections XIII.1
// and II). The filed bytes are the saved bundle's `body`, so the send's
// fan-out reuses each body by run, extension and sha256.
//
// The parent's publish card (owner ruling 1204 B: an approved review before a
// publish card) reads this flow's end: the recipients, the approved body
// items and the call to action.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const oasText = readFileSync(join(root, "cinatra", "oas.json"), "utf8");
const oas = JSON.parse(oasText);
const refs = oas.$referenced_components;
const { extensionTool } = await import(new URL("../cinatra/tools/saved-drafts.mjs", import.meta.url));

const FILE_ID = "file_drafts";
const GATE_ID = "approval_gate";
const fileNode = refs[FILE_ID];
const input = fileNode?.data?.input ?? {};

const controlEdges = (oas.control_flow_connections ?? []).map(
  (e) => `${e.from_node.$component_ref} -> ${e.to_node.$component_ref}`,
);
const dataEdges = (oas.data_flow_connections ?? []).map(
  (e) =>
    `${e.source_node.$component_ref}.${e.source_output} -> ${e.destination_node.$component_ref}.${e.destination_input}`,
);
const feeds = (from, to) => dataEdges.filter((e) => e.endsWith(` -> ${to}`)).map((e) => e.split(" -> ")[0]).includes(from);

test("the filing step is a list call of the host's artifact_materialize, listed between the read and the review", () => {
  assert.equal(fileNode?.component_type, "ApiNode");
  assert.ok(fileNode.url.includes("/api/agents/passthrough"));
  assert.equal(fileNode.data.tool, "artifact_materialize");
  assert.ok(oas.nodes.some((n) => n.$component_ref === FILE_ID), "the filing step is not listed");
  assert.ok(controlEdges.includes(`read_drafts -> ${FILE_ID}`));
  assert.ok(controlEdges.includes(`${FILE_ID} -> ${GATE_ID}`));
  assert.equal(controlEdges.filter((e) => e.startsWith(`${FILE_ID} -> `)).length, 1);
});

test("the list call carries the host's compile grammar: literals, its own node id, no title", () => {
  // The literals of the host's compile check (packages/agents/src/artifact-binding.ts,
  // collectArtifactMaterializeNodesFromOasDocument) and the shaper's list mode.
  assert.equal(input.extension, "@cinatra-ai/email-artifacts");
  assert.equal(input.objectTypeId, "@cinatra-ai/email:body");
  assert.equal(input.declaredMime, "text/markdown");
  assert.equal(input.memberContentField, "body");
  assert.equal(input.memberTitleField, "subject");
  assert.equal(input.node_id, FILE_ID);
  assert.equal(fileNode.id, FILE_ID);
  for (const field of ["title", "contentJsonField", "artifactId", "baseRepresentationRevisionId"]) {
    assert.equal(Object.hasOwn(input, field), false, `a list call never carries ${field}`);
  }
  assert.ok(pkg.cinatra.produces.some((p) => p.extension === input.extension && p.objectTypeId === input.objectTypeId));
  assert.equal(fileNode.metadata?.cinatra?.publishes, false, "filing a body inside Cinatra is no external write");
});

test("the list content is the saved drafts, from the read step's draftBundle.draftedEmails", () => {
  assert.equal(
    input.content,
    "{# pyagentspec-input-hint (do not remove): {{ draftBundle }} #}{{ draftBundle.draftedEmails | tojson }}",
  );
  assert.ok(feeds("read_drafts.draftBundle", `${FILE_ID}.draftBundle`));
  assert.ok((fileNode.inputs ?? []).some((i) => i.title === "draftBundle" && i.type === "object"));
  assert.ok(!feeds("draft.draftBundleRef", `${FILE_ID}.draftBundle`));
});

/** Jinja's `tojson` (htmlsafe_json_dumps): JSON with <, >, & and ' as \u escapes. */
const jinjaToJson = (value) =>
  JSON.stringify(value).replace(/[<>&']/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** The host shaper's list rule (artifact-materialize-shaper.ts, shapeListMembers), on the fields this call names. */
function shapeMembers(content) {
  const parsed = JSON.parse(content);
  assert.ok(Array.isArray(parsed) && parsed.length > 0 && parsed.length <= 50);
  const seen = new Set();
  return parsed.map((member) => {
    const body = member[input.memberContentField];
    const title = member[input.memberTitleField];
    assert.equal(typeof body, "string");
    assert.ok(typeof title === "string" && title.trim().length > 0);
    const bytes = Buffer.from(body, "utf8").toString("hex");
    assert.ok(!seen.has(bytes), "two members with the same bytes");
    seen.add(bytes);
    return { title: title.trim(), content: body };
  });
}

test("the filed bytes are exactly each saved draft's body, in draft order, titled by its subject", async () => {
  const drafts = [
    { recipientId: "c-1", recipientName: "Ada", recipientEmail: "ada@example.com", subject: "Hello <Ada> & 'co'", body: "Hi Ada,\n\nLine with \"quotes\", {{ braces }} and </script>.\n", status: "draft" },
    { recipientId: "c-2", recipientName: "Ben", recipientEmail: "", subject: "Grüße", body: "Hallo Ben — \u{1F600}\r\nTabs\there", status: "draft" },
  ];
  const ports = {
    objects: {
      read: async ({ objectId }) =>
        objectId === "l-1"
          ? {
              objectId: "l-1",
              type: "@cinatra-ai/campaigns:recipients",
              data: {
                confirmedRecipients: [
                  { contactId: "c-1", name: "Ada", email: "ada@example.com" },
                  { contactId: "c-2", name: "Ben", email: "" },
                ],
              },
            }
          : { objectId: "b-1", type: "@cinatra-ai/campaigns:email-draft-bundle", data: { drafts } },
    },
  };
  const answer = await extensionTool({ input: { draftBundleRef: "b-1", confirmedRecipientsRef: "l-1" }, ports });
  const members = shapeMembers(jinjaToJson(answer.draftBundle.draftedEmails));
  assert.deepEqual(members, drafts.map((d) => ({ title: d.subject, content: d.body })));
  for (const [index, member] of members.entries()) {
    assert.ok(Buffer.from(member.content, "utf8").equals(Buffer.from(drafts[index].body, "utf8")));
  }
});

test("the review step is the host's review, fed by the filing step's review targets", () => {
  const gate = refs[GATE_ID];
  const meta = gate.metadata.cinatra;
  assert.equal(gate.component_type, "InputMessageNode");
  assert.equal(meta.artifactReview?.targetsInput, "reviewTargets");
  assert.deepEqual(gate.inputs, [{ title: "reviewTargets", type: "string", default: "[]" }]);
  assert.ok(feeds(`${FILE_ID}.reviewTargets`, `${GATE_ID}.reviewTargets`));
  assert.equal(dataEdges.filter((e) => e.endsWith(` -> ${GATE_ID}.reviewTargets`)).length, 1);
  assert.ok((fileNode.outputs ?? []).some((o) => o.title === "reviewTargets" && o.type === "string"));
  for (const key of ["renderer", "inputRenderers", "gateRenderer"]) assert.equal(Object.hasOwn(meta, key), false);
  assert.ok(!JSON.stringify(gate).includes("x-renderer"));
});

test("the pack's own drafts review screen, its apply step and its combined document are gone", () => {
  assert.equal(pkg.cinatra.fieldRenderers, undefined);
  assert.equal(oas.metadata.cinatra.hitlScreens, undefined);
  assert.ok(!oasText.includes("email-drafts-review"));
  assert.ok(!oasText.includes("@cinatra-ai/email-drafting-agent:output"), "a step still names the removed renderer");
  assert.equal(refs.apply, undefined);
  assert.ok(!oasText.includes("draftBundleDocument"));
  assert.ok(!oasText.includes("draftBodyArtifacts"), "the prompt still asks the model for body artifacts");
});

test("the end hands the parent's publish card the recipients, the approved bodies and the call to action", () => {
  const end = refs.end;
  const out = (title) => end.outputs.find((o) => o.title === title);
  const rootOut = (title) => oas.outputs.find((o) => o.title === title);
  for (const title of ["recipients", "approvedBodyArtifacts", "callToAction"]) {
    assert.ok(out(title), `the end does not hand on ${title}`);
    assert.ok(rootOut(title), `the flow does not declare the output ${title}`);
  }
  assert.deepEqual(Object.keys(out("recipients").json_schema.items.properties), ["name", "email", "company"]);
  assert.deepEqual(Object.keys(out("approvedBodyArtifacts").json_schema.items.properties), ["artifactId", "representationRevisionId"]);
  assert.ok(feeds("read_drafts.recipients", "end.recipients"));
  assert.ok(feeds(`${FILE_ID}.artifacts`, "end.approvedBodyArtifacts"));
  assert.ok(feeds("start.callToAction", "end.callToAction"));
  // The bodies reach the end only through the review: the end follows the gate.
  assert.ok(controlEdges.includes(`${GATE_ID} -> drafting_summary`));
  assert.ok(controlEdges.includes("drafting_summary -> end"));
});

// The recipients handed on are bound to the approved recipient list, never taken from the fields the draft step wrote:
// the read step gets the run's approved list reference from the start, the one the draft step reads.
test("the read step gets the run's approved recipient list from the start", () => {
  const read = refs.read_drafts;
  assert.equal(read.data.input.input.confirmedRecipientsRef, "{{ confirmedRecipientsRef }}");
  assert.ok(read.inputs.some((i) => i.title === "confirmedRecipientsRef" && i.type === "string"));
  assert.ok(feeds("start.confirmedRecipientsRef", "read_drafts.confirmedRecipientsRef"));
  assert.ok(feeds("start.confirmedRecipientsRef", "draft.confirmedRecipientsRef"));
});

test("the draft step saves each recipient's company for the publish card", () => {
  const system = refs.draft.data.system;
  assert.match(system, /recipientCompany: "\.\.\."/);
  assert.match(system, /recipientCompany is the confirmed recipient's company name/);
});

// The host cannot regenerate one body of a list filing yet: a Regenerate segment
// reruns only the declared step and its filing node, feeds every other input of
// the two from the producing run's snapshots (docker/wayflow/regenerate_segment.py),
// so the filing node would refile the snapshotted drafts of the read step, and the
// completer claims a segment's write only when the run filed exactly one artifact
// (packages/agents/src/regenerate-segment.ts, claimSegmentProduction). A
// declaration would show a Regenerate whose repair never resolves, so it is not made.
test("no Regenerate declaration is made over the list filing until the host can regenerate one member", () => {
  assert.equal(pkg.cinatra.lifecycle?.regenerate, undefined);
});

// Each filed body carries its contact, its campaign and its run (cinatra-ai/cinatra#3089).
//
// The host's send reads a body's own data: the contact it is for (contactId), the campaign it was
// reviewed in (campaignId) and the run that filed it (runId). The list filing stores typed data per
// member from three literal inputs: `memberDataFields` (member fields stored under their own name,
// each a non-blank string the member supplies), `memberData` (call-wide values the host stamps on
// every member; a member that carries one is refused) and `memberRunIdField` (the field the host
// fills with the calling run's id; a member that carries it is refused). The contact is written by
// the read step, which has no model, from the approved recipient list; the campaign is the flow's
// start input; the run id is the host's.
test("the filing call declares the typed member data exactly", () => {
  assert.deepEqual(input, {
    extension: "@cinatra-ai/email-artifacts",
    objectTypeId: "@cinatra-ai/email:body",
    declaredMime: "text/markdown",
    content: "{# pyagentspec-input-hint (do not remove): {{ draftBundle }} #}{{ draftBundle.draftedEmails | tojson }}",
    memberContentField: "body",
    memberTitleField: "subject",
    memberDataFields: ["contactId"],
    memberData: { campaignId: "{{ campaignId }}" },
    memberRunIdField: "runId",
    node_id: FILE_ID,
  });
});

test("the flow's campaign reaches the filing step", () => {
  assert.ok(dataEdges.includes(`start.campaignId -> ${FILE_ID}.campaignId`));
  assert.ok((fileNode.inputs ?? []).some((i) => i.title === "campaignId" && i.type === "string"));
  assert.ok(oas.inputs.some((i) => i.title === "campaignId"));
});

// A blank campaign is refused before anything is drafted: the host refuses a blank stamped value, and
// the send refuses a body with no campaign, so a run without one could only draft and review emails
// that nobody can send.
test("a run without a campaign stops before drafting, with its own sentence", () => {
  const branchEdges = oas.control_flow_connections.map(
    (e) => `${e.from_node.$component_ref}${e.from_branch ? `[${e.from_branch}]` : ""} -> ${e.to_node.$component_ref}`,
  );
  assert.ok(dataEdges.includes("start.campaignId -> check_inputs_predicate.campaignId"));
  const predicate = refs.check_inputs_predicate;
  assert.ok(predicate.inputs.some((i) => i.title === "campaignId"));
  assert.match(predicate.template, /no_campaign/);
  assert.match(predicate.template, /campaignId/);
  assert.deepEqual(refs.check_inputs.mapping, { present: "skip", no_campaign: "no_campaign" });
  assert.ok(refs.check_inputs.branches.includes("no_campaign"));
  assert.ok(oas.nodes.some((n) => n.$component_ref === "campaign_missing"));
  assert.ok(branchEdges.includes("check_inputs[no_campaign] -> campaign_missing"));
  assert.ok(branchEdges.includes("campaign_missing -> end"));
  assert.ok(branchEdges.includes("check_inputs[skip] -> draft"));
  assert.equal(branchEdges.filter((e) => e.endsWith(" -> draft")).length, 1, "drafting has one way in");
  const message = refs.campaign_missing.message;
  assert.match(message, /campaign/i);
  assert.match(message, /before drafting/);
  // The recipient list keeps its own sentence and is asked first.
  assert.ok(branchEdges.includes("check_inputs[default] -> inputs_missing"));
  assert.ok(predicate.template.indexOf("missing") < predicate.template.indexOf("no_campaign"));
});

async function readWith(drafts, rows) {
  const ports = {
    objects: {
      read: async ({ objectId }) =>
        objectId === "l-1"
          ? { objectId: "l-1", type: "@cinatra-ai/campaigns:recipients", data: { confirmedRecipients: rows } }
          : { objectId: "b-1", type: "@cinatra-ai/campaigns:email-draft-bundle", data: { drafts } },
    },
  };
  return extensionTool({ input: { draftBundleRef: "b-1", confirmedRecipientsRef: "l-1" }, ports });
}

const approvedRows = [
  { contactId: "c-1", name: "Ada", email: "ada@example.com" },
  { contactId: "c-2", name: "Ben", email: "" },
  { contactId: "c-3", name: "Cy", email: "cy@example.com" },
];

test("every member reaching the filing carries its approved contact as a non-blank contactId", async () => {
  const drafts = [
    { recipientId: "c-1", subject: "One", body: "Hi Ada" },
    // The model wrote its contact with spaces, and for another draft only as contactId.
    { recipientId: " c-2 ", subject: "Two", body: "Hi Ben" },
    { contactId: "c-3", subject: "Three", body: "Hi Cy" },
  ];
  const { draftBundle } = await readWith(drafts, approvedRows);
  assert.deepEqual(
    draftBundle.draftedEmails.map((m) => m.contactId),
    ["c-1", "c-2", "c-3"],
  );
  for (const member of draftBundle.draftedEmails) {
    assert.ok(member.contactId.trim().length > 0 && member.contactId.length <= 512);
  }
});

test("a member never carries a field the host stamps: campaignId, runId", async () => {
  // A draft that names a campaign or a run cannot set them: the host refuses a member that carries a
  // stamped field, so the read step hands on none.
  const drafts = [
    { recipientId: "c-1", subject: "One", body: "Hi Ada", campaignId: "other-campaign", runId: "other-run" },
    { recipientId: "c-2", subject: "Two", body: "Hi Ben" },
    { recipientId: "c-3", subject: "Three", body: "Hi Cy" },
  ];
  const { draftBundle } = await readWith(drafts, approvedRows);
  for (const member of draftBundle.draftedEmails) {
    assert.equal(Object.hasOwn(member, input.memberRunIdField), false);
    for (const name of Object.keys(input.memberData)) assert.equal(Object.hasOwn(member, name), false);
  }
});

// Every value the pack hands to the host's typed member data is checked against the host's bound before
// anything is filed: non-blank after trim, at most 512 characters after trim (the host stores typed values
// trimmed and measures them in that order), no line break. A value over the bound would make the host refuse
// the whole filing, so no review would appear.
const idOf = (length) => "c".repeat(length);
const refusedWith = (pattern, secret) => (error) => {
  assert.match(error.message, pattern);
  assert.ok(!error.message.includes(secret), "the refusal never names the value");
  return true;
};
const oneApproved = (contactId) => [{ contactId, name: "Ada", email: "ada@example.com" }];
const oneDraft = (recipientId) => [{ recipientId, subject: "One", body: "Hi Ada" }];

test("a contact id of 512 characters is accepted and one of 513 is refused by position, never by value", async () => {
  const ok = await readWith(oneDraft(idOf(512)), oneApproved(idOf(512)));
  assert.equal(ok.draftBundle.draftedEmails[0].contactId, idOf(512));
  const bad = [...oneApproved("c-1"), ...oneApproved(idOf(513))];
  await assert.rejects(
    readWith([...oneDraft("c-1"), { recipientId: idOf(513), subject: "Two", body: "Hi again" }], bad),
    refusedWith(/^Approved recipient 2 of this run has a contact id that cannot be stored on its email body/, idOf(20)),
  );
});

test("a padded contact id is trimmed, then measured", async () => {
  const padded = `  ${idOf(512)}\t`;
  const ok = await readWith(oneDraft(padded), oneApproved(padded));
  assert.equal(ok.draftBundle.draftedEmails[0].contactId, idOf(512));
  const tooLong = `  ${idOf(513)} `;
  await assert.rejects(
    readWith(oneDraft(tooLong), oneApproved(tooLong)),
    refusedWith(/^Approved recipient 1 of this run has a contact id that cannot be stored/, idOf(20)),
  );
});

test("a contact id with a line break is refused by position", async () => {
  for (const contactId of ["c-1\nx", "c-1\rx", "c-1\r\nx", "c-1 x"]) {
    await assert.rejects(
      readWith(oneDraft("c-1"), oneApproved(contactId)),
      refusedWith(/^Approved recipient 1 of this run has a contact id that cannot be stored/, "c-1"),
    );
  }
});

test("the campaign check refuses a campaign over 512 characters or over several lines, after trimming", () => {
  const template = refs.check_inputs_predicate.template;
  assert.match(template, /campaignId/);
  assert.match(template, /\|\s*trim/);
  assert.match(template, /length\s*>\s*512/);
  assert.match(template, /splitlines\(\)\s*\|\s*length\s*>\s*1/);
  // The recipient list is asked first; both campaign faults end the run on the same branch and sentence.
  assert.ok(template.indexOf("missing") < template.indexOf("no_campaign"));
  assert.match(refs.campaign_missing.message, /512/);
  assert.match(refs.campaign_missing.message, /one line/);
});

test("a draft whose contactId and recipientId differ still ends the run", async () => {
  await assert.rejects(
    readWith([{ recipientId: "c-1", contactId: "c-2", subject: "One", body: "Hi" }], approvedRows),
    /two different contacts/,
  );
});

test("the version follows the pack's convention", () => {
  assert.equal(pkg.version, "0.1.9");
});
