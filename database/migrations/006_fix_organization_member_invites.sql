-- 006_fix_organization_member_invites.sql
-- Fixes unique constraint violation (organization_members_organization_id_email_key)
-- when inviting, adding, or syncing organization members.

CREATE OR REPLACE FUNCTION public.dochub_sync_authorization_snapshot(
  p_organization_id UUID,
  p_folders JSONB,
  p_users JSONB,
  p_groups JSONB,
  p_acl JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.dochub_org_role(p_organization_id, auth.uid());
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'organization_admin_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_folders) <> 'array' OR jsonb_typeof(p_users) <> 'array'
     OR jsonb_typeof(p_groups) <> 'array' OR jsonb_typeof(p_acl) <> 'array' THEN
    RAISE EXCEPTION 'invalid_authorization_snapshot' USING ERRCODE = '22023';
  END IF;

  -- 1. Align app_user_uid for existing members whose email matches an incoming item
  -- but has a different app_user_uid. This prevents duplicate email inserts when
  -- adding existing members or re-inviting.
  UPDATE public.organization_members m
  SET app_user_uid = u->>'id',
      display_name = COALESCE(NULLIF(trim(u->>'name'), ''), m.display_name),
      department = COALESCE(u->>'department', m.department),
      updated_at = NOW()
  FROM jsonb_array_elements(p_users) u
  WHERE m.organization_id = p_organization_id
    AND lower(m.email) = lower(u->>'email')
    AND m.app_user_uid <> u->>'id'
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members m2
      WHERE m2.organization_id = p_organization_id AND m2.app_user_uid = u->>'id'
    );

  -- 2. Upsert members. Using COALESCE(existing.app_user_uid, u->>'id') guarantees
  -- that any row with an existing email in this organization targets the existing
  -- row in ON CONFLICT (organization_id, app_user_uid), completely eliminating
  -- organization_members_organization_id_email_key duplicate violations.
  INSERT INTO public.organization_members(
    organization_id, user_id, app_user_uid, email, display_name, department,
    organization_role, status, updated_at
  )
  SELECT p_organization_id,
    CASE WHEN u->>'id' = 'u1' THEN auth.uid() ELSE existing.user_id END,
    COALESCE(existing.app_user_uid, u->>'id'),
    lower(u->>'email'),
    u->>'name',
    COALESCE(u->>'department', ''),
    CASE WHEN u->>'id' = 'u1' THEN 'owner' ELSE COALESCE(existing.organization_role, 'member') END,
    CASE WHEN COALESCE((u->>'active')::BOOLEAN, TRUE) THEN
      CASE WHEN (CASE WHEN u->>'id' = 'u1' THEN auth.uid() ELSE existing.user_id END) IS NULL THEN 'invited' ELSE 'active' END
    ELSE 'suspended' END,
    NOW()
  FROM jsonb_array_elements(p_users) u
  LEFT JOIN public.organization_members existing
    ON existing.organization_id = p_organization_id AND lower(existing.email) = lower(u->>'email')
  WHERE u->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' AND COALESCE(u->>'email', '') <> ''
  ON CONFLICT (organization_id, app_user_uid) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    department = EXCLUDED.department,
    status = EXCLUDED.status,
    user_id = COALESCE(public.organization_members.user_id, EXCLUDED.user_id),
    updated_at = NOW();

  INSERT INTO public.organization_groups(organization_id, app_group_uid, name, description, updated_at)
  SELECT p_organization_id, g->>'id', g->>'name', COALESCE(g->>'description', ''), NOW()
  FROM jsonb_array_elements(p_groups) g
  WHERE g->>'id' ~ '^[A-Za-z0-9_-]{1,100}$'
  ON CONFLICT (organization_id, app_group_uid) DO UPDATE SET
    name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW();

  INSERT INTO public.organization_folders(
    organization_id, folder_uid, parent_uid, name, description,
    inherit_permissions, deleted_at, created_by, updated_at
  )
  SELECT p_organization_id, f->>'id', NULLIF(f->>'parentId', ''), f->>'name',
    COALESCE(f->>'description', ''), COALESCE((f->>'inherit')::BOOLEAN, (f->>'parentId') IS NOT NULL),
    NULLIF(f->>'deletedAt', '')::TIMESTAMPTZ, auth.uid(), NOW()
  FROM jsonb_array_elements(p_folders) f
  WHERE f->>'id' ~ '^[A-Za-z0-9_-]{1,100}$'
  ON CONFLICT (organization_id, folder_uid) DO UPDATE SET
    parent_uid = EXCLUDED.parent_uid, name = EXCLUDED.name, description = EXCLUDED.description,
    inherit_permissions = EXCLUDED.inherit_permissions, deleted_at = EXCLUDED.deleted_at, updated_at = NOW();

  DELETE FROM public.organization_group_members gm
  USING public.organization_groups g
  WHERE gm.group_id = g.id AND g.organization_id = p_organization_id;
  INSERT INTO public.organization_group_members(group_id, member_id)
  SELECT g.id, m.id
  FROM jsonb_array_elements(p_users) u
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(u->'groupIds', '[]'::jsonb)) AS gu(group_uid)
  JOIN public.organization_members m ON m.organization_id = p_organization_id AND (m.app_user_uid = u->>'id' OR lower(m.email) = lower(u->>'email'))
  JOIN public.organization_groups g ON g.organization_id = p_organization_id AND g.app_group_uid = gu.group_uid;

  DELETE FROM public.folder_acl_entries WHERE organization_id = p_organization_id;
  INSERT INTO public.folder_acl_entries(
    organization_id, folder_uid, principal_type, member_id, group_id, role, created_by
  )
  SELECT p_organization_id, a->>'resourceId',
    CASE a->>'principalType' WHEN 'user' THEN 'member' ELSE 'group' END,
    CASE WHEN a->>'principalType' = 'user' THEN m.id END,
    CASE WHEN a->>'principalType' = 'group' THEN g.id END,
    a->>'role', auth.uid()
  FROM jsonb_array_elements(p_acl) a
  LEFT JOIN public.organization_members m
    ON m.organization_id = p_organization_id AND (m.app_user_uid = a->>'principalId' OR lower(m.email) = lower((SELECT u2->>'email' FROM jsonb_array_elements(p_users) u2 WHERE u2->>'id' = a->>'principalId')))
  LEFT JOIN public.organization_groups g
    ON g.organization_id = p_organization_id AND g.app_group_uid = a->>'principalId'
  WHERE a->>'role' IN ('viewer','contributor','editor','manager','owner')
    AND ((a->>'principalType' = 'user' AND m.id IS NOT NULL)
      OR (a->>'principalType' = 'group' AND g.id IS NOT NULL));

  UPDATE public.documents_index
    SET organization_id = p_organization_id
    WHERE user_id = auth.uid() AND organization_id IS NULL;
END;
$$;
