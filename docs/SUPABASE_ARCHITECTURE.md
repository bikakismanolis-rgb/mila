# Supabase architecture decision

Supabase is the recommended managed backend for the MVP. It replaces the prototype JSON store and custom verification-code service without changing the product model.

## Message delivery

1. The client encrypts message content and attachments before upload once the Signal/MLS layer is integrated.
2. An authenticated database operation inserts the ciphertext into `messages` (the durable source of truth).
3. A database trigger emits a private Realtime Broadcast event on `conversation:<id>:messages`.
4. Connected recipients update immediately; offline recipients fetch missed rows from Postgres when they reconnect.
5. Typing indicators and presence are ephemeral Realtime events and are not stored as chat history.

This deliberately avoids using Broadcast as the only message store. Delivery is realtime, but history remains durable and queryable.

## Service mapping

- Supabase Auth: email OTP/magic link; no phone field.
- Postgres: profiles, memberships, requests, ciphertext messages, receipts, blocks and reports.
- Realtime private channels: message notifications, typing, read receipts and online presence.
- Storage private bucket: encrypted image/file blobs. Database attachment rows retain metadata and conversation ownership.
- Row Level Security: only conversation members can read message/attachment rows or subscribe to that conversation's private topic.
- Edge Functions or a small trusted API: contact matching, rate limits, moderation/report workflows and signed upload operations.

## Contact discovery

The prototype parses explicitly selected CSV/vCard files locally and sends normalized SHA-256 email hashes. For production, use a server-side keyed HMAC/OPRF-style design; plain SHA-256 email hashes are vulnerable to dictionary enumeration because email addresses have low entropy. Never upload the whole address book without explicit consent.

## Media

Use a private `message-media` bucket. Clients encrypt file bytes before upload, store only ciphertext in Storage, then insert an attachment row containing encrypted metadata. Short-lived signed URLs control download, while the client performs decryption.

## Required before launch

- Replace the WebCrypto demo key store with an audited Signal Protocol/MLS implementation.
- Add database functions for atomic conversation creation and message insertion.
- Add server-side rate limits, upload scanning, quotas and abuse tooling.
- Configure a production SMTP provider and custom OTP templates.
- Add automated RLS tests using two members plus an unrelated attacker account.
