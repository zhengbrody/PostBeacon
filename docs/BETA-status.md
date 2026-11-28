# Beta status — what the agent does, and what waits for the owner

2026-11-28. One page for "what can a founder do on postbeacon.app today".

## Live in production

| Capability | State | How the founder uses it |
| --- | --- | --- |
| Read the product, build a fact ledger | live | Paste a URL |
| Rank every channel, recommend one | live | Marketing agent → Rank my channels |
| Write drafts and a schedule | live | Marketing agent → Run through to drafts |
| Truth check on every draft | live | Blocks copy and handoff until fixed |
| Publish | manual | Copy or open the composer, then record it |
| Measure at 24h and 72h | live | Enter the numbers you see |
| One product task per week | live | Today → This week's task |
| People to contact | live | Add a person, agent drafts, you send |
| Agent plan with every step in one place | live | Top of `/app` |

## Built and deployed, switched off

These are in the code and the production database. They stay off until the owner does
the steps listed. None of them can be turned on from this repository.

| Capability | Switch | What only the owner can do |
| --- | --- | --- |
| Scheduled posting to X and LinkedIn through Buffer | `BUFFER_PUBLISHING_ENABLED` | Register a Buffer OAuth app; set `BUFFER_CLIENT_ID`, `BUFFER_CLIENT_SECRET`, `BUFFER_REDIRECT_URI`, `BUFFER_TOKEN_ENCRYPTION_KEY` in Vercel; connect a real account; approve one exact test post. See `M26.C5-approved-buffer-scheduling.md` |
| Daily public-source research | `AGENT_RUNS_ENABLED`, `AGENT_MISSIONS_ENABLED` | Confirm both flags in Vercel; approve the paid search and model use. See `M26.C3-daily-research-pilot.md` |
| Reminder emails | `NEXT_PUBLIC_EMAIL_REMINDERS_ENABLED` | Configure Resend and a verified sender |
| Billing | Polar variables | Configure Polar; pricing is hidden during beta |

The current value of each production switch was not read for this page: the Vercel CLI
on the build machine is signed out.

## Not built, on purpose

- **Automatic messages to people.** The agent drafts; the founder sends. Automated
  unsolicited messages break the rules of the target communities and risk the founder's
  accounts.
- **Searching for people or contact details.**
- **Posting without an exact approval.** Buffer scheduling freezes the copy, account and
  time and needs a separate approval each time.
- **Deploying the founder's own product.** PostBeacon markets a product that is already
  running.

## Not verified on production

No real model request, saved project or mobile check was made on production for the
weekly task, the agent run or the contact list. Local and automated results are in
`M27.1-weekly-task.md` and `M27.2-outreach.md`.
