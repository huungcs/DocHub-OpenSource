const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'database', 'migrations', '002_organization_acl.sql'), 'utf8');
const documentMoveMigration = fs.readFileSync(path.join(root, 'database', 'migrations', '012_document_move_rls.sql'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src', 'integrations', 'supabase', 'cloud-bridge.js'), 'utf8');

test('Server ACL - normalized organization, member, group, folder and ACL tables exist', () => {
  for (const table of [
    'organizations', 'organization_members', 'organization_groups',
    'organization_group_members', 'organization_folders', 'folder_acl_entries'
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
});

test('Server ACL - effective role follows ancestors and stops when inheritance is disabled', () => {
  assert.match(migration, /WITH RECURSIVE member_row AS/);
  assert.match(migration, /WHERE child\.inherit_permissions/);
  assert.match(migration, /dochub_effective_folder_role/);
});

test('Server ACL - document writes are protected by action-specific RLS policies', () => {
  assert.match(migration, /Contributors can create documents/);
  assert.match(migration, /Editors can update documents/);
  assert.match(migration, /Managers can delete documents/);
  assert.match(migration, /dochub_can_folder_action\(organization_id, parent_folder_id, 'delete'\)/);
});

test('Server ACL - direct document moves require move on source and create on destination', () => {
  assert.match(documentMoveMigration, /dochub_can_update_document/);
  assert.match(documentMoveMigration, /'move'/);
  assert.match(documentMoveMigration, /'create'/);
  assert.match(documentMoveMigration, /trg_enforce_document_update/);
  assert.match(documentMoveMigration, /document_identity_immutable/);
});

test('Server workspace writes use compare-and-swap revisions', () => {
  const workspaceMigration = fs.readFileSync(path.join(root, 'database', 'migrations', '013_workspace_revision_compare_and_swap.sql'), 'utf8');
  assert.match(workspaceMigration, /dochub_save_workspace_snapshot/);
  assert.match(workspaceMigration, /workspace_revision_conflict/);
  assert.match(workspaceMigration, /FOR UPDATE/);
  assert.match(bridge, /supabase\.rpc\('dochub_save_workspace_snapshot'/);
  assert.match(bridge, /workspace_revision_conflict/);
});

test('Server ACL - browser asks Supabase before reading, uploading or deleting assets', () => {
  assert.match(bridge, /api\.requirePermission\(parentFolderId, 'read'\)/);
  assert.match(bridge, /api\.requirePermission\(parentFolderId, 'create'\)/);
  assert.match(bridge, /api\.requirePermission\(parentFolderId, 'delete'\)/);
});

test('Server ACL - invitations link by normalized email after Google login', () => {
  assert.match(migration, /lower\(email\) = v_email/);
  assert.match(migration, /SET user_id = v_user, status = 'active'/);
});
