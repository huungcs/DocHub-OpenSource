-- DocHub production authorization model.
-- The browser may render permissions, but PostgreSQL is the authority.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  app_user_uid TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  organization_role TEXT NOT NULL DEFAULT 'member'
    CHECK (organization_role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, app_user_uid),
  UNIQUE (organization_id, email),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organization_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_group_uid TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, app_group_uid),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.organization_group_members (
  group_id UUID NOT NULL REFERENCES public.organization_groups(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.organization_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.organization_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  folder_uid TEXT NOT NULL CHECK (folder_uid ~ '^[A-Za-z0-9_-]{1,100}$'),
  parent_uid TEXT,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  inherit_permissions BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, folder_uid),
  FOREIGN KEY (organization_id, parent_uid)
    REFERENCES public.organization_folders(organization_id, folder_uid)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK ((folder_uid = 'all' AND parent_uid IS NULL) OR folder_uid <> 'all')
);

CREATE TABLE IF NOT EXISTS public.folder_acl_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  folder_uid TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('member', 'group')),
  member_id UUID REFERENCES public.organization_members(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.organization_groups(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'contributor', 'editor', 'manager', 'owner')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, folder_uid)
    REFERENCES public.organization_folders(organization_id, folder_uid) ON DELETE CASCADE,
  CHECK (
    (principal_type = 'member' AND member_id IS NOT NULL AND group_id IS NULL)
    OR (principal_type = 'group' AND group_id IS NOT NULL AND member_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_folder_acl_member
  ON public.folder_acl_entries(organization_id, folder_uid, member_id)
  WHERE principal_type = 'member';
CREATE UNIQUE INDEX IF NOT EXISTS uq_folder_acl_group
  ON public.folder_acl_entries(organization_id, folder_uid, group_id)
  WHERE principal_type = 'group';
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_email ON public.organization_members(lower(email));
CREATE INDEX IF NOT EXISTS idx_org_folders_parent ON public.organization_folders(organization_id, parent_uid);
CREATE INDEX IF NOT EXISTS idx_acl_folder ON public.folder_acl_entries(organization_id, folder_uid);
CREATE INDEX IF NOT EXISTS idx_group_members_member ON public.organization_group_members(member_id);

-- Fix the v1 upsert target and attach document metadata to an organization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_index_user_doc
  ON public.documents_index(user_id, doc_uid);
ALTER TABLE public.documents_index
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_documents_index_org_folder
  ON public.documents_index(organization_id, parent_folder_id);

CREATE OR REPLACE FUNCTION public.dochub_role_weight(p_role TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE p_role
    WHEN 'viewer' THEN 10
    WHEN 'contributor' THEN 20
    WHEN 'editor' THEN 30
    WHEN 'manager' THEN 40
    WHEN 'owner' THEN 50
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.dochub_is_org_member(p_organization_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = p_user_id
      AND m.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.dochub_org_role(p_organization_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT m.organization_role FROM public.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = p_user_id
      AND m.status = 'active'
    LIMIT 1
  ), 'none');
$$;

CREATE OR REPLACE FUNCTION public.dochub_effective_folder_role(
  p_organization_id UUID,
  p_folder_uid TEXT,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE member_row AS (
    SELECT id, organization_role
    FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = p_user_id
      AND status = 'active'
    LIMIT 1
  ), folder_chain AS (
    SELECT f.folder_uid, f.parent_uid, f.inherit_permissions, 0 AS depth
    FROM public.organization_folders f
    WHERE f.organization_id = p_organization_id
      AND f.folder_uid = p_folder_uid
      AND f.deleted_at IS NULL
    UNION ALL
    SELECT parent.folder_uid, parent.parent_uid, parent.inherit_permissions, child.depth + 1
    FROM folder_chain child
    JOIN public.organization_folders parent
      ON parent.organization_id = p_organization_id
     AND parent.folder_uid = child.parent_uid
     AND parent.deleted_at IS NULL
    WHERE child.inherit_permissions
      AND child.depth < 100
  ), applicable AS (
    SELECT acl.role
    FROM folder_chain chain
    JOIN public.folder_acl_entries acl
      ON acl.organization_id = p_organization_id
     AND acl.folder_uid = chain.folder_uid
    CROSS JOIN member_row member
    WHERE (acl.principal_type = 'member' AND acl.member_id = member.id)
       OR (acl.principal_type = 'group' AND EXISTS (
         SELECT 1 FROM public.organization_group_members gm
         WHERE gm.group_id = acl.group_id AND gm.member_id = member.id
       ))
  ), best AS (
    SELECT role FROM applicable ORDER BY public.dochub_role_weight(role) DESC LIMIT 1
  )
  SELECT CASE
    WHEN (SELECT organization_role FROM member_row) IN ('owner', 'admin') THEN 'owner'
    ELSE COALESCE((SELECT role FROM best), 'none')
  END;
$$;

CREATE OR REPLACE FUNCTION public.dochub_can_folder_action(
  p_organization_id UUID,
  p_folder_uid TEXT,
  p_action TEXT,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_action
    WHEN 'read' THEN public.dochub_role_weight(public.dochub_effective_folder_role(p_organization_id, p_folder_uid, p_user_id)) >= 10
    WHEN 'download' THEN public.dochub_role_weight(public.dochub_effective_folder_role(p_organization_id, p_folder_uid, p_user_id)) >= 10
    WHEN 'create' THEN public.dochub_role_weight(public.dochub_effective_folder_role(p_organization_id, p_folder_uid, p_user_id)) >= 20
    WHEN 'edit' THEN public.dochub_role_weight(public.dochub_effective_folder_role(p_organization_id, p_folder_uid, p_user_id)) >= 30
    WHEN 'move' THEN public.dochub_role_weight(public.dochub_effective_folder_role(p_organization_id, p_folder_uid, p_user_id)) >= 40
    WHEN 'delete' THEN public.dochub_role_weight(public.dochub_effective_folder_role(p_organization_id, p_folder_uid, p_user_id)) >= 40
    WHEN 'share' THEN public.dochub_role_weight(public.dochub_effective_folder_role(p_organization_id, p_folder_uid, p_user_id)) >= 40
    WHEN 'manage' THEN public.dochub_role_weight(public.dochub_effective_folder_role(p_organization_id, p_folder_uid, p_user_id)) >= 50
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION public.dochub_bootstrap_organization(p_name TEXT DEFAULT NULL)
RETURNS TABLE(organization_id UUID, organization_role TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_email TEXT := lower(COALESCE(auth.jwt()->>'email', ''));
  v_name TEXT := COALESCE(NULLIF(auth.jwt()->'user_metadata'->>'full_name', ''), NULLIF(split_part(v_email, '@', 1), ''), 'Người dùng');
  v_org UUID;
  v_role TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;

  UPDATE public.organization_members
     SET user_id = v_user, status = 'active', updated_at = NOW()
   WHERE user_id IS NULL AND lower(email) = v_email;

  SELECT m.organization_id, m.organization_role INTO v_org, v_role
  FROM public.organization_members m
  WHERE m.user_id = v_user AND m.status = 'active'
  ORDER BY CASE m.organization_role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, m.created_at
  LIMIT 1;

  IF v_org IS NULL THEN
    INSERT INTO public.organizations(name, owner_id)
    VALUES (COALESCE(NULLIF(trim(p_name), ''), 'Không gian của ' || v_name), v_user)
    RETURNING id INTO v_org;
    INSERT INTO public.organization_members(
      organization_id, user_id, app_user_uid, email, display_name, organization_role, status
    ) VALUES (v_org, v_user, 'u1', v_email, v_name, 'owner', 'active');
    INSERT INTO public.organization_folders(
      organization_id, folder_uid, parent_uid, name, inherit_permissions, created_by
    ) VALUES (v_org, 'all', NULL, 'Tất cả tài liệu', FALSE, v_user);
    v_role := 'owner';
  END IF;

  RETURN QUERY SELECT v_org, v_role;
END;
$$;

-- Owner/admin-only synchronization used by the existing settings UI. Invitations
-- are represented by email until that person signs in, then bootstrap links auth.uid().
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

  INSERT INTO public.organization_members(
    organization_id, user_id, app_user_uid, email, display_name, department,
    organization_role, status, updated_at
  )
  SELECT p_organization_id,
    CASE WHEN u->>'id' = 'u1' THEN auth.uid() ELSE existing.user_id END,
    u->>'id', lower(u->>'email'), u->>'name', COALESCE(u->>'department', ''),
    CASE WHEN u->>'id' = 'u1' THEN 'owner' ELSE 'member' END,
    CASE WHEN COALESCE((u->>'active')::BOOLEAN, TRUE) THEN
      CASE WHEN (CASE WHEN u->>'id' = 'u1' THEN auth.uid() ELSE existing.user_id END) IS NULL THEN 'invited' ELSE 'active' END
    ELSE 'suspended' END,
    NOW()
  FROM jsonb_array_elements(p_users) u
  LEFT JOIN public.organization_members existing
    ON existing.organization_id = p_organization_id AND lower(existing.email) = lower(u->>'email')
  WHERE u->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' AND COALESCE(u->>'email', '') <> ''
  ON CONFLICT (organization_id, app_user_uid) DO UPDATE SET
    email = EXCLUDED.email, display_name = EXCLUDED.display_name,
    department = EXCLUDED.department, status = EXCLUDED.status,
    user_id = COALESCE(public.organization_members.user_id, EXCLUDED.user_id), updated_at = NOW();

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
  JOIN public.organization_members m ON m.organization_id = p_organization_id AND m.app_user_uid = u->>'id'
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
    ON m.organization_id = p_organization_id AND m.app_user_uid = a->>'principalId'
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

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folder_acl_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organization members can view organization" ON public.organizations;
CREATE POLICY "Organization members can view organization" ON public.organizations FOR SELECT
  USING (public.dochub_is_org_member(id));
DROP POLICY IF EXISTS "Owners can update organization" ON public.organizations;
CREATE POLICY "Owners can update organization" ON public.organizations FOR UPDATE
  USING (public.dochub_org_role(id) = 'owner') WITH CHECK (public.dochub_org_role(id) = 'owner');

DROP POLICY IF EXISTS "Members can view organization members" ON public.organization_members;
CREATE POLICY "Members can view organization members" ON public.organization_members FOR SELECT
  USING (public.dochub_is_org_member(organization_id));
DROP POLICY IF EXISTS "Admins can manage organization members" ON public.organization_members;
CREATE POLICY "Admins can manage organization members" ON public.organization_members FOR ALL
  USING (public.dochub_org_role(organization_id) IN ('owner','admin'))
  WITH CHECK (public.dochub_org_role(organization_id) IN ('owner','admin'));

DROP POLICY IF EXISTS "Members can view groups" ON public.organization_groups;
CREATE POLICY "Members can view groups" ON public.organization_groups FOR SELECT
  USING (public.dochub_is_org_member(organization_id));
DROP POLICY IF EXISTS "Admins can manage groups" ON public.organization_groups;
CREATE POLICY "Admins can manage groups" ON public.organization_groups FOR ALL
  USING (public.dochub_org_role(organization_id) IN ('owner','admin'))
  WITH CHECK (public.dochub_org_role(organization_id) IN ('owner','admin'));

DROP POLICY IF EXISTS "Members can view group memberships" ON public.organization_group_members;
CREATE POLICY "Members can view group memberships" ON public.organization_group_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.organization_groups g
    WHERE g.id = group_id AND public.dochub_is_org_member(g.organization_id)
  ));
DROP POLICY IF EXISTS "Admins can manage group memberships" ON public.organization_group_members;
CREATE POLICY "Admins can manage group memberships" ON public.organization_group_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.organization_groups g
    WHERE g.id = group_id AND public.dochub_org_role(g.organization_id) IN ('owner','admin')
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_groups g
    WHERE g.id = group_id AND public.dochub_org_role(g.organization_id) IN ('owner','admin')
  ));

DROP POLICY IF EXISTS "Authorized users can read folders" ON public.organization_folders;
CREATE POLICY "Authorized users can read folders" ON public.organization_folders FOR SELECT
  USING (public.dochub_can_folder_action(organization_id, folder_uid, 'read'));
DROP POLICY IF EXISTS "Contributors can create folders" ON public.organization_folders;
CREATE POLICY "Contributors can create folders" ON public.organization_folders FOR INSERT
  WITH CHECK (
    (parent_uid IS NOT NULL AND public.dochub_can_folder_action(organization_id, parent_uid, 'create'))
    OR (parent_uid IS NULL AND public.dochub_org_role(organization_id) IN ('owner','admin'))
  );
DROP POLICY IF EXISTS "Editors can update folders" ON public.organization_folders;
CREATE POLICY "Editors can update folders" ON public.organization_folders FOR UPDATE
  USING (public.dochub_can_folder_action(organization_id, folder_uid, 'edit'))
  WITH CHECK (public.dochub_can_folder_action(organization_id, folder_uid, 'edit'));
DROP POLICY IF EXISTS "Managers can delete folders" ON public.organization_folders;
CREATE POLICY "Managers can delete folders" ON public.organization_folders FOR DELETE
  USING (public.dochub_can_folder_action(organization_id, folder_uid, 'delete'));

DROP POLICY IF EXISTS "Owners can view ACL" ON public.folder_acl_entries;
CREATE POLICY "Owners can view ACL" ON public.folder_acl_entries FOR SELECT
  USING (public.dochub_can_folder_action(organization_id, folder_uid, 'manage'));
DROP POLICY IF EXISTS "Owners can manage ACL" ON public.folder_acl_entries;
CREATE POLICY "Owners can manage ACL" ON public.folder_acl_entries FOR ALL
  USING (public.dochub_can_folder_action(organization_id, folder_uid, 'manage'))
  WITH CHECK (public.dochub_can_folder_action(organization_id, folder_uid, 'manage'));

DROP POLICY IF EXISTS "Users can only access own documents" ON public.documents_index;
DROP POLICY IF EXISTS "Authorized users can read documents" ON public.documents_index;
CREATE POLICY "Authorized users can read documents" ON public.documents_index FOR SELECT
  USING (
    (organization_id IS NULL AND auth.uid() = user_id)
    OR (organization_id IS NOT NULL AND public.dochub_can_folder_action(organization_id, parent_folder_id, 'read'))
  );
DROP POLICY IF EXISTS "Contributors can create documents" ON public.documents_index;
CREATE POLICY "Contributors can create documents" ON public.documents_index FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND (
      organization_id IS NULL OR public.dochub_can_folder_action(organization_id, parent_folder_id, 'create')
    )
  );
DROP POLICY IF EXISTS "Editors can update documents" ON public.documents_index;
CREATE POLICY "Editors can update documents" ON public.documents_index FOR UPDATE
  USING (
    (organization_id IS NULL AND auth.uid() = user_id)
    OR (organization_id IS NOT NULL AND public.dochub_can_folder_action(organization_id, parent_folder_id, 'edit'))
  ) WITH CHECK (
    organization_id IS NULL OR public.dochub_can_folder_action(organization_id, parent_folder_id, 'edit')
  );
DROP POLICY IF EXISTS "Managers can delete documents" ON public.documents_index;
CREATE POLICY "Managers can delete documents" ON public.documents_index FOR DELETE
  USING (
    (organization_id IS NULL AND auth.uid() = user_id)
    OR (organization_id IS NOT NULL AND public.dochub_can_folder_action(organization_id, parent_folder_id, 'delete'))
  );

REVOKE ALL ON FUNCTION public.dochub_sync_authorization_snapshot(UUID, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dochub_bootstrap_organization(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dochub_sync_authorization_snapshot(UUID, JSONB, JSONB, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dochub_bootstrap_organization(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dochub_can_folder_action(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dochub_effective_folder_role(UUID, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
