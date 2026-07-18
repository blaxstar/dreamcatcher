# Security

Dreamcatcher handles people's email, so security reports are taken seriously and
welcomed.

## Reporting a problem

If you find a vulnerability — or anything that could put a user's data at risk — please
email **dyxribo@blaxstar.net** with the details. A rough proof of concept helps a lot.

Please don't open a public issue for security problems; email first so it can be fixed
before it's public.

I'll acknowledge your report as quickly as I can, keep you posted on the fix, and credit
you if you'd like.

## What's in scope

- Anything that would let someone read a user's email or data they shouldn't.
- Anything that lets the app search Gmail beyond the sender-scoped job-alert queries.
- Auth/session issues, token handling, or the encryption of stored tokens.

## Good to know

- Emails are never stored — they're parsed in memory and discarded.
- Gmail searches are restricted to `from:` sender filters, enforced in
  `server/src/query.ts`.
- Google tokens are encrypted at rest (`server/src/crypto.ts`).
- Users can export or delete all of their data from Settings at any time.
