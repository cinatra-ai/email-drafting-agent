// The declared module saved-drafts.mjs: it reads the run's saved draft bundle
// through the objects port and hands its drafts to the drafts review under
// draftBundle.draftedEmails; a missing reference, an object that is no draft
// bundle, a bundle without drafts, a draft without a recipient or without
// subject and body text, a draft with a blank subject, a draft whose id is empty or not text, two
// drafts the review cannot tell apart, two drafts with the same body bytes, and a bundle of more drafts than the
// filing takes (50) are refused by name - cinatra-ai/cinatra#3089.
// It also reads the run's approved recipient list and binds each draft to exactly
// one approved recipient: the recipient fields it hands on are the approved ones.

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

const LIST = "@cinatra-ai/campaigns:recipients";

// The approved list a test names no list for: one row per draft that names a recipientId, with the draft's own
// recipient fields, so that the draft is approved as saved. It is built only when the list is read.
function listFromDrafts(saved) {
  const data = saved?.data;
  const drafts = Array.isArray(data?.draftedEmails) ? data.draftedEmails : Array.isArray(data?.drafts) ? data.drafts : [];
  const text = (value) => (typeof value === "string" ? value : undefined);
  const rows = drafts
    .filter((draft) => draft && typeof draft === "object" && typeof draft.recipientId === "string" && draft.recipientId.trim() !== "")
    .map((draft) => ({
      contactId: draft.recipientId.trim(),
      name: text(draft.recipientName) ?? "",
      email: text(draft.recipientEmail) ?? "",
      accountName: text(draft.recipientCompany) ?? "",
    }));
  return { objectId: "list-1", type: LIST, data: { confirmedRecipients: rows } };
}

function makePorts({ saved, approved, readError }) {
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
        if (arg?.objectId === "list-1") return approved === undefined ? listFromDrafts(saved) : approved;
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

const INPUT = { draftBundleRef: "bundle-1", confirmedRecipientsRef: "list-1" };
const listOf = (rows, type = LIST) => ({ objectId: "list-1", type, data: { confirmedRecipients: rows } });

const bundleOf = (data, type = BUNDLE) => ({ objectId: "bundle-1", type, data });

function assertRefusal(error) {
  assert.equal(error.name, "ExtensionToolCallRefusal");
  assert.equal(typeof error.message, "string");
  assert.ok(error.message.length > 0 && error.message.length <= 400);
  assert.ok(!/[\r\n]/.test(error.message));
  return true;
}

const DRAFTS = [
  { recipientId: "c-1", recipientEmail: "ada@example.com", subject: "Idea one", body: "Hello Ada", status: "draft" },
  { id: "d-2", recipientId: "c-2", recipientName: "Ben", recipientEmail: "ben@example.com", subject: "Idea two", body: "Hello Ben", status: "draft" },
];

test("D1 the saved drafts are handed under draftBundle.draftedEmails, in saved order, read once by the trimmed reference", async () => {
  const { ports, calls } = makePorts({ saved: bundleOf({ cinatra_agent_run_id: "run-1", drafts: DRAFTS }) });
  const answer = await extensionTool({ input: { draftBundleRef: " bundle-1 ", confirmedRecipientsRef: " list-1 " }, ports });
  assert.deepEqual(calls.reads, [{ objectId: "bundle-1" }, { objectId: "list-1" }]);
  assert.deepEqual(answer, {
    ok: true,
    draftBundle: { draftedEmails: DRAFTS },
    recipients: [
      { name: "", email: "ada@example.com", company: "" },
      { name: "Ben", email: "ben@example.com", company: "" },
    ],
  });
});

// The parent's publish card names who each draft goes to (cinatra-ai/cinatra#3089): one recipient per draft, in draft
// order, with the name, email and company of the APPROVED recipient the draft is for, never the fields the draft step
// wrote. A field the approved recipient does not hold is "".
test("D31 the recipients are the approved recipients, one per draft and in draft order, with their company", async () => {
  const text = { subject: "Idea thirteen", status: "draft" };
  const drafts = [
    { recipientId: "c-3", recipientCompany: 7, recipientEmail: "cy@example.com", body: "Hello Cy", ...text },
    { recipientId: "c-1", recipientName: "Ada", recipientEmail: "ada@example.com", recipientCompany: "Acme", body: "Hello Ada", ...text },
    { recipientId: "c-2", recipientName: "Ben", recipientEmail: "", body: "Hello Ben", ...text },
  ];
  // The approved list is in another order than the drafts, and names more than the drafts do.
  const approved = listOf([
    { contactId: "c-1", name: "Ada", title: "CEO", email: "ada@example.com", accountId: "a-1", accountName: "Acme Corp" },
    { contactId: "c-2", name: "Ben", email: "", accountName: "" },
    { contactId: "c-3", name: "Cy", email: "cy@example.com", accountName: "Cyco" },
  ]);
  const answer = await readOf({ drafts }, approved);
  assert.deepEqual(answer.recipients, [
    { name: "Cy", email: "cy@example.com", company: "Cyco" },
    { name: "Ada", email: "ada@example.com", company: "Acme Corp" },
    { name: "Ben", email: "", company: "" },
  ]);
  // The drafts handed on carry the approved recipient fields too.
  assert.deepEqual(
    answer.draftBundle.draftedEmails.map(({ recipientId, recipientName, recipientEmail, recipientCompany }) => ({ recipientId, recipientName, recipientEmail, recipientCompany })),
    [
      { recipientId: "c-3", recipientName: "Cy", recipientEmail: "cy@example.com", recipientCompany: "Cyco" },
      { recipientId: "c-1", recipientName: "Ada", recipientEmail: "ada@example.com", recipientCompany: "Acme Corp" },
      { recipientId: "c-2", recipientName: "Ben", recipientEmail: "", recipientCompany: undefined },
    ],
  );
  assert.equal(Object.hasOwn(answer.draftBundle.draftedEmails[2], "recipientCompany"), false);
});

test("D2 a bundle that saved its drafts under draftedEmails is read from there first", async () => {
  const { ports } = makePorts({ saved: bundleOf({ draftedEmails: [DRAFTS[1]], drafts: [DRAFTS[0]] }) });
  const answer = await extensionTool({ input: INPUT, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, [DRAFTS[1]]);
});

test("D3 each draft keeps only the fields the screen reads and the write-back matches on", async () => {
  const row = {
    recipientId: "c-3",
    recipientEmail: "cy@example.com",
    subject: "Idea three",
    body: "Hello Cy",
    status: "draft",
    followUpDay: 3,
    recipientName: null,
    cinatra_agent_run_id: "run-1",
    internal: { score: 0.4 },
    id: null,
  };
  const { ports } = makePorts({ saved: bundleOf({ drafts: [row] }) });
  const answer = await extensionTool({ input: INPUT, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, [
    { recipientId: "c-3", recipientEmail: "cy@example.com", subject: "Idea three", body: "Hello Cy", status: "draft", followUpDay: 3 },
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
  await assert.rejects(extensionTool({ input: INPUT, ports }), (e) => e === refusal);
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
    await assert.rejects(extensionTool({ input: INPUT, ports }), assertRefusal);
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
    await assert.rejects(extensionTool({ input: INPUT, ports }), (e) => assertRefusal(e) && position.test(e.message));
  }
});

test("D8 a followUpDay that is not a finite number is not handed on", async () => {
  const rowOf = (i) => ({ recipientId: `c-${i}`, recipientEmail: `dee${i}@example.com`, subject: "Idea four", body: `Hello Dee ${i}` });
  const days = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "3", null, true];
  const { ports } = makePorts({ saved: bundleOf({ drafts: days.map((followUpDay, i) => ({ ...rowOf(i), followUpDay })) }) });
  const answer = await extensionTool({ input: INPUT, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, days.map((_, i) => rowOf(i)));
});

test("D9 a draftedEmails that is not a list leaves the drafts to be read from drafts", async () => {
  for (const draftedEmails of ["Idea one", { 0: DRAFTS[0] }, null, 2]) {
    const { ports } = makePorts({ saved: bundleOf({ draftedEmails, drafts: DRAFTS }) });
    const answer = await extensionTool({ input: INPUT, ports });
    assert.deepEqual(answer.draftBundle.draftedEmails, DRAFTS);
  }
});

// The screen reads `draftedEmails ?? drafts`, so an empty draftedEmails list
// draws no draft there either: the module does not fill it from drafts.
test("D10 an empty draftedEmails list is not filled from drafts: the bundle holds no drafts to review", async () => {
  const { ports } = makePorts({ saved: bundleOf({ draftedEmails: [], drafts: DRAFTS }) });
  await assert.rejects(
    extensionTool({ input: INPUT, ports }),
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
      extensionTool({ input: INPUT, ports }),
      (e) => assertRefusal(e) && /is not an email draft bundle/.test(e.message),
    );
  }
  // An object with a null prototype is a plain object, and it is read.
  const { ports } = makePorts({ saved: bundleOf(Object.assign(Object.create(null), { drafts: DRAFTS })) });
  const answer = await extensionTool({ input: INPUT, ports });
  assert.deepEqual(answer.draftBundle.draftedEmails, DRAFTS);
});

// A draft's own id is not a contact: a draft that names no contact (contactId or recipientId) is for no approved recipient.
test("D12 a draft that names its recipient only by its own id is for no approved recipient and is refused", async () => {
  const row = { id: "d-9", subject: "Idea five", body: "Hello" };
  await assert.rejects(
    readOf({ drafts: [row] }, listOf([{ contactId: "d-9", name: "Dee", email: "" }])),
    refused(/^Draft 1 of this run names no approved recipient/),
  );
});

test("D13 a draft that names its recipient only by recipientId is handed on", async () => {
  const row = { recipientId: "c-9", subject: "Idea six", body: "Hello" };
  const { ports } = makePorts({ saved: bundleOf({ drafts: [row] }) });
  const answer = await extensionTool({ input: INPUT, ports });
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
      extensionTool({ input: INPUT, ports }),
      (e) => assertRefusal(e) && /^Draft 1 of this run names no recipient/.test(e.message),
    );
  }
});

const refused = (pattern) => (e) => assertRefusal(e) && pattern.test(e.message);
const readOf = async (data, approved) => {
  const { ports } = makePorts({ saved: bundleOf(data), approved });
  return extensionTool({ input: INPUT, ports });
};

test("D17 saved data whose prototype is another object is no draft bundle, even with a null-prototype parent", async () => {
  const parent = Object.assign(Object.create(null), { drafts: DRAFTS });
  const inherited = Object.create(parent); // no own drafts: they are only inherited
  class SavedBundle {
    constructor() {
      this.drafts = DRAFTS;
    }
  }
  const reparented = Object.setPrototypeOf(new SavedBundle(), Object.create(null));
  for (const data of [inherited, reparented]) {
    await assert.rejects(readOf(data), refused(/is not an email draft bundle/));
  }
  const row = Object.setPrototypeOf({ ...DRAFTS[0] }, Object.create(null));
  await assert.rejects(readOf({ drafts: [row] }), refused(/^Draft 1 of this run is not a draft/));
});

test("D18 a getter or a setter on the saved data or on a draft is refused and never run", async () => {
  let runs = 0;
  const cases = [
    [{ get drafts() { runs += 1; return DRAFTS; } }, /is not an email draft bundle/],
    [{ get drafts() { runs += 1; throw new Error("the getter ran"); } }, /is not an email draft bundle/],
    [{ drafts: DRAFTS, set draftedEmails(_v) { runs += 1; } }, /is not an email draft bundle/],
    [{ drafts: [{ recipientEmail: "eve@example.com", get subject() { runs += 1; return "Made up"; }, body: "Hello" }] }, /^Draft 1 of this run is not a draft/],
  ];
  for (const [data, pattern] of cases) {
    await assert.rejects(readOf(data), refused(pattern));
  }
  assert.equal(runs, 0);
});

test("D19 a list of drafts with another prototype or an accessor entry is no list of drafts", async () => {
  let runs = 0;
  const made = [];
  const reparented = Object.setPrototypeOf([null], {
    *entries() {
      runs += 1;
      yield [0, { recipientEmail: "mallory@example.com", subject: "Made up", body: "Not saved" }];
    },
  });
  made.push(reparented);
  const accessor = [];
  Object.defineProperty(accessor, "0", { enumerable: true, get() { runs += 1; return DRAFTS[0]; } });
  made.push(accessor);
  for (const drafts of made) {
    await assert.rejects(readOf({ drafts }), refused(/is not an email draft bundle/));
  }
  assert.equal(runs, 0);
});

test("D20 a draft whose subject or body is not text is refused with its position", async () => {
  const base = { recipientEmail: "fay@example.com" };
  const cases = [
    { ...base, subject: 7, body: "Hello" },
    { ...base, subject: "Idea eight", body: { text: "hello" } },
    { ...base, subject: null, body: "Hello" },
    { ...base, body: "Hello" },
    { ...base, subject: "Idea eight" },
  ];
  for (const row of cases) {
    await assert.rejects(readOf({ drafts: [DRAFTS[0], row] }), refused(/^Draft 2 of this run has a subject or a body that is not text/));
  }
  // An empty body is text: the filing takes it as one body. An empty subject is not: it is the filed body's title.
  const emptyBody = { ...base, recipientId: "c-8", subject: "Idea eight", body: "" };
  const answer = await readOf({ drafts: [emptyBody] });
  assert.deepEqual(answer.draftBundle.draftedEmails, [emptyBody]);
});

test("D21 two drafts that the review would show under one id, or that name one recipient email, are refused", async () => {
  const text = { subject: "Idea nine", body: "Hello" };
  // The second draft of each pair has a body of its own, so that only its key or its email can refuse the pair.
  const other = { subject: "Idea nine", body: "Hello again" };
  const cases = [
    [{ recipientEmail: "shared@example.com", ...text }, { recipientEmail: "shared@example.com", ...other, subject: "Second" }],
    [{ id: "x@example.com", recipientEmail: "gil@example.com", ...text }, { recipientEmail: "x@example.com", ...other }],
    [{ id: "d-1", ...text }, { recipientId: "d-1", ...other }],
    [{ recipientEmail: "hal@example.com", ...text }, { id: "d-2", recipientEmail: "hal@example.com", ...other }],
    [{ recipientId: "", recipientEmail: "ivy@example.com", ...text }, { recipientId: "", recipientEmail: "jon@example.com", ...other }],
  ];
  for (const drafts of cases) {
    await assert.rejects(readOf({ drafts }), refused(/^Drafts 1 and 2 of this run /));
  }
  // Distinct ids with distinct emails pass, whichever field names each one.
  const distinct = [{ id: "d-1", recipientId: "c-1", recipientEmail: "kim@example.com", ...text }, { recipientId: "d-2", ...other }, { recipientId: "c-3", recipientEmail: "lea@example.com", ...text, body: "Hello third" }];
  const answer = await readOf({ drafts: distinct });
  assert.deepEqual(answer.draftBundle.draftedEmails, distinct);
});

test("D22 a draft that the review would show under the id __proto__ is refused", async () => {
  for (const row of [
    { id: "__proto__", recipientEmail: "max@example.com", subject: "Idea ten", body: "Hello" },
    { recipientId: "__proto__", subject: "Idea ten", body: "Hello" },
  ]) {
    await assert.rejects(readOf({ drafts: [row] }), refused(/^Draft 1 of this run has the id __proto__/));
  }
});

// The write-back edits the first list among draftedEmails, sequence, followups, drafts and confirmedRecipients that the
// bundle holds; the review shows draftedEmails or drafts. A bundle where those two differ shows one list and edits another.
test("D23 a bundle whose write-back would edit another list than the one the review shows is refused", async () => {
  for (const data of [
    { sequence: [DRAFTS[0]], drafts: DRAFTS },
    { followups: [], drafts: DRAFTS },
    { draftedEmails: "none", sequence: [DRAFTS[1]], drafts: DRAFTS },
  ]) {
    await assert.rejects(readOf(data), refused(/keeps its drafts in a list the drafts review does not show/));
  }
  // A list after drafts in that order is not the write-back's: the drafts are read.
  const answer = await readOf({ drafts: DRAFTS, confirmedRecipients: [{ email: "ada@example.com" }] });
  assert.deepEqual(answer.draftBundle.draftedEmails, DRAFTS);
});

test("D24 an unexpected failure of the read reaches the caller unchanged", async () => {
  const failure = new TypeError("the store did not answer");
  const { ports } = makePorts({ readError: failure });
  await assert.rejects(extensionTool({ input: INPUT, ports }), (e) => e === failure);
});

// The write-back keys a saved row by `id ?? recipientId` when that is non-empty text, else by its email; the screen keys the
// handed draft by its id first. A draft whose id is present (not null) but empty or not text is keyed otherwise on the two
// sides: without an email, its edit is dropped (an empty id) or matches no row (an id that is not text), and the write-back
// answers 422. Such an id is refused also when the draft names an email that the write-back could match: one plain rule.
test("D25 a draft whose id is present but empty or not text is refused with its position", async () => {
  const text = { subject: "Idea eleven", body: "Hello" };
  const cases = [
    { id: "", recipientId: "r-1", ...text },
    { id: 7, recipientId: "r-1", ...text },
    { id: "", recipientEmail: "nia@example.com", ...text },
    { id: 7, recipientEmail: "nia@example.com", ...text },
    { id: false, recipientId: "r-1", ...text },
    { id: { value: "d-1" }, recipientId: "r-1", ...text },
    { id: ["d-1"], recipientEmail: "nia@example.com", ...text },
  ];
  for (const row of cases) {
    await assert.rejects(readOf({ drafts: [DRAFTS[0], row] }), refused(/^Draft 2 of this run has an id that is empty or not text/));
  }
  // A null id is no id on either side: the draft is handed on under its recipientId, without the id.
  const answer = await readOf({ drafts: [{ id: null, recipientId: "r-1", ...text }] });
  assert.deepEqual(answer.draftBundle.draftedEmails, [{ recipientId: "r-1", ...text }]);
});

// The filing step files at most 50 bodies in one call (MAX_MATERIALIZE_LIST_MEMBERS of the platform's
// artifact-materialize-shaper.ts), one per draft. A bundle of more drafts would pass the read and be refused at the
// filing, with the platform's error and after the run's work, so the read refuses it by its count.
test("D26 a bundle of more drafts than the filing takes (50) is refused with the limit and the count", async () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `d-${i + 1}`, recipientId: `c-${i + 1}`, subject: `Idea ${i + 1}`, body: `Hello ${i + 1}` }));
  await assert.rejects(readOf({ drafts: many(51) }), refused(/^The saved draft bundle of this run holds 51 drafts, more than the 50 /));
  await assert.rejects(readOf({ draftedEmails: many(2500) }), refused(/ holds 2500 drafts, more than the 50 /));
  // Exactly 50 drafts pass, each as saved.
  const answer = await readOf({ drafts: many(50) });
  assert.equal(answer.draftBundle.draftedEmails.length, 50);
  assert.deepEqual(answer.draftBundle.draftedEmails[49], { id: "d-50", recipientId: "c-50", subject: "Idea 50", body: "Hello 50" });
});

// The filing titles each body by its draft's subject, and the platform refuses a blank title (the check is a trim).
test("D32 a draft with a blank subject is refused with its position", async () => {
  for (const subject of ["", "   ", "\t\n", "\u00a0\ufeff"]) {
    await assert.rejects(
      readOf({ drafts: [DRAFTS[0], { recipientEmail: "fay@example.com", subject, body: "Hello Fay" }] }),
      refused(/^Draft 2 of this run has a blank subject, so the filing of its body is not possible/),
    );
  }
  // A subject with text around its spaces is a title, as the platform trims it.
  const padded = { recipientId: "c-6", recipientEmail: "fay@example.com", subject: "  Idea  ", body: "Hello Fay" };
  assert.deepEqual((await readOf({ drafts: [padded] })).draftBundle.draftedEmails, [padded]);
});

// The platform stores each body as UTF-8 bytes and refuses two bodies with the same bytes. A person has to change one
// of the two drafts, so the refusal names both.
test("D33 two drafts with the same body are refused, naming both drafts and their recipients", async () => {
  const drafts = [
    { id: "d-1", recipientName: "Ada", recipientEmail: "ada@example.com", subject: "One", body: "Same text" },
    { id: "d-2", recipientEmail: "ben@example.com", subject: "Two", body: "Other text" },
    { id: "d-3", recipientName: "Cy", recipientEmail: "cy@example.com", subject: "Three", body: "Same text" },
  ];
  await assert.rejects(
    readOf({ drafts }),
    (error) => {
      assertRefusal(error);
      assert.match(error.message, /^Drafts 1 and 3 of this run have the same body, so the filing would make them one email body: /);
      assert.ok(error.message.includes("ada@example.com") && error.message.includes("cy@example.com"));
      assert.ok(!error.message.includes("ben@example.com"));
      return true;
    },
  );
  // The empty body is a body: two of them are the same body.
  await assert.rejects(
    readOf({ drafts: [{ id: "a", subject: "A", body: "" }, { id: "b", subject: "B", body: "" }] }),
    refused(/^Drafts 1 and 2 of this run have the same body/),
  );
  // The same subject is no collision: the title is not the key.
  const answer = await readOf({ drafts: [{ id: "a", recipientId: "c-a", subject: "Same", body: "One" }, { id: "b", recipientId: "c-b", subject: "Same", body: "Two" }] });
  assert.equal(answer.draftBundle.draftedEmails.length, 2);
});

// The comparison is of UTF-8 bytes, as the platform's: a leading byte order mark is a byte sequence of its own, and an
// unpaired surrogate is written as U+FFFD, so it has the bytes of that character.
test("D34 bodies differing only by a leading byte order mark are two bodies", async () => {
  const drafts = [
    { id: "a", recipientId: "c-a", subject: "A", body: "Hello" },
    { id: "b", recipientId: "c-b", subject: "B", body: "\ufeffHello" },
  ];
  assert.equal((await readOf({ drafts })).draftBundle.draftedEmails.length, 2);
});

test("D35 bodies that differ as strings but have the same UTF-8 bytes are refused", async () => {
  const cases = [
    ["a\ud800b", "a\udc00b"],
    ["a\ud800b", "a\ufffdb"],
  ];
  for (const [first, second] of cases) {
    await assert.rejects(
      readOf({ drafts: [{ id: "a", subject: "A", body: first }, { id: "b", subject: "B", body: second }] }),
      refused(/^Drafts 1 and 2 of this run have the same body/),
    );
  }
});

// The binding to the approved recipient list - cinatra-ai/cinatra#3089. The draft step writes each draft's recipient
// fields itself; only the approved list says who the run may write to. Each draft is bound, by its contact (contactId,
// else recipientId, as the host's send reads it), to exactly one approved recipient, and every approved recipient has
// exactly one draft. The recipient fields handed on are the approved recipient's.
const APPROVED = listOf([
  { contactId: "c-1", name: "Ada Lopez", email: "ada@example.com", accountName: "Acme" },
  { contactId: "c-2", name: "Ben Ito", email: "ben@example.com", accountName: "Bento" },
]);
const BOUND = [
  { id: "d-1", recipientId: "c-1", recipientName: "Ada Lopez", recipientEmail: "ada@example.com", recipientCompany: "Acme", subject: "One", body: "Hello Ada", status: "draft" },
  { id: "d-2", recipientId: "c-2", recipientName: "Ben Ito", recipientEmail: "ben@example.com", recipientCompany: "Bento", subject: "Two", body: "Hello Ben", status: "draft" },
];

test("B1 a draft for an approved recipient with another email address is refused, naming the recipient and the field", async () => {
  const drafts = [BOUND[0], { ...BOUND[1], recipientEmail: "mallory@evil.example" }];
  await assert.rejects(readOf({ drafts }, APPROVED), (error) => {
    assertRefusal(error);
    assert.match(error.message, /^Draft 2 of this run, for Ben Ito, has a recipient email that is not the approved recipient's/);
    assert.ok(!error.message.includes("mallory@evil.example"), "the refusal repeats the address nobody approved");
    return true;
  });
  // An empty address for an approved recipient who has one is another address too: the send reads the draft's own.
  await assert.rejects(readOf({ drafts: [BOUND[0], { ...BOUND[1], recipientEmail: "" }] }, APPROVED), refused(/^Draft 2 .* recipient email /));
  // The same address in other letter case or with spaces around it is the approved address; the approved spelling is handed on.
  const answer = await readOf({ drafts: [{ ...BOUND[0], recipientEmail: " ADA@Example.com " }, BOUND[1]] }, APPROVED);
  assert.equal(answer.recipients[0].email, "ada@example.com");
  assert.equal(answer.draftBundle.draftedEmails[0].recipientEmail, "ada@example.com");
});

test("B2 a draft whose recipient is not on the approved list is refused, naming the recipient", async () => {
  const drafts = [BOUND[0], { ...BOUND[1], recipientId: "c-9" }];
  await assert.rejects(readOf({ drafts }, APPROVED), refused(/^Draft 2 of this run is for contact c-9, which is not on the approved recipient list/));
  // The contact the host's send reads is contactId before recipientId: a contactId that is not approved is refused too.
  await assert.rejects(
    readOf({ drafts: [BOUND[0], { ...BOUND[1], contactId: "c-9" }] }, APPROVED),
    refused(/^Draft 2 of this run names two different contacts/),
  );
  await assert.rejects(
    readOf({ drafts: [BOUND[0], { ...BOUND[1], recipientId: undefined, contactId: "c-9" }] }, APPROVED),
    refused(/^Draft 2 of this run is for contact c-9, which is not on the approved recipient list/),
  );
});

test("B3 two drafts for one approved recipient are refused, naming the recipient", async () => {
  // The two drafts have their own ids, so the review could show both; both are for contact c-1.
  const drafts = [BOUND[0], { ...BOUND[1], recipientId: " c-1", recipientName: "Ada Lopez", recipientEmail: "ada2@example.com" }];
  await assert.rejects(readOf({ drafts }, APPROVED), refused(/^Drafts 1 and 2 of this run are both for Ada Lopez/));
  const sameEmail = [{ ...BOUND[0], recipientEmail: "" }, { ...BOUND[1], recipientId: "c-1", recipientName: "Ada Lopez", recipientEmail: "" }];
  await assert.rejects(readOf({ drafts: sameEmail }, listOf([{ contactId: "c-1", name: "Ada Lopez", email: "" }, { contactId: "c-2", name: "Ben Ito", email: "" }])), refused(/^Drafts 1 and 2 of this run are both for Ada Lopez/));
});

test("B4 an approved recipient without a draft is refused, naming the recipient", async () => {
  await assert.rejects(readOf({ drafts: [BOUND[1]] }, APPROVED), refused(/^The approved recipient Ada Lopez has no draft in this run/));
  // A contact the list names twice is one approved recipient: one draft for it is enough.
  const twice = listOf([...APPROVED.data.confirmedRecipients, { contactId: "c-1", name: "Ada Lopez", email: "ada@example.com" }]);
  assert.equal((await readOf({ drafts: BOUND }, twice)).recipients.length, 2);
});

test("B5 a draft whose recipient name is not the approved recipient's is refused, naming the recipient and the field", async () => {
  await assert.rejects(
    readOf({ drafts: [{ ...BOUND[0], recipientName: "Eve" }, BOUND[1]] }, APPROVED),
    refused(/^Draft 1 of this run, for Ada Lopez, has a recipient name that is not the approved recipient's/),
  );
  // White space around and inside the name is not part of it.
  const answer = await readOf({ drafts: [{ ...BOUND[0], recipientName: "  Ada   Lopez " }, BOUND[1]] }, APPROVED);
  assert.equal(answer.recipients[0].name, "Ada Lopez");
});

test("B6 the recipients and the drafts' recipient fields are the approved records, in draft order", async () => {
  // The draft step left out the name and wrote another company: the approved record fills the name and wins the company.
  const drafts = [
    { ...BOUND[1], recipientName: undefined, recipientCompany: "Ben's own company" },
    BOUND[0],
  ];
  const answer = await readOf({ drafts }, APPROVED);
  assert.deepEqual(answer.recipients, [
    { name: "Ben Ito", email: "ben@example.com", company: "Bento" },
    { name: "Ada Lopez", email: "ada@example.com", company: "Acme" },
  ]);
  assert.deepEqual(answer.draftBundle.draftedEmails, [{ ...BOUND[1], recipientName: "Ben Ito" }, BOUND[0]]);
  // A name the list gives as first and last name is joined; a company the list gives as company is taken.
  const split = listOf([
    { contactId: "c-1", firstName: "Ada", lastName: "Lopez", email: "ada@example.com", company: "Acme" },
    { contactId: "c-2", name: "Ben Ito", recipientEmail: "ben@example.com", companyName: "Bento" },
  ]);
  assert.deepEqual((await readOf({ drafts: BOUND }, split)).recipients, [
    { name: "Ada Lopez", email: "ada@example.com", company: "Acme" },
    { name: "Ben Ito", email: "ben@example.com", company: "Bento" },
  ]);
});

test("B7 a run without an approved recipient list, or with a list that is not one, is refused before anything is handed on", async () => {
  for (const confirmedRecipientsRef of [undefined, "", "  ", 4]) {
    const { ports } = makePorts({ saved: bundleOf({ drafts: BOUND }), approved: APPROVED });
    await assert.rejects(
      extensionTool({ input: { draftBundleRef: "bundle-1", confirmedRecipientsRef }, ports }),
      refused(/^The run names no approved recipient list/),
    );
  }
  const notALists = [
    null,
    listOf(APPROVED.data.confirmedRecipients, BUNDLE),
    { objectId: "list-1", type: LIST, data: { confirmedRecipients: "c-1" } },
    { objectId: "list-1", type: LIST, data: null },
  ];
  for (const approved of notALists) {
    await assert.rejects(readOf({ drafts: BOUND }, approved), refused(/^The approved recipient list of this run is not a recipient list/));
  }
  // A row that is not a recipient, or names no contact, cannot be bound to a draft.
  for (const row of ["c-2", null, { name: "Ben Ito", email: "ben@example.com" }, { contactId: " ", name: "Ben Ito" }]) {
    await assert.rejects(
      readOf({ drafts: BOUND }, listOf([APPROVED.data.confirmedRecipients[0], row])),
      refused(/^Approved recipient 2 of this run /),
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

// A confirmed recipient without an email address - cinatra-ai/email-drafting-agent#56. The draft step saves each draft
// under its recipientId (the contact id), beside an email that is empty for such a contact. The write-back reads an
// empty email as no email, so drafts with an empty email are not two drafts with one recipient email.
test("D30 drafts for contacts without an email address are handed on under their recipientId", async () => {
  const text = { subject: "Idea twelve", body: "Hello", status: "draft" };
  const drafts = [
    { recipientId: "c-1", recipientName: "Ada", recipientEmail: "ada@example.com", ...text },
    { recipientId: "c-2", recipientName: "Ben", recipientEmail: "", ...text, body: "Hello Ben" },
    { recipientId: "c-3", recipientName: "Cy", recipientEmail: "", ...text, body: "Hello Cy" },
  ];
  const answer = await readOf({ drafts });
  assert.deepEqual(answer.draftBundle.draftedEmails, drafts);
  // Without the recipientId, a draft with an empty email still names no recipient.
  await assert.rejects(
    readOf({ drafts: [drafts[0], { recipientName: "Ben", recipientEmail: "", ...text, body: "Hello Ben" }] }),
    refused(/^Draft 2 of this run names no recipient/),
  );
  // Two drafts under one recipientId are still refused, with or without an email.
  await assert.rejects(
    readOf({ drafts: [drafts[1], { ...drafts[2], recipientId: "c-2" }] }),
    refused(/^Drafts 1 and 2 of this run /),
  );
});
