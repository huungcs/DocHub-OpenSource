-- 013_workspace_revision_compare_and_swap.sql
-- Workspace JSON remains a compatibility snapshot. Require the client to advance
-- from the revision it read, so a stale tab cannot silently overwrite a newer one.

CREATE OR REPLACE FUNCTION public.dochub_save_workspace_snapshot(
  p_state JSONB,
  p_expected_revision INTEGER
)
RETURNS TABLE(revision INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_current_revision INTEGER;
  v_next_revision INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_state) <> 'object' OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_workspace_snapshot' USING ERRCODE = '22023';
  END IF;

  SELECT w.revision INTO v_current_revision
  FROM public.user_workspaces w
  WHERE w.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'workspace_revision_conflict' USING ERRCODE = '40001';
    END IF;
    INSERT INTO public.user_workspaces(user_id, state, revision, updated_at)
    VALUES (v_user_id, p_state, 1, NOW());
    v_next_revision := 1;
  ELSE
    IF v_current_revision <> p_expected_revision THEN
      RAISE EXCEPTION 'workspace_revision_conflict' USING ERRCODE = '40001';
    END IF;
    UPDATE public.user_workspaces
    SET state = p_state,
        revision = v_current_revision + 1,
        updated_at = NOW()
    WHERE user_id = v_user_id;
    v_next_revision := v_current_revision + 1;
  END IF;

  RETURN QUERY SELECT v_next_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.dochub_save_workspace_snapshot(JSONB, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dochub_save_workspace_snapshot(JSONB, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
