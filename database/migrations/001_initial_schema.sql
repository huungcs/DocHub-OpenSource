-- ==============================================================================
-- DOCHUB DATABASE SCHEMA & ROW LEVEL SECURITY (RLS) FOR SUPABASE
-- Dự án: DocHub (Multi-tenant Document Management with Google Drive & Supabase)
-- ==============================================================================

-- 1. Bảng hồ sơ người dùng (Tự động liên kết với auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  google_drive_connected BOOLEAN DEFAULT FALSE,
  google_drive_root_folder TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bật RLS cho user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 2. Bảng không gian làm việc (Lưu cây thư mục, cài đặt, phân quyền ACL, nhật ký)
-- Mỗi khách hàng có một không gian độc lập, được phân quyền hoàn toàn riêng biệt
CREATE TABLE IF NOT EXISTS public.user_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_name TEXT DEFAULT 'Không gian của tôi',
  revision INT DEFAULT 1,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_workspace UNIQUE (user_id)
);

-- Bật RLS cho user_workspaces
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access own workspace" ON public.user_workspaces;
CREATE POLICY "Users can only access own workspace"
  ON public.user_workspaces FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Bảng chỉ mục tài liệu (Metadata tài liệu liên kết với Google Drive File ID)
CREATE TABLE IF NOT EXISTS public.documents_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_uid TEXT NOT NULL, -- ID nội bộ trong DocHub (ví dụ d1, d2 hoặc UUID)
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes BIGINT DEFAULT 0,
  mime_type TEXT,
  google_drive_file_id TEXT, -- ID file thật trên Google Drive của khách
  parent_folder_id TEXT DEFAULT 'all',
  description TEXT,
  starred BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Bật RLS cho documents_index
ALTER TABLE public.documents_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access own documents" ON public.documents_index;
CREATE POLICY "Users can only access own documents"
  ON public.documents_index FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. Trigger tự động tạo profile khi có người dùng đăng nhập qua Google Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_profiles.avatar_url),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Index giúp tối ưu tốc độ truy vấn
CREATE INDEX IF NOT EXISTS idx_user_workspaces_user ON public.user_workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_index_user ON public.documents_index(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_index_folder ON public.documents_index(user_id, parent_folder_id);
