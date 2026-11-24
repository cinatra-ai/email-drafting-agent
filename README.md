# Email Drafting Agent

Write a personalized first-touch email for every recipient on your campaign list. The agent reads the campaign context — your offering, call to action, and any supporting brand or product materials — and produces one tailored subject line and body per recipient, ready for your review before anything goes out.

**Install:** add `@cinatra-ai/email-drafting-agent` as a dependency in your Cinatra workspace. Its only required runtime dependency is `@cinatra-ai/email-artifacts`, which supplies the email body artifact type. No separate review or audit agent is needed — Cinatra reviews each drafted body itself.

**Configure:** provide a `confirmedRecipientsRef` (the id of the saved, approved recipient list). Every input carries a default; `agent_run_id` is injected by the Cinatra runtime.

**Usage:** the agent reads the recipients from the saved list the reference names and the pinned context it is handed, drafts one personalized email per recipient, files each body as its own email body, then pauses while Cinatra opens one review per body, in draft order. The run goes on once the review is done. With no approved recipient list, the run stops before drafting and says so in a plain sentence.

**API contract:** inputs — `confirmedRecipientsRef`, `contextSlotBindings` (pinned context entries), `offeringCompanyWebsite`, `callToAction`, `senderName`, `campaignId`, `draftBundleRef`, `agent_run_id`. Outputs — `draftBundle`, `draftBundleTitle`, `userResponse` (your review answer), `draftBundleRef` (the saved draft bundle), `recipients` (name, email and company per draft), `approvedBodyArtifacts` (the reviewed email bodies, one `{artifactId, representationRevisionId}` per draft), `callToAction`.

**Troubleshooting:** if no body is filed for review, verify that `@cinatra-ai/email-artifacts` is installed in your workspace. A run files at most 50 bodies, each draft needs a subject, and no two drafts may have the same body.

## Works with

- Email outreach pipelines on Cinatra

## Capabilities

- Draft one personalized initial email per recipient on the campaign list
- Personalize each subject line and body to the recipient's name, title, and company
- Ground every draft in the campaign's offering, call-to-action, and supporting context
- File each drafted body as its own email body and pause for its review before the batch advances to the next step
- Return the recipients and the reviewed bodies for the next step
