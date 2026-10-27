-- 012_document_move_rls.sql
-- A document may be renamed/edited by an editor in its current folder, but moving
-- it must additionally require move on its source and create on its destination.
-- Enforce this at the database boundary so direct PostgREST calls cannot bypass
-- the server-side document-update checks.

CREATE OR REPLACE FUNCTION public.dochub_can_update_document(
  p_organization_id UUID,
  p_old_folder_uid TEXT,
  p_new_folder_uid TEXT,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_organization_id IS NULL THEN p_user_id = auth.uid()
    WHEN p_old_folder_uid IS DISTINCT FROM p_new_folder_uid THEN
      public.dochub_can_folder_action(p_organization_id, p_old_folder_uid, 'move', p_user_id)
      AND public.dochub_can_folder_action(p_organization_id, p_new_folder_uid, 'create', p_user_id)
    ELSE public.dochub_can_folder_action(p_organization_id, p_old_folder_uid, 'edit', p_user_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.dochub_enforce_document_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.doc_uid IS DISTINCT FROM OLD.doc_uid THEN
    RAISE EXCEPTION 'document_identity_immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.organization_id IS NOT NULL
     AND NOT public.dochub_can_update_document(
       NEW.organization_id,
       OLD.parent_folder_id,
       NEW.parent_folder_id,
       auth.uid()
     ) THEN
    RAISE EXCEPTION 'document_update_not_allowed' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_document_update ON public.documents_index;
CREATE TRIGGER trg_enforce_document_update
BEFORE UPDATE ON public.documents_index
FOR EACH ROW EXECUTE FUNCTION public.dochub_enforce_document_update();

DROP POLICY IF EXISTS "Editors can update documents" ON public.documents_index;
CREATE POLICY "Editors can update documents" ON public.documents_index FOR UPDATE
  USING (
    (organization_id IS NULL AND auth.uid() = user_id)
    OR (organization_id IS NOT NULL AND public.dochub_can_folder_action(organization_id, parent_folder_id, 'edit'))
  )
  WITH CHECK (
    (organization_id IS NULL AND auth.uid() = user_id)
    OR (
      organization_id IS NOT NULL
      AND public.dochub_can_folder_action(organization_id, parent_folder_id, 'create')
    )
  );

REVOKE ALL ON FUNCTION public.dochub_can_update_document(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dochub_can_update_document(UUID, TEXT, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.dochub_enforce_document_update() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
