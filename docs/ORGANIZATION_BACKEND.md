# Organization Drive backend

`/api/organization` runs in Node locally and as a Vercel function. Configure
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_OAUTH_CLIENT_ID and
GOOGLE_OAUTH_CLIENT_SECRET on the server. Never include these secrets in client
assets. Optional DOCHUB_TOKEN_KEY supplies an independent encryption key;
otherwise the service key is used as encryption key material (rotation requires
owners to reconnect).

Migration 005 stores authenticated encrypted owner refresh tokens and upload
sessions in tables with no anon/authenticated access. Connect verifies the Google
identity matches the organization owner. The owner must sign in again with
offline consent to supply provider_refresh_token. No passwords are shared.

Members read a permission-filtered owner workspace plus the document index.
Each file request checks active membership and folder permission before using
the owner's Drive connection. Uploads use a short-lived Google resumable session
URL in the authenticated browser and fall back to authenticated 2 MiB server
chunks when a direct transfer is blocked. The owner's OAuth token never reaches
the browser. Every server chunk and status check rechecks permission. Maximum
file size remains 250 MiB.

Current boundaries requiring follow-up validation:
- Real owner re-consent and two-account Drive testing are required.
- Members can upload, read, rename and save edited copies. Organization structure,
  ACL and moving files remain owner workflows; unsupported writes return errors.
- Changes made directly in Drive and old externally granted Drive shares are not
  revoked by this backend. Existing external grants must be reconciled separately.
- Shared data refreshes on page reload. No live multi-user update subscription.
- Interrupted upload sessions expire after 24 hours; automatic garbage collection
  and resumable recovery after a page reload are not implemented.
- Vercel runtime streaming and long video playback require deployment tests.

Do not claim production readiness until these release checks pass.
