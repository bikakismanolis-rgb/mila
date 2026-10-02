# Email Messenger

A messenger whose public identity is an email address, never a required phone number. Email is used for authentication and discovery; chat traffic runs on Supabase.

## Run

Requirements: Node.js 20+ and a Supabase project.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Copy `.env.example` to `apps/web/.env.local` and fill in your Supabase URL and anon key. Apply everything in `supabase/migrations/` in order through the Supabase SQL editor.

## Architecture

The browser talks directly to Supabase. There is no application server.

- **Auth** — Supabase Auth, email and password plus Google Sign-In.
- **Data** — Postgres, with Row Level Security as the only access control.
- **Realtime** — Postgres changes for messages and receipts, Broadcast for typing.
- **Media** — the private `message-media` Storage bucket, read through short-lived signed URLs.

Reads and writes go through `security definer` RPCs rather than direct table access, so privacy rules and multi-table joins stay in the database. `apps/web/src/data.ts` is the single boundary between the UI and Supabase.

The prototype Express backend has been removed. Nothing replaced it, because nothing needed to.

## Shipping targets

One web build serves all four channels — see `docs/DISTRIBUTION.md` for the full steps and prerequisites.

| Target | Command | Needs |
| --- | --- | --- |
| Browser + installable PWA | `npm run build` | nothing |
| Android | `npm run android` | Android Studio, Play Console ($25 once) |
| iOS | `npm run ios` | a Mac with Xcode, Apple Developer ($99/yr) |
| Desktop | `npm run desktop:build` | Rust toolchain |

`apps/web/src/platform.ts` is where the app figures out which of those it is running inside. It matters mostly for auth redirects: on native, `window.location.origin` is `capacitor://localhost`, which is useless as a redirect target, so `VITE_PUBLIC_SITE_URL` takes over.

## Included

- Email and password sign-in, Google Sign-In, profiles and user search
- One-to-one conversations, message requests, accept and reject, blocking and reporting
- Realtime messages, typing indicators, read receipts and unread badges
- Photo and file attachments up to 15 MB
- Consent-based CSV and vCard contact matching using email hashes
- Privacy settings and a responsive mobile and desktop UI
- Group conversations, replies, reactions, message search, delete for me or for everyone
- Web Push notifications
- Rate limits, account suspension and a moderation toolkit (`docs/MODERATION.md`)
- Privacy policy and terms of use in Greek and English, at `/privacy` and `/terms`

## Tests

```bash
npm run typecheck
npm run test:db     # every migration, then 82 security checks, on a local Postgres
npm run test:push   # the Web Push encryption against the RFC 8291 test vector
```

`test:db` needs a plain Postgres it can create a database in (it drops and
recreates `mila_test`), configured through the usual `PGHOST`, `PGPORT`,
`PGUSER` and `PGPASSWORD`. `supabase/tests/supabase_shim.sql` stands in for the
parts of Supabase the migrations expect: the roles, `auth.uid()`, the storage
schema and `pg_net`. Never point it at the real project.

The security checks play out two people talking and a third account trying to
get in: reading, sending, joining, reacting, deleting, forging receipts,
attaching someone else's file, reaching the push keys or the moderation schema.
They also cover the rate limits, suspension and account deletion. GitHub runs
all three commands on every push (`.github/workflows/ci.yml`).

## Security status

This is a working application, not an audited messenger. Be straight with users about the following.

**Messages are not end-to-end encrypted.** They are stored in Postgres in plain text and anyone with database access can read them. The `messages.ciphertext` column and `encryption_version` flag exist so encryption can be added later without a migration; version 0 means plain text. The settings screen states this plainly. Do not claim otherwise anywhere in the product.

Adding real end-to-end encryption means key agreement, identity verification, forward secrecy, key rotation and a recovery story — and in a browser, an answer for what happens when someone clears their site data. Use an audited Signal Protocol or MLS implementation when that work starts.

**Contact matching uses plain SHA-256 email hashes.** Email addresses have low entropy, so these hashes fall to a dictionary attack. This obscures addresses, it does not protect them. A keyed HMAC with a secret that never reaches the client, behind an Edge Function, is the correct design.

## Before launch

The step-by-step list, in Greek, is `docs/NEXT-STEPS.md`. In short:

1. Apply migration `0010_launch_hardening.sql`.
2. Custom SMTP. The built-in Supabase mailer only delivers to organisation members and allows two messages an hour.
3. Turn "Confirm email" on, and set the minimum password length to 8.
4. Fill in the controller's name, address, country and contact email in the four legal pages.

Done in code: rate limits, storage quota and file-type allowlist, RLS tests,
moderation tooling, push notifications, privacy policy and terms, security
headers. Still open: upload virus scanning, CAPTCHA on signup, error
monitoring, an accessibility audit.

## Account deletion

`delete_my_account()` erases the `auth.users` row outright — password, Google identity, sessions, and the email address are gone, and the address is freed for someone else to register. What survives is a single anonymised `profiles` row: name replaced with "Deleted user", email replaced with a synthetic address, photo and bio cleared, `deleted_at` set.

That tombstone exists so `messages.sender_id`, `conversations.created_by` and `reports` still have something to point at. Without it, deleting an account would take every message the person ever sent with it, gutting the other party's conversation.

The trade is real and belongs in the privacy policy: the server keeps someone's words after they asked to leave. A formal GDPR erasure request needs those messages deleted by hand.

`export_my_data()` returns the caller's profile, conversation list and own messages as JSON. It deliberately excludes the other party's messages — those are someone else's personal data.
