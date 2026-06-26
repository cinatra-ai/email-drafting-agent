# Email Drafting Agent

Write a personalized first-touch email for every recipient on your campaign list. The agent reads the campaign context — your offering, call to action, and any supporting brand or product materials — and produces one tailored subject line and body per recipient, ready for your review before anything goes out.

**Install:** add `@cinatra-ai/email-drafting-agent` as a dependency in your Cinatra workspace. The `@cinatra-ai/auditor-agent` and `@cinatra-ai/reviewer-agent` packages are required runtime dependencies and must be installed alongside it.

**Configure:** provide a `campaignId` (UUID string) and a `confirmedRecipients` array (each entry carries the recipient's name, title, company, and email address). The `agent_run_id` field is injected by the Cinatra runtime and does not need to be set manually.

**Usage:** invoke the Email Drafting flow with a `campaignId` and `confirmedRecipients`. The agent generates one personalized subject line and email body per recipient, then pauses at a human review screen so you can read every draft before the campaign advances. Approve the batch to release it; any rejection stops the flow and returns your response for the caller to handle.

**API contract:** inputs — `campaignId` (string, UUID format), `confirmedRecipients` (array of recipient objects), `agent_run_id` (string, injected by the runtime). Outputs — `draftBundle` (object containing the generated draft emails), `userResponse` (string, the reviewer's approval or rejection response).

**Troubleshooting:** if the review screen does not appear, verify that `@cinatra-ai/reviewer-agent` is installed and its field renderer is registered in your workspace. If drafts are missing or empty, confirm that `confirmedRecipients` is a non-empty array and that `campaignId` is a valid UUID.

## Works with

- Email outreach pipelines on Cinatra

## Capabilities

- Draft one personalized initial email per recipient on the campaign list
- Personalize each subject line and body to the recipient's name, title, and company
- Ground every draft in the campaign's offering, call-to-action, and supporting context
- Pause for human review and approval before the batch advances to the next step
- Return the full draft bundle as a single reviewable set
