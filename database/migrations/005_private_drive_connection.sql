-- Only the application server can read these credentials.
CREATE TABLE public.organization_drive_connections (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id),
 owner_id UUID NOT NULL REFERENCES auth.users(id),
 encrypted_refresh_token TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.organization_drive_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_drive_connections FROM anon,authenticated;
GRANT ALL ON public.organization_drive_connections TO service_role;
CREATE TABLE public.organization_uploads (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 user_id UUID NOT NULL REFERENCES auth.users(id),
 doc_uid TEXT NOT NULL, folder_uid TEXT NOT NULL, name TEXT NOT NULL, ext TEXT NOT NULL,
 mime TEXT NOT NULL, bytes BIGINT NOT NULL, encrypted_url TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '1 hour'
);
ALTER TABLE public.organization_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_uploads FROM anon,authenticated;
GRANT ALL ON public.organization_uploads TO service_role;
-- Employee writes go through the server; clients cannot replace Drive file IDs.
DROP POLICY IF EXISTS "Contributors can create documents" ON public.documents_index;
DROP POLICY IF EXISTS "Editors can update documents" ON public.documents_index;
DROP POLICY IF EXISTS "Managers can delete documents" ON public.documents_index;
CREATE POLICY "Owner maintains document index" ON public.documents_index FOR ALL TO authenticated
 USING(organization_id IS NOT NULL AND public.dochub_org_role(organization_id)='owner')
 WITH CHECK(organization_id IS NOT NULL AND public.dochub_org_role(organization_id)='owner');
