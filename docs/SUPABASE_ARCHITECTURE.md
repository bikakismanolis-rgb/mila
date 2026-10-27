# Supabase architecture

The browser talks directly to Supabase. Every write goes through a `security definer` RPC that checks membership, privacy settings and rate limits; tables are readable only through Row Level Security.

## Message delivery

1. The sender's device fetches the public keys of every active device in the conversation (`conversation_device_keys`).
2. It encrypts the message with a fresh AES-256-GCM key and wraps that key once per device (`apps/web/src/e2ee.ts`).
3. `send_message` stores the ciphertext in `messages` and the wrapped keys in `message_keys`, after checking that every member with a device got a key. Plain text is rejected.
4. Postgres changes reach connected members over Realtime; each one fetches the message with only the keys addressed to its own devices.
5. Offline members fetch missed rows when they reconnect. A push notification (no message text) wakes them.
6. Typing indicators are ephemeral Broadcast events and are never stored.

## Service mapping

- Supabase Auth: email and password, Google. No phone field. A trigger on `auth.users` enforces the app-wide sign-up limit.
- Postgres: profiles, devices and public keys, conversations, memberships, requests, encrypted messages, wrapped keys, receipts, reactions, blocks, reports, rate-limit counters.
- Realtime: postgres changes for messages, receipts and memberships; Broadcast for typing.
- Storage, private buckets:
  - `message-media`: encrypted attachment blobs only (`application/octet-stream`, max 50 MB, migration 0016). Readable by conversation members through short-lived signed URLs; useless without the key inside the message.
  - `avatars`: a 256x256 JPEG redrawn on the device (no EXIF). Readable only by people who share an accepted conversation with the owner, and only the current photo.
- Row Level Security: only members read message rows; only the recipient reads their wrapped keys; `profiles` is readable only by its owner, everything else goes through RPCs that apply the privacy rules.

## Who sees what of a profile

| Viewer | Name | Photo, bio | Email |
| --- | --- | --- | --- |
| Stranger who typed your full email | yes | no | the one they typed |
| Someone you sent a request to | yes | no | no |
| Someone who sent you a request | yes | yes | no |
| Contact (accepted chat) or group member | yes | yes | if you allow it |

Search for strangers works only on the exact, full email, and only when the person allows "Everyone". Contacts can be found by part of their name.

## Contact discovery

The app parses explicitly selected CSV/vCard files locally and sends normalized SHA-256 email hashes. Plain SHA-256 email hashes are vulnerable to dictionary enumeration because email addresses have low entropy, so every hash counts against the daily lookup limit. A server-side keyed HMAC or OPRF design would be better.

## Still open

- Forward secrecy (Signal-style ratchet or MLS).
- Key-change warnings: the safety code exists, but the app does not yet alert you when a contact adds a device.
- Abuse tooling for reports. Encrypted content cannot be scanned; reports carry only what the reporter forwards.
