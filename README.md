# Dreamcatcher

A small, free tool that takes the pain out of job-alert emails.

Job boards flood your inbox with alerts. Dreamcatcher reads those alerts, pulls out
the individual listings, flags the ones that look like scams, and lines them up so you
can triage and apply without drowning. That's it. No accounts to pay for, no ads,
nothing to sell.

I built this because the last time I had to job-hunt, I wished something like it
existed. It's open source so you never have to wonder what it's doing with your email;
you can just read the code.

## The privacy promise, in plain words

Email is sensitive, so here's exactly how this is handled:

- **Read-only access.** Google only ever lets it _look_ at your mail. It can't send,
  delete, or change anything.
- **Only your job alerts.** The server is built so it can only search Gmail _by sender_
  (LinkedIn, Indeed, etc.). It cannot search your whole inbox — that's enforced in code
  ([`server/src/query.ts`](server/src/query.ts)), not just promised.
- **Your emails are never stored.** It reads an alert, grabs the job's title, company,
  and link, and throws the email away. Subjects, bodies, and senders are never saved.
- **What little it keeps is minimal:** the job listings it found, an opaque Gmail message
  ID (to avoid duplicates), and your Google name/email. The access token is
  **encrypted at rest** and deleted when you disconnect.
- **No humans, no trackers, no third parties.** Nobody reads your mail. There's no
  analytics, no ad network, and nothing is loaded from outside the server.
- **You're in control.** Download everything or delete everything, anytime, from
  Settings. Skipped jobs are auto-forgotten after 60 days.

The full policy is at [`/privacy`](web/public/privacy.html) (and it's written in the clearest, simplest, non-lawyer english i could muster).

## Run your own copy

The surest privacy is running it yourself; then your data never touches anyone else's
server.

Requirements: Node 18+ and a Google Cloud OAuth client (Gmail read-only scope).

```bash
git clone <your-fork-url> dreamcatcher
cd dreamcatcher
npm run install:all          # installs root, server, and web deps

cp .env.example .env         # then fill in the values below
npm run build                # build the web app + server
npm run start                # serves the app + API on the configured port
```

Set these in `.env`:

| Variable                                    | What it's for                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `JWT_SECRET`                                | Signs your login session. Use a long random string; I recommend the output from the command `openssl rand -hex 32` |
| `ENCRYPTION_KEY`                            | Encrypts stored Google tokens. Long random string (falls back to `JWT_SECRET` if unset).                           |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Your Google OAuth client.                                                                                          |
| `GOOGLE_REDIRECT_URI`                       | e.g. `https://yourdomain/auth/callback`.                                                                           |
| `COOKIE_SECURE`                             | `true` when serving over HTTPS.                                                                                    |
| `DB_PATH`                                   | Where the SQLite file lives.                                                                                       |

For development, `npm run dev` runs the API and the web app with hot reload.

## How it's built

- **`web/`** — the front end (TypeScript + Vite, no framework, no runtime dependencies).
- **`server/`** — a small Express API with SQLite (better-sqlite3). Talks to Gmail,
  scores listings, stores the bare minimum.
- **`server/tests/`** — the test suite (`npm test`), including the real Gmail parsers run
  against sanitized sample emails.

The pieces worth reading if you're checking the privacy claims:

- [`server/src/query.ts`](server/src/query.ts) — proves searches can only be by sender.
- [`server/src/gmail.ts`](server/src/gmail.ts) — shows emails are parsed in memory and
  discarded, never stored.
- [`server/src/crypto.ts`](server/src/crypto.ts) — token encryption at rest.
- [`server/src/db.ts`](server/src/db.ts) — every column that ever gets written.

## Contributing & security

Found a bug or a security issue? See [`SECURITY.md`](SECURITY.md). PRs and issues
welcome; especially anything that makes the privacy story tighter.

## License

MIT; do what you like with it. If it helps you land something, that's the whole point. :)
