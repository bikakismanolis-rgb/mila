# Email Messenger

Messenger prototype whose public identity is an email address, never a required phone number. Email is used for authentication and discovery; chat traffic uses the app's own realtime backend.

## Run

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. In development the verification code is shown on screen (and in the API terminal). Use any valid email. Seed accounts such as `maria@example.com` can be found from Search.

## Included

- Email code login, JWT sessions, profiles and user search
- One-to-one conversations, message requests, accept/reject, block/report foundations
- Realtime messages, typing, delivered/read receipts and unread badges
- Photo/file attachments (15 MB local prototype limit) with conversation-member access checks
- Conversation menu with contact details, block and report actions
- Consent-based CSV/vCard contact matching using client-side email hashes
- Privacy settings and responsive mobile/desktop messenger UI
- JSON persistence for a zero-setup prototype
- An isolated WebCrypto AES-GCM prototype (`apps/web/src/crypto.ts`)

## Security status

This is a serious prototype, not an audited production messenger. Verification emails are not sent yet; the development API returns the code. JSON storage must be replaced with PostgreSQL, JWT should move to secure same-site cookies, uploads need scanning/object storage, and rate limiting needs a shared store.

The optional browser encryption module proves that ciphertext can be produced before transport and that keys remain client-side. It is **not multi-device E2E**: secure key agreement, identity verification, forward secrecy, prekeys, key rotation, group sender keys and recovery are not implemented. Replace this boundary with an audited Signal Protocol or MLS implementation before making E2E claims.

## Next production steps

1. PostgreSQL migrations and transactional repository layer.
2. Real email provider, hashed one-time codes, secure cookies and refresh-token rotation.
3. Signal/MLS library integration plus device verification and key transparency.
4. S3-compatible encrypted media upload, antivirus scanning and retention jobs.
5. Redis-backed rate limits, abuse review tooling, audit logs and observability.
6. Automated API/UI/security tests, accessibility audit, privacy policy and legal review.

The planned Supabase migration and initial RLS schema live in `docs/SUPABASE_ARCHITECTURE.md` and `supabase/migrations/0001_core.sql`.
