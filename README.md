# Email Drafting Agent

Write a personalized first-touch email for every recipient on your campaign list. The agent reads the campaign context — your offering, call to action, and any supporting brand or product materials — and produces one tailored subject line and body per recipient, ready for your review before anything goes out.

**Install:** add `@cinatra-ai/email-drafting-agent` as a dependency in your Cinatra workspace. Its only required runtime dependency is `@cinatra-ai/email-artifacts`, which supplies the email artifact type and the draft-review screen. No separate review or audit agent is needed — Cinatra provides it.

**Configure:** provide a `confirmedRecipientsRef` (the id of the saved, approved recipient list). Every input carries a default; `agent_run_id` is injected by the Cinatra runtime.

**Usage:** the agent reads the recipients from the saved list the reference names and the pinned context it is handed, drafts one personalized email per recipient, then pauses at a review screen that shows the drafts as email bodies. Approve to release the batch; a rejection stops the flow. With no approved recipient list, the run stops before drafting and says so in a plain sentence.

**API contract:** inputs — `confirmedRecipientsRef`, `contextSlotBindings` (pinned context entries), `offeringCompanyWebsite`, `callToAction`, `senderName`, `campaignId`, `draftBundleRef`, `agent_run_id`. Outputs — `draftBundle`, `draftBundleTitle`, `draftBundleDocument` (the reviewed drafts as Markdown, materialized as the email artifact), `userResponse` (your review answer), `draftBundleRef` (the saved draft bundle).

**Troubleshooting:** if the review screen does not appear, verify that `@cinatra-ai/email-artifacts` is installed and its draft-review renderer is registered in your workspace.

## Works with

- Email outreach pipelines on Cinatra

## Capabilities

- Draft one personalized initial email per recipient on the campaign list
- Personalize each subject line and body to the recipient's name, title, and company
- Ground every draft in the campaign's offering, call-to-action, and supporting context
- Pause for human review and approval before the batch advances to the next step
- Return the full draft bundle as a single reviewable set
