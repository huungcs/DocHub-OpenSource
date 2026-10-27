-- 008_cleanup_demo_folders.sql
-- Loại bỏ triệt để các thư mục và dữ liệu demo mẫu bị rò rỉ vào các tổ chức thật

DO $$
DECLARE
  demo_uids TEXT[] := ARRAY[
    'board','board-docs','executive','business','business-plan','customers',
    'admin','salary','salary-forms','allowance','discipline','administration',
    'finance','sales-policy','finance-reports','hr','recruitment','training',
    'employee-records','processes','production','admin-processes','archive','supplier-contracts'
  ];
BEGIN
  -- 1. Xóa liên kết Google Drive của các thư mục demo
  DELETE FROM public.organization_drive_folders WHERE folder_uid = ANY(demo_uids);

  -- 2. Xóa các quyền ACL của các thư mục demo
  DELETE FROM public.folder_acl_entries WHERE folder_uid = ANY(demo_uids);

  -- 3. Xóa các tài liệu demo mẫu khỏi documents_index
  DELETE FROM public.documents_index WHERE parent_folder_id = ANY(demo_uids);

  -- 4. Xóa các thư mục demo khỏi organization_folders
  DELETE FROM public.organization_folders WHERE folder_uid = ANY(demo_uids);
END $$;
