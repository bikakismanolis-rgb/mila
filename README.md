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

Encryption needs a secure origin (`crypto.subtle`). `http://localhost` works; opening the dev server from your phone at `http://192.168…` does not, and the app says so. Use the deployed https site, or a tunnel, to test on a phone.

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

- Email and password sign-in, Google Sign-In, profiles with an optional photo
- People search that never lists strangers: they show up only for their exact, full email
- One-to-one and group conversations, message requests, accept and reject, blocking and reporting
- End-to-end encrypted messages and attachments (see below)
- Realtime messages, typing indicators, read receipts and unread badges
- Photo and file attachments up to 15 MB
- Rate limits on messages, new conversations, email lookups, sign-ups, uploads, reactions and reports
- Consent-based CSV and vCard contact matching using email hashes
- Privacy settings and a responsive mobile and desktop UI

## Tests

```bash
node scripts/test-e2ee.mjs            # encryption round trip and tamper checks
node scripts/test-webpush.mjs         # notification encryption against RFC 8291
supabase/tests/run.sh                 # every migration on a fresh Postgres, then RLS and limit tests
```

`supabase/tests/run.sh` needs a PostgreSQL 15+ server you can create databases on (set `PGHOST`, `PGPORT`, `PGUSER`). It applies all migrations to a fake Supabase (`supabase/tests/supabase_shim.sql`) and runs each `test_*.sql` as real users, through the same RPCs the browser calls.

## Security status

This is a working application, not an audited messenger. Be straight with users about the following.

**Messages are end-to-end encrypted, with a simple scheme and known limits.** Each device generates an ECDH P-256 key pair with WebCrypto; the private key is non-extractable and stays in IndexedDB. Every message gets a fresh AES-256-GCM key, which is wrapped separately for each recipient device (and the sender's other devices) using a key derived with ECDH + HKDF. The database stores only the ciphertext and the wrapped keys (`messages.ciphertext` with `encryption_version = 1`, and `message_keys`). Since migration 0010 the database refuses plain text. Attachments are encrypted the same way before upload; their name and type travel inside the encrypted message. All of it lives in `apps/web/src/e2ee.ts`, with no dependencies.

What it does not do, and what the app and privacy policy say:

- No forward secrecy. Someone who steals a device's private key and has kept the ciphertexts can read what was sent to that device. A Signal-style ratchet (or MLS) is the next step.
- A new device cannot read messages sent before it existed, and clearing a browser's site data destroys its key. Safari may clear site data on its own after 7 days without a visit (not for a PWA on the Home Screen).
- The server hands out public keys. Users who need certainty compare the 60-digit safety code under Contact details, in person.
- Metadata is not hidden: who talks to whom and when, attachment sizes, group names, reactions, profiles. Notifications carry no message text.
- Search over encrypted messages runs on the device, over what it has already loaded. Messages sent before 0010 stay as plain text until their sender removes them (Settings → Older messages).

**Contact matching uses plain SHA-256 email hashes.** Email addresses have low entropy, so these hashes fall to a dictionary attack. This obscures addresses, it does not protect them. A keyed HMAC with a secret that never reaches the client, behind an Edge Function, is the correct design.

## Rate limits

Every limit is a row in `public.rate_limit_rules` (action, window in seconds, maximum), so you can change one in the SQL editor without a deploy:

```sql
update public.rate_limit_rules set max_count = 50 where action = 'message' and window_seconds = 60;
```

| Action | Default |
| --- | --- |
| `message` | 30 a minute, 600 an hour, 3000 a day |
| `contact_request` (new conversation with someone) | 10 an hour, 30 a day, at most 30 waiting for an answer |
| Messages before a request is accepted | 3 |
| `user_lookup` (search by full email) | 30 an hour, 100 a day |
| `contact_import` / `contact_match` | 5 files, 1000 addresses a day |
| `signup` (whole app) | 60 an hour, 500 a day |
| `upload_media` / `upload_avatar` | 60 an hour and 300 a day / 20 a day |
| `reaction`, `report`, `group_create`, `group_add`, `device_register`, `avatar_change` | see the migration |

Supabase Auth has its own per-IP limits on top (Authentication → Rate Limits in the dashboard).

## Before launch

1. Custom SMTP. The built-in Supabase mailer only delivers to organisation members and allows two messages an hour.
2. Turn "Confirm email" back on. It is off for local testing, which lets anyone register an address they do not own.
3. Upload scanning is impossible for encrypted files by design; storage quotas and retention still need a decision.
4. Abuse review tooling for the reports table. Reported messages are encrypted, so a report can only carry what the reporter chooses to forward.
5. Accessibility audit and terms of use.
6. Forward secrecy for the encryption (see Security status).

## Account deletion

`delete_my_account()` erases the `auth.users` row outright — password, Google identity, sessions, and the email address are gone, and the address is freed for someone else to register. What survives is a single anonymised `profiles` row: name replaced with "Deleted user", email replaced with a synthetic address, photo and bio cleared, `deleted_at` set.

That tombstone exists so `messages.sender_id`, `conversations.created_by` and `reports` still have something to point at. Without it, deleting an account would take every message the person ever sent with it, gutting the other party's conversation.

The trade is real and belongs in the privacy policy: the server keeps someone's words after they asked to leave. A formal GDPR erasure request needs those messages deleted by hand.

`export_my_data()` returns the caller's profile, conversation list and own messages as JSON. It deliberately excludes the other party's messages — those are someone else's personal data.
