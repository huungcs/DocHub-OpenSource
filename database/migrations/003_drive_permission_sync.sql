-- Only grants recorded here are managed by DocHub; external shares are untouched.
CREATE TABLE IF NOT EXISTS public.drive_permission_links (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 drive_file_id TEXT NOT NULL,
 email TEXT NOT NULL,
 permission_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('reader','writer')),
 PRIMARY KEY(organization_id,drive_file_id,email)
);
ALTER TABLE public.drive_permission_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Organization admins manage Drive grants" ON public.drive_permission_links
 FOR ALL TO authenticated USING(public.dochub_org_role(organization_id) IN ('owner','admin'))
 WITH CHECK(public.dochub_org_role(organization_id) IN ('owner','admin'));

CREATE OR REPLACE FUNCTION public.dochub_drive_recipients(p_organization_id UUID,p_folder_uid TEXT)
RETURNS TABLE(email TEXT,role TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF public.dochub_org_role(p_organization_id) NOT IN ('owner','admin') THEN
   RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 WITH RECURSIVE chain AS (
 SELECT f.folder_uid,f.parent_uid,f.inherit_permissions,0 depth FROM public.organization_folders f
 WHERE f.organization_id=p_organization_id AND f.folder_uid=p_folder_uid AND f.deleted_at IS NULL
 UNION ALL
 SELECT f.folder_uid,f.parent_uid,f.inherit_permissions,c.depth+1 FROM chain c
 JOIN public.organization_folders f ON f.organization_id=p_organization_id AND f.folder_uid=c.parent_uid
 WHERE c.inherit_permissions AND c.depth<100 AND f.deleted_at IS NULL
 ), recipients AS (
 SELECT m.email,CASE WHEN m.organization_role IN ('owner','admin') THEN 50
 ELSE COALESCE(MAX(public.dochub_role_weight(a.role)),0) END weight
 FROM public.organization_members m
 LEFT JOIN public.folder_acl_entries a ON a.organization_id=m.organization_id
 AND a.folder_uid IN(SELECT c.folder_uid FROM chain c)
 AND (a.member_id=m.id OR a.group_id IN(SELECT gm.group_id FROM public.organization_group_members gm WHERE gm.member_id=m.id))
 WHERE m.organization_id=p_organization_id AND m.status IN ('active','invited')
 AND EXISTS(SELECT 1 FROM chain)
 GROUP BY m.id,m.email,m.organization_role
 ) SELECT lower(r.email),CASE WHEN r.weight>=30 THEN 'writer' ELSE 'reader' END
 FROM recipients r WHERE r.weight>=10;
END $$;
REVOKE ALL ON FUNCTION public.dochub_drive_recipients(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dochub_drive_recipients(UUID,TEXT) TO authenticated;
NOTIFY pgrst,'reload schema';
