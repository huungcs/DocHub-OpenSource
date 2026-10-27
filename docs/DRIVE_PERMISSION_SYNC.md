# Drive permission sync — staged implementation

Migration 003 adds server-derived recipients and a ledger of application-managed
permission IDs. Administrators explicitly enable synchronization in settings.
No public/domain grants are created and external grants are not adopted or removed.

Viewer/contributor map to Reader. Editor/manager/owner map to Writer (not Drive
ownership). Writer permits editing outside DocHub and is not equivalent to the
fine-grained application roles. Invitations can receive grants before first login.

Synchronization runs after workspace persistence and admin-owned uploads. Only
documents indexed as uploaded by the current administrator are reconciled.
Failures are surfaced; this is not a background organization-wide worker. Other
uploaders' files and offline revocation need an owner-token backend/queue.

Remaining release gates:
- organization-shared workspace metadata instead of per-user snapshots;
- multi-account real Drive tests, including drive.file per-file authorization;
- external/inherited Drive grants reconciliation (removing a direct grant cannot
  revoke access inherited from a Drive parent);
- durable permission queue, token refresh and cross-uploader reconciliation;
- database RLS tests and failure/recovery tests for partially recorded grants.

Do not advertise the full employee onboarding flow as production-ready yet.
