// Declared module of the drafting agent: hands the flow the drafts the run
// saved.
//
// The draft step saves the drafted emails as one draft bundle object and
// passes on only its reference. The flow calls this module through its read
// step, between the draft step and the filing of the bodies: the module reads
// the saved bundle through the objects port and returns it as `draftBundle`,
// with the drafts under `draftedEmails`, in the order the bundle saved them.
// The next step files each draft's `body` as its own email body, titled by its
// `subject`, for the host's review (cinatra-ai/cinatra#3089). The module also
// returns `recipients`: one { name, email, company } per draft, in draft order.
//
// The draft step writes each draft's recipient fields itself, so they say
// nothing about who may get the email: only the run's approved recipient list
// does. The module reads that list (the confirmedRecipientsRef the draft step
// reads too) through the objects port and binds each draft to exactly one
// approved recipient by its contact: the draft's contactId, else its
// recipientId, as the host's send reads it, against the row's contactId. A
// draft for a contact that is not on the list, a draft that names two
// different contacts, two drafts for one approved recipient, and an approved
// recipient without a draft are refused, naming the recipient: the draft step
// writes exactly one email per approved recipient, and a recipient left out
// would get no email without anyone seeing why. A draft whose own recipient
// email or name is not the approved recipient's is refused, naming the
// recipient and the field and never the address the draft wrote: the send
// mails the draft's own address. Emails are compared without the spaces
// around them and without letter case, names without extra white space; the
// company is not compared. The recipients handed on, and the recipient fields
// of each draft handed on, are the approved recipient's: its name (or first
// and last name), its email and its company (accountName, company or
// companyName), "" where the list holds none. A draft keeps a recipient field
// when the approved recipient has a value for it or the draft wrote it. A draft
// that wrote only a contactId, or wrote its contact with spaces around it, is handed
// on with the approved contact as its recipientId, exactly as the list writes it, so
// that the screen keys it and the send finds the same person; no recipient field a
// draft wrote survives but where the approved recipient holds no value for it. A
// message that names a recipient uses the approved record's name, else its approved
// address, and the checks that name one run only after every draft is bound: before
// that, a refusal names a draft by its position only. A run
// that names no list, a list that is not a recipient list, and a row that is
// not a recipient or names no contact are refused, so the run ends with the
// reason and nothing is filed. A contact that the list names twice is one
// approved recipient, its first row.
//
// Each draft keeps the fields the review and the write-back read, as the
// bundle saved them: the id, the recipient (with its company), the subject and
// the body, and carries the approved contact as its contactId: the filing step
// stores it on the filed body. A draft carries no campaign and no run id: the
// filing step takes the campaign from the flow's start and the run from the
// host, and refuses a draft that names either. Nothing else of the saved
// object is handed on. The module
// reads only data fields that the saved object holds itself: an object or a
// list with another prototype, an inherited field, or a getter or a setter is
// refused, and no getter is run. The port answers with data parsed from
// storage; a Proxy, which can report any field, is not one this module can
// tell apart from data.
//
// The review shows a draft's subject and body as text, and the write-back
// compares the edits with the saved text, so a draft whose subject or body is
// not text is refused. The screen keys each draft by its id, else its
// recipientId, else its recipient email, and the write-back matches the edits
// by id and by recipient email, so two drafts under one such key, two drafts
// with one recipient email, and the key __proto__ are refused. An empty email
// is no email to the write-back, so drafts for contacts without an email
// address, each under its own recipientId, are not one recipient email. The write-back
// keys a saved row by its id, else its recipientId, when that is non-empty
// text, else by its email; a draft whose id is present (not null) but is
// empty or not text could get an edit that the write-back drops or matches to
// no row, so it is refused, also when it names an email. The write-back
// edits the first list among draftedEmails, sequence, followups, drafts and
// confirmedRecipients that the bundle holds; a bundle where that list is not
// the one shown here is refused. The write-back refuses an answer of more
// than 2000 drafts, and the screen answers with every draft it shows, so a
// bundle of more than 2000 drafts is refused before any draft is read.
//
// A missing reference, an object that is not a draft bundle, a bundle with no
// drafts and a draft that names no recipient are refused by name too, so the
// run ends with the reason before the review instead of showing an empty or a
// different review.
//
// Neither the run nor the scope is ever in this file: the port admits only an
// object of this run or of a run it descends from. A refusal of the port, and
// any other failure of its read, reaches the caller unchanged. The module sets
// no time limit of its own on the read.

const DRAFT_BUNDLE_TYPE = "@cinatra-ai/campaigns:email-draft-bundle";
const RECIPIENTS_LIST_TYPE = "@cinatra-ai/campaigns:recipients";
const TEXT_FIELDS = ["id", "recipientId", "recipientName", "recipientEmail", "recipientCompany", "subject", "body", "status"];
// The order in which the screen takes a draft's key, and the lists the write-back looks for, in its order.
const KEY_FIELDS = ["id", "recipientId", "recipientEmail"];
const WRITE_BACK_LISTS = ["draftedEmails", "sequence", "followups", "drafts", "confirmedRecipients"];
const SHOWN_LISTS = ["draftedEmails", "drafts"];
// The most bodies the filing step takes in one call (MAX_MATERIALIZE_LIST_MEMBERS of the platform's
// artifact-materialize-shaper.ts). It is below the write-back's own bound of 2000 drafts per answer.
const MAX_FILED_DRAFTS = 50;

class ExtensionToolCallRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtensionToolCallRefusal";
  }
}

// The object's own fields as data, read from their descriptors (so no getter
// runs), or undefined when one of them is a getter or a setter.
const ownData = (value) => {
  const fields = new Map();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, "value")) return undefined;
    fields.set(key, descriptor.value);
  }
  return fields;
};

// A record is an object made by an object literal, by JSON parsing or with a
// null prototype, holding only data fields: its fields, or undefined. An
// array, a date, a map, an instance of a class and an object whose prototype
// is any other object are not records.
const recordOf = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  return ownData(value);
};

// A list is an array with the array prototype, holding only data entries: its
// length and its entry at an index (a hole reads as undefined), or undefined.
const listOf = (value) => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const fields = ownData(value);
  if (fields === undefined) return undefined;
  return { length: fields.get("length"), at: (index) => fields.get(String(index)) };
};

const nonEmpty = (value) => typeof value === "string" && value.trim() !== "";
const trimmedOrNone = (value) => (nonEmpty(value) ? value.trim() : undefined);
const textOrEmpty = (value) => (typeof value === "string" ? value.trim() : "");
const sameEmail = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
// The one comparable form of a name: one line, single spaces. Both sides of a name comparison take it, and the approved
// name is handed on in it, whichever fields the name was built from.
const oneLine = (text) => text.replace(/\s+/g, " ").trim();
const short = (text) => {
  const line = oneLine(text);
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
};

// A body as the host compares it: its UTF-8 bytes, as hex. Never the string, which can differ where the bytes do not.
const ENCODER = new TextEncoder();
const bytesKey = (text) => Array.from(ENCODER.encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("");

// The approved recipients by contact, in list order: { contact, name, email, company }. The first row of a contact is
// the approved one.
const approvedRecipients = (list) => {
  const notAList = () => new ExtensionToolCallRefusal("The approved recipient list of this run is not a recipient list.");
  const answer = list === null || list === undefined ? undefined : recordOf(list);
  if (answer === undefined || answer.get("type") !== RECIPIENTS_LIST_TYPE) throw notAList();
  const data = recordOf(answer.get("data"));
  if (data === undefined) throw notAList();
  const key = ["confirmedRecipients", "recipients"].find((field) => Array.isArray(data.get(field)));
  const rows = key === undefined ? undefined : listOf(data.get(key));
  if (rows === undefined) throw notAList();
  const byContact = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const fields = recordOf(rows.at(index));
    const contact = fields === undefined ? undefined : trimmedOrNone(fields.get("contactId"));
    if (contact === undefined) {
      throw new ExtensionToolCallRefusal(
        `Approved recipient ${index + 1} of this run names no contact, so no draft can be bound to it.`,
      );
    }
    if (byContact.has(contact)) continue;
    const name = oneLine(
      textOrEmpty(fields.get("name")) || [fields.get("firstName"), fields.get("lastName")].map(textOrEmpty).join(" "),
    );
    const email = textOrEmpty(fields.get("email")) || textOrEmpty(fields.get("recipientEmail"));
    const company =
      textOrEmpty(fields.get("accountName")) || textOrEmpty(fields.get("company")) || textOrEmpty(fields.get("companyName"));
    byContact.set(contact, { contact, name, email, company });
  }
  return byContact;
};

// How a person finds an approved recipient: its name, else its approved address, else its contact. Every message that
// names a recipient builds the name from the approved record, never from a field the draft wrote.
const approvedLabel = (recipient) => short(recipient.name || recipient.email || recipient.contact);

// A draft's contact, defined once and used everywhere: its contactId, else its recipientId (each trimmed), as the host's
// send reads it. A draft that names two different contacts has no one contact: `conflict` is true.
const draftContact = (fields) => {
  const contactId = trimmedOrNone(fields.get("contactId"));
  const recipientId = trimmedOrNone(fields.get("recipientId"));
  return {
    contact: contactId ?? recipientId,
    conflict: contactId !== undefined && recipientId !== undefined && contactId !== recipientId,
  };
};

export async function extensionTool({ input, ports }) {
  const ref = input?.draftBundleRef;
  const bundleRef = nonEmpty(ref) ? ref.trim() : undefined;
  if (bundleRef === undefined) {
    throw new ExtensionToolCallRefusal("The run names no saved draft bundle to show in the drafts review.");
  }

  const saved = await ports.objects.read({ objectId: bundleRef });
  const notABundle = () =>
    new ExtensionToolCallRefusal("The saved draft bundle of this run is not an email draft bundle.");
  const answer = saved === null || saved === undefined ? undefined : recordOf(saved);
  if (answer === undefined || answer.get("type") !== DRAFT_BUNDLE_TYPE) throw notABundle();
  const data = recordOf(answer.get("data"));
  if (data === undefined) throw notABundle();

  // The list the write-back edits: the first of its lists that is an array.
  const listKey = WRITE_BACK_LISTS.find((key) => Array.isArray(data.get(key)));
  if (listKey !== undefined && !SHOWN_LISTS.includes(listKey)) {
    throw new ExtensionToolCallRefusal(
      "The saved draft bundle of this run keeps its drafts in a list the drafts review does not show.",
    );
  }
  const rows = listKey === undefined ? { length: 0 } : listOf(data.get(listKey));
  if (rows === undefined) throw notABundle();
  if (rows.length === 0) {
    throw new ExtensionToolCallRefusal("The saved draft bundle of this run holds no drafts to review.");
  }
  if (rows.length > MAX_FILED_DRAFTS) {
    throw new ExtensionToolCallRefusal(
      `The saved draft bundle of this run holds ${rows.length} drafts, more than the ${MAX_FILED_DRAFTS} that one run can file for review. Draft for at most ${MAX_FILED_DRAFTS} recipients.`,
    );
  }

  // Each draft as the module hands it on, read as data; its position is all a refusal says of it until it is bound.
  const draftedEmails = [];
  const draftFields = [];
  for (let index = 0; index < rows.length; index += 1) {
    const position = index + 1;
    const fields = recordOf(rows.at(index));
    if (fields === undefined) {
      throw new ExtensionToolCallRefusal(`Draft ${position} of this run is not a draft, so the drafts review is not shown.`);
    }
    const id = fields.get("id");
    if (id !== undefined && id !== null && (typeof id !== "string" || id.length === 0)) {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run has an id that is empty or not text, so the drafts review is not shown.`,
      );
    }
    if (typeof fields.get("subject") !== "string" || typeof fields.get("body") !== "string") {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run has a subject or a body that is not text, so the drafts review is not shown.`,
      );
    }
    // The filing titles the body by the subject, and the host refuses a blank title (it trims, so does this).
    if (!nonEmpty(fields.get("subject"))) {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run has a blank subject, so the filing of its body is not possible. Give it a subject.`,
      );
    }
    const draft = {};
    for (const field of TEXT_FIELDS) {
      if (typeof fields.get(field) === "string") draft[field] = fields.get(field);
    }
    const followUpDay = fields.get("followUpDay");
    if (typeof followUpDay === "number" && Number.isFinite(followUpDay)) draft.followUpDay = followUpDay;
    draftedEmails.push(draft);
    draftFields.push(fields);
  }

  // Bind each draft to exactly one approved recipient, by its contact. Every check after this one names a recipient by
  // the approved record only.
  const listRef = trimmedOrNone(input?.confirmedRecipientsRef);
  if (listRef === undefined) {
    throw new ExtensionToolCallRefusal(
      "The run names no approved recipient list, so the drafts cannot be matched to the approved recipients.",
    );
  }
  const approved = approvedRecipients(await ports.objects.read({ objectId: listRef }));
  const draftByContact = new Map();
  const recipients = [];
  const approvedOf = [];
  for (const [index, draft] of draftedEmails.entries()) {
    const position = index + 1;
    const { contact, conflict } = draftContact(draftFields[index]);
    if (conflict) {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run names two different contacts, so it cannot be matched to one approved recipient.`,
      );
    }
    if (contact === undefined) {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run names no recipient: it has no contact (contactId or recipientId) to match the approved recipient list.`,
      );
    }
    const recipient = approved.get(contact);
    if (recipient === undefined) {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run is for a contact that is not on the approved recipient list.`,
      );
    }
    if (draftByContact.has(contact)) {
      throw new ExtensionToolCallRefusal(
        `Drafts ${draftByContact.get(contact)} and ${position} of this run are both for ${approvedLabel(recipient)}: write one draft per approved recipient.`,
      );
    }
    draftByContact.set(contact, position);
    if (draft.recipientEmail !== undefined && !sameEmail(draft.recipientEmail, recipient.email)) {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run, for ${approvedLabel(recipient)}, has a recipient email that is not the approved recipient's.`,
      );
    }
    if (draft.recipientName !== undefined && oneLine(draft.recipientName) !== oneLine(recipient.name)) {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run, for ${approvedLabel(recipient)}, has a recipient name that is not the approved recipient's.`,
      );
    }
    for (const [field, value] of [
      ["recipientName", recipient.name],
      ["recipientEmail", recipient.email],
      ["recipientCompany", recipient.company],
    ]) {
      if (value !== "" || draft[field] !== undefined) draft[field] = value;
    }
    // The screen keys a draft by its recipientId and the send reads its contact: the draft is handed on under the approved
    // contact exactly as the list writes it, whatever the draft wrote (padded, or only a contactId).
    draft.recipientId = recipient.contact;
    // The filing stores each member's contactId on its body (the host's list filing, memberDataFields), and the send reads it
    // there: it is the approved contact, written here without a model, never a field the draft wrote.
    draft.contactId = recipient.contact;
    approvedOf.push(recipient);
    recipients.push({ name: recipient.name, email: recipient.email, company: recipient.company });
  }
  for (const recipient of approved.values()) {
    if (!draftByContact.has(recipient.contact)) {
      throw new ExtensionToolCallRefusal(
        `The approved recipient ${approvedLabel(recipient)} has no draft in this run: write one draft per approved recipient.`,
      );
    }
  }

  // The checks of what the review and the filing do with the bound drafts.
  const byKey = new Map();
  const byEmail = new Map();
  const byBody = new Map();
  for (const [index, draft] of draftedEmails.entries()) {
    const position = index + 1;
    // The key the screen shows this draft under: the first of its key fields that the draft holds.
    const key = draft[KEY_FIELDS.find((field) => draft[field] !== undefined)];
    if (key === "__proto__") {
      throw new ExtensionToolCallRefusal(
        `Draft ${position} of this run has the id __proto__, which the drafts review cannot show.`,
      );
    }
    if (byKey.has(key)) {
      throw new ExtensionToolCallRefusal(
        `Drafts ${byKey.get(key)} and ${position} of this run have one id in the drafts review, so it is not shown.`,
      );
    }
    byKey.set(key, position);
    // The write-back reads an empty email as no email: drafts for contacts without one are told apart by their key.
    if (draft.recipientEmail !== undefined && draft.recipientEmail.length > 0) {
      if (byEmail.has(draft.recipientEmail)) {
        throw new ExtensionToolCallRefusal(
          `Drafts ${byEmail.get(draft.recipientEmail)} and ${position} of this run name one recipient email, so the drafts review is not shown.`,
        );
      }
      byEmail.set(draft.recipientEmail, position);
    }
    // The host refuses two bodies with the same bytes: they would be one artifact.
    const bodyKey = bytesKey(draft.body);
    if (byBody.has(bodyKey)) {
      const earlier = byBody.get(bodyKey);
      throw new ExtensionToolCallRefusal(
        `Drafts ${earlier.position} and ${position} of this run have the same body, so the filing would make them one email body: ${earlier.label} and ${approvedLabel(approvedOf[index])}. Change the body of one of them.`,
      );
    }
    byBody.set(bodyKey, { position, label: approvedLabel(approvedOf[index]) });
  }

  // The recipients the flow hands on are the approved recipients, one per draft and in draft order.
  return { ok: true, draftBundle: { draftedEmails }, recipients };
}
