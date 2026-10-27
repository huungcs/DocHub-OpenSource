CREATE TABLE public.organization_drive_folders (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 folder_uid TEXT NOT NULL,
 drive_folder_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(organization_id,folder_uid),
 FOREIGN KEY(organization_id,folder_uid) REFERENCES public.organization_folders(organization_id,folder_uid)
);
ALTER TABLE public.organization_drive_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read Drive folder mappings" ON public.organization_drive_folders FOR SELECT TO authenticated
 USING(public.dochub_can_folder_action(organization_id,folder_uid,'read'));
CREATE POLICY "Owner maintains Drive folder mappings" ON public.organization_drive_folders FOR ALL TO authenticated
 USING(public.dochub_org_role(organization_id)='owner') WITH CHECK(public.dochub_org_role(organization_id)='owner');
NOTIFY pgrst,'reload schema';
