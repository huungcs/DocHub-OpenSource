-- 011_organization_invite_links.sql
-- Thêm mã mời tham gia tổ chức (invite_code) và hàm gia nhập an toàn trực tiếp qua link mời.

-- 1. Thêm cột invite_code vào bảng organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex');

-- 2. Đảm bảo tất cả tổ chức hiện có đều có invite_code hợp lệ
UPDATE public.organizations 
SET invite_code = encode(gen_random_bytes(6), 'hex') 
WHERE invite_code IS NULL;

ALTER TABLE public.organizations ALTER COLUMN invite_code SET NOT NULL;

-- 3. Hàm gia nhập tổ chức bằng mã mời (dochub_join_organization_by_invite)
CREATE OR REPLACE FUNCTION public.dochub_join_organization_by_invite(
  p_invite_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_user_name TEXT;
  v_org RECORD;
  v_member RECORD;
  v_member_uid TEXT;
  v_cleaned_code TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_cleaned_code := trim(COALESCE(p_invite_code, ''));
  IF v_cleaned_code = '' THEN
    RAISE EXCEPTION 'invalid_invite_code' USING ERRCODE = '22023';
  END IF;

  v_user_email := lower(COALESCE(auth.jwt()->>'email', ''));
  v_user_name := COALESCE(
    NULLIF(trim(auth.jwt()->'user_metadata'->>'full_name'), ''),
    NULLIF(trim(auth.jwt()->'user_metadata'->>'name'), ''),
    split_part(v_user_email, '@', 1)
  );

  SELECT id, name, owner_id INTO v_org
  FROM public.organizations
  WHERE invite_code = v_cleaned_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_code' USING ERRCODE = 'P0002';
  END IF;

  -- Kiểm tra xem tài khoản đã là thành viên của tổ chức này chưa
  SELECT * INTO v_member
  FROM public.organization_members
  WHERE organization_id = v_org.id 
    AND (user_id = v_user_id OR (v_user_email <> '' AND lower(email) = v_user_email));

  IF v_member.id IS NOT NULL THEN
    -- Nếu đã có sẵn trong danh sách (được mời qua email hoặc tái gia nhập)
    UPDATE public.organization_members
    SET user_id = v_user_id,
        status = 'active',
        display_name = COALESCE(NULLIF(trim(display_name), ''), v_user_name),
        updated_at = NOW()
    WHERE id = v_member.id;

    RETURN jsonb_build_object(
      'organization_id', v_org.id,
      'organization_name', v_org.name,
      'organization_role', v_member.organization_role,
      'already_member', true
    );
  END IF;

  -- Thêm thành viên mới vào tổ chức với vai trò member
  v_member_uid := 'user-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  INSERT INTO public.organization_members(
    organization_id, user_id, app_user_uid, email, display_name,
    department, organization_role, status, updated_at
  )
  VALUES (
    v_org.id, v_user_id, v_member_uid, v_user_email, v_user_name,
    '', 'member', 'active', NOW()
  );

  RETURN jsonb_build_object(
    'organization_id', v_org.id,
    'organization_name', v_org.name,
    'organization_role', 'member',
    'already_member', false
  );
END;
$$;

-- 4. Hàm lấy mã mời của tổ chức (dochub_get_invite_code)
CREATE OR REPLACE FUNCTION public.dochub_get_invite_code(p_organization_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_code TEXT;
BEGIN
  v_role := public.dochub_org_role(p_organization_id, auth.uid());
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_organization_member' USING ERRCODE = '42501';
  END IF;

  SELECT invite_code INTO v_code 
  FROM public.organizations 
  WHERE id = p_organization_id;

  RETURN v_code;
END;
$$;

-- 5. Hàm đặt lại mã mời mới cho tổ chức (dochub_reset_invite_code)
CREATE OR REPLACE FUNCTION public.dochub_reset_invite_code(p_organization_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_code TEXT;
BEGIN
  v_role := public.dochub_org_role(p_organization_id, auth.uid());
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'organization_admin_required' USING ERRCODE = '42501';
  END IF;

  v_code := encode(gen_random_bytes(6), 'hex');
  UPDATE public.organizations 
  SET invite_code = v_code, updated_at = NOW() 
  WHERE id = p_organization_id;

  RETURN v_code;
END;
$$;

-- 6. Cấp quyền thực thi các hàm cho authenticated users
GRANT EXECUTE ON FUNCTION public.dochub_join_organization_by_invite(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dochub_get_invite_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dochub_reset_invite_code(UUID) TO authenticated;
