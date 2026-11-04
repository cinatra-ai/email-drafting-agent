// The declared module saved-drafts.mjs: it reads the run's saved draft bundle
// through the objects port and hands its drafts to the drafts review under
// draftBundle.draftedEmails; a missing reference, an object that is no draft
// bundle, a bundle without drafts and a draft without a recipient are refused
// by name - cinatra-ai/cinatra#3089.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_PATH = "cinatra/tools/saved-drafts.mjs";
const { extensionTool } = await import(new URL(`../${MODULE_PATH}`, import.meta.url));

const BUNDLE = "@cinatra-ai/campaigns:email-draft-bundle";
const everyOtherPort = [];

function makePorts({ saved, readError }) {
  const calls = { reads: [] };
  const other = (name) =>
    new Proxy({}, {
      get(_t, prop) {
        everyOtherPort.push(`${name}.${String(prop)}`);
        throw new Error(`port ${name} must not be used`);
      },
    });
  const ports = {
    objects: {
      async read(arg) {
        calls.reads.push(arg);
        if (readError) throw readError;
        return saved;
      },
      async save() {
        everyOtherPort.push("objects.save");
        throw new Error("the read step saves nothing");
      },
    },
    data: other("data"),
    artifacts: other("artifacts"),
    review: other("review"),
    clock: other("clock"),
  };
  return { ports, calls };
}

const bundleOf = (data, type = BUNDLE) => ({ objectId: "bundle-1", type, data });

function assertRefusal(error) {
  assert.equal(error.name, "ExtensionToolCallRefusal");
  assert.equal(typeof error.message, "string");
  assert.ok(error.message.length > 0 && error.message.length <= 400);
  assert.ok(!/[\r\n]/.test(error.message));
  return true;
}

const DRAFTS = [
  { recipientEmail: "ada@example.com", subject: "Idea one", body: "Hello Ada", status: "draft" },
  { id: "d-2", recipientId: "c-2", recipientName: "Ben", recipientEmail: "ben@example.com", subject: "Idea two", body: "Hello Ben", status: "draft" },
];

test("D1 the saved drafts are handed under draftBundle.draftedEmails, in saved order, read once by the trimmed reference", async () => {
  const { ports, calls } = makePorts({ saved: bundleOf({ cinatra_agent_run_id: "run-1", drafts: DRAFTS }) });
  const answer = await extensionTool({ input: { draftBundleRef: " bundle-1 " }, ports });
  assert.deepEqual(calls.reads, [{ objectId: "bundle-1" }]);
  assert.deepEqual(answer, { ok: true, draftBundle: { draftedEmails: DRAFTS } });
});

test("D2 a bundle that saved its drafts under draftedEmails is read from there first", async () => {
  const { ports } = makePorts({ saved: bundleOf({ draftedEmails: [DRAFTS[1]], drafts: [DRAFTS[0]] }) });
  const answer = await extensionTool({ input: { draftBundleRef: "bundle-1" }, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, [DRAFTS[1]]);
});

test("D3 each draft keeps only the fields the screen reads and the write-back matches on", async () => {
  const row = {
    recipientEmail: "cy@example.com",
    subject: "Idea three",
    body: "Hello Cy",
    status: "draft",
    followUpDay: 3,
    recipientName: null,
    cinatra_agent_run_id: "run-1",
    internal: { score: 0.4 },
    id: 7,
  };
  const { ports } = makePorts({ saved: bundleOf({ drafts: [row] }) });
  const answer = await extensionTool({ input: { draftBundleRef: "bundle-1" }, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, [
    { recipientEmail: "cy@example.com", subject: "Idea three", body: "Hello Cy", status: "draft", followUpDay: 3 },
  ]);
});

test("D4 a run that names no bundle is refused before any read", async () => {
  for (const input of [{}, { draftBundleRef: "" }, { draftBundleRef: "   " }, { draftBundleRef: 5 }, undefined]) {
    const { ports, calls } = makePorts({ saved: bundleOf({ drafts: DRAFTS }) });
    await assert.rejects(extensionTool({ input, ports }), assertRefusal);
    assert.deepEqual(calls.reads, []);
  }
});

test("D5 a refusal of the port reaches the caller unchanged", async () => {
  const refusal = new Error("extension_tool: objects.read: bundle-1 is not an object of this run or of a run it descends from");
  refusal.name = "ExtensionToolRefusal";
  const { ports } = makePorts({ readError: refusal });
  await assert.rejects(extensionTool({ input: { draftBundleRef: "bundle-1" }, ports }), (e) => e === refusal);
});

test("D6 an object that is no draft bundle, or a bundle without drafts, is refused", async () => {
  const cases = [
    null,
    bundleOf({ drafts: DRAFTS }, "@cinatra-ai/campaigns:recipients"),
    bundleOf({ drafts: DRAFTS }, "@cinatra-ai/campaigns:email-followup-bundle"),
    bundleOf([DRAFTS]),
    bundleOf("drafts"),
    bundleOf({ cinatra_agent_run_id: "run-1" }),
    bundleOf({ drafts: [] }),
    bundleOf({ draftedEmails: [] }),
    bundleOf({ drafts: "none" }),
  ];
  for (const saved of cases) {
    const { ports } = makePorts({ saved });
    await assert.rejects(extensionTool({ input: { draftBundleRef: "bundle-1" }, ports }), assertRefusal);
  }
});

test("D7 a draft that is not a draft, or names no recipient, is refused with its position", async () => {
  const cases = [
    [[DRAFTS[0], "text"], /Draft 2 /],
    [[DRAFTS[0], null], /Draft 2 /],
    [[["a"]], /Draft 1 /],
    [[{ subject: "No one", body: "Hello" }], /Draft 1 /],
    [[DRAFTS[0], { recipientEmail: "  ", subject: "Blank", body: "Hello" }], /Draft 2 /],
  ];
  for (const [drafts, position] of cases) {
    const { ports } = makePorts({ saved: bundleOf({ drafts }) });
    await assert.rejects(extensionTool({ input: { draftBundleRef: "bundle-1" }, ports }), (e) => assertRefusal(e) && position.test(e.message));
  }
});

test("D8 a followUpDay that is not a finite number is not handed on", async () => {
  const row = { recipientEmail: "dee@example.com", subject: "Idea four", body: "Hello Dee" };
  const days = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "3", null, true];
  const { ports } = makePorts({ saved: bundleOf({ drafts: days.map((followUpDay) => ({ ...row, followUpDay })) }) });
  const answer = await extensionTool({ input: { draftBundleRef: "bundle-1" }, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, days.map(() => row));
});

test("D9 a draftedEmails that is not a list leaves the drafts to be read from drafts", async () => {
  for (const draftedEmails of ["Idea one", { 0: DRAFTS[0] }, null, 2]) {
    const { ports } = makePorts({ saved: bundleOf({ draftedEmails, drafts: DRAFTS }) });
    const answer = await extensionTool({ input: { draftBundleRef: "bundle-1" }, ports });
    assert.deepEqual(answer.draftBundle.draftedEmails, DRAFTS);
  }
});

// The screen reads `draftedEmails ?? drafts`, so an empty draftedEmails list
// draws no draft there either: the module does not fill it from drafts.
test("D10 an empty draftedEmails list is not filled from drafts: the bundle holds no drafts to review", async () => {
  const { ports } = makePorts({ saved: bundleOf({ draftedEmails: [], drafts: DRAFTS }) });
  await assert.rejects(
    extensionTool({ input: { draftBundleRef: "bundle-1" }, ports }),
    (e) => assertRefusal(e) && /holds no drafts to review/.test(e.message),
  );
});

test("D11 saved data that is null, a date or an instance of a class is no draft bundle", async () => {
  class SavedBundle {
    constructor() {
      this.drafts = DRAFTS;
    }
  }
  for (const data of [null, new Date(0), new SavedBundle()]) {
    const { ports } = makePorts({ saved: bundleOf(data) });
    await assert.rejects(
      extensionTool({ input: { draftBundleRef: "bundle-1" }, ports }),
      (e) => assertRefusal(e) && /is not an email draft bundle/.test(e.message),
    );
  }
  // An object with a null prototype is a plain object, and it is read.
  const { ports } = makePorts({ saved: bundleOf(Object.assign(Object.create(null), { drafts: DRAFTS })) });
  const answer = await extensionTool({ input: { draftBundleRef: "bundle-1" }, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, DRAFTS);
});

test("D12 a draft that names its recipient only by id is handed on", async () => {
  const row = { id: "d-9", subject: "Idea five", body: "Hello" };
  const { ports } = makePorts({ saved: bundleOf({ drafts: [row] }) });
  const answer = await extensionTool({ input: { draftBundleRef: "bundle-1" }, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, [row]);
});

test("D13 a draft that names its recipient only by recipientId is handed on", async () => {
  const row = { recipientId: "c-9", subject: "Idea six", body: "Hello" };
  const { ports } = makePorts({ saved: bundleOf({ drafts: [row] }) });
  const answer = await extensionTool({ input: { draftBundleRef: "bundle-1" }, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, [row]);
});

test("D14 a draft whose id is no text, with no email and no recipientId, names no recipient", async () => {
  const cases = [
    { id: 7, subject: "Idea seven", body: "Hello" },
    { id: "  ", recipientId: "", subject: "Idea seven", body: "Hello" },
    { recipientId: 12, subject: "Idea seven", body: "Hello" },
  ];
  for (const row of cases) {
    const { ports } = makePorts({ saved: bundleOf({ drafts: [row] }) });
    await assert.rejects(
      extensionTool({ input: { draftBundleRef: "bundle-1" }, ports }),
      (e) => assertRefusal(e) && /^Draft 1 of this run names no recipient/.test(e.message),
    );
  }
});

test("D15 no other port is touched", () => {
  assert.deepEqual(everyOtherPort, []);
});

test("D16 the module names no run or external key and imports nothing", () => {
  const source = readFileSync(join(root, MODULE_PATH), "utf8");
  for (const word of ["agent_run_id", "cinatra_agent_run_id", "cinatra_run_id", "cinatraAgentRunId", "externalId", "external_id"]) {
    assert.ok(!source.includes(word), word);
  }
  assert.ok(!/^\s*import[\s({"']/m.test(source));
  assert.ok(!/\bimport\s*\(/.test(source));
  assert.equal(extensionTool.length, 1);
});
