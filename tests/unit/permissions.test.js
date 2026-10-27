const test = require('node:test');
const assert = require('node:assert/strict');

// Role priority: manager (3) > editor (2) > viewer (1) > none (0)
const ROLE_WEIGHT = {
  none: 0,
  viewer: 1,
  editor: 2,
  manager: 3
};

function compareRoles(a, b) {
  return (ROLE_WEIGHT[a] || 0) - (ROLE_WEIGHT[b] || 0);
}

function maxRole(a, b) {
  return compareRoles(a, b) >= 0 ? a : b;
}

// Bảng dữ liệu mẫu về phân quyền
const testState = {
  users: [
    { id: 'u_admin', name: 'Vũ Ngọc Lan', groupIds: ['g_admin'] },
    { id: 'u_hr', name: 'Lê Hà Anh', groupIds: ['g_hr'] },
    { id: 'u_guest', name: 'Nhân viên mới', groupIds: [] }
  ],
  groups: [
    { id: 'g_admin', name: 'Quản trị' },
    { id: 'g_hr', name: 'Nhân sự' }
  ],
  folders: [
    { id: 'all', parentId: null, name: 'Tất cả' },
    { id: 'hr_dept', parentId: 'all', name: 'Phòng nhân sự', inherit: true },
    { id: 'recruitment', parentId: 'hr_dept', name: 'Tuyển dụng', inherit: true },
    { id: 'employee_records', parentId: 'hr_dept', name: 'Hồ sơ nhân sự', inherit: false } // Phá vỡ kế thừa
  ],
  // Quyền gán tại từng thư mục: [ { folderId, principalType: 'user'|'group', principalId, role } ]
  permissions: [
    { folderId: 'all', principalType: 'group', principalId: 'g_admin', role: 'manager' },
    { folderId: 'hr_dept', principalType: 'group', principalId: 'g_hr', role: 'editor' },
    { folderId: 'recruitment', principalType: 'user', principalId: 'u_guest', role: 'viewer' },
    { folderId: 'employee_records', principalType: 'user', principalId: 'u_hr', role: 'viewer' } // Override xuống viewer
  ]
};

// Tính quyền hiệu lực (Effective Permissions)
function getEffectiveRole(userId, folderId, state = testState) {
  const user = state.users.find(u => u.id === userId);
  if (!user) return 'none';

  const userGroupIds = new Set(user.groupIds || []);

  // Tìm đường dẫn từ gốc đến thư mục hiện tại
  const chain = [];
  let curr = state.folders.find(f => f.id === folderId);
  while (curr) {
    chain.unshift(curr);
    if (!curr.parentId) break;
    curr = state.folders.find(f => f.id === curr.parentId);
  }

  let effective = 'none';

  for (const node of chain) {
    // Nếu node ngắt kế thừa (inherit === false), xóa bỏ quyền kế thừa từ cha
    if (node.inherit === false && node.id !== chain[0].id) {
      effective = 'none';
    }

    // Lấy các quyền được gán trực tiếp tại node này
    const directRules = state.permissions.filter(p => p.folderId === node.id);
    for (const rule of directRules) {
      if (rule.principalType === 'user' && rule.principalId === userId) {
        effective = rule.role; // Quyền trực tiếp của user có mức ưu tiên cao
      } else if (rule.principalType === 'group' && userGroupIds.has(rule.principalId)) {
        // Lấy quyền cao nhất giữa các nhóm
        effective = maxRole(effective, rule.role);
      }
    }
  }

  return effective;
}

function canPerformAction(role, action) {
  switch (action) {
    case 'read':
    case 'download':
      return ['viewer', 'editor', 'manager'].includes(role);
    case 'create':
    case 'edit':
    case 'rename':
      return ['editor', 'manager'].includes(role);
    case 'delete':
    case 'manage_permissions':
      return role === 'manager';
    default:
      return false;
  }
}

test('Permissions - Parent to child inheritance', () => {
  // u_hr thuộc g_hr có role 'editor' tại 'hr_dept'
  // 'recruitment' kế thừa 'hr_dept', nên u_hr kế thừa quyền editor
  const roleInParent = getEffectiveRole('u_hr', 'hr_dept');
  const roleInChild = getEffectiveRole('u_hr', 'recruitment');

  assert.strictEqual(roleInParent, 'editor');
  assert.strictEqual(roleInChild, 'editor');
});

test('Permissions - Admin group inherits manager down the entire tree', () => {
  assert.strictEqual(getEffectiveRole('u_admin', 'all'), 'manager');
  assert.strictEqual(getEffectiveRole('u_admin', 'hr_dept'), 'manager');
  assert.strictEqual(getEffectiveRole('u_admin', 'recruitment'), 'manager');
});

test('Permissions - Break inheritance (inherit: false) resets inherited permissions', () => {
  // 'employee_records' có inherit: false
  // Admin được gán tại 'all' sẽ bị reset trên nhánh không kế thừa nếu không có quyền trực tiếp tại đó
  // u_hr có rule trực tiếp tại 'employee_records' là 'viewer', nên nhận 'viewer' thay vì 'editor'
  const roleInRecords = getEffectiveRole('u_hr', 'employee_records');
  assert.strictEqual(roleInRecords, 'viewer');
});

test('Permissions - Specific user assignment in subfolder', () => {
  // u_guest chỉ được gán quyền tại 'recruitment'
  assert.strictEqual(getEffectiveRole('u_guest', 'all'), 'none');
  assert.strictEqual(getEffectiveRole('u_guest', 'hr_dept'), 'none');
  assert.strictEqual(getEffectiveRole('u_guest', 'recruitment'), 'viewer');
});

test('Permissions - Action authorization by role', () => {
  assert.strictEqual(canPerformAction('viewer', 'read'), true);
  assert.strictEqual(canPerformAction('viewer', 'create'), false);
  assert.strictEqual(canPerformAction('viewer', 'delete'), false);

  assert.strictEqual(canPerformAction('editor', 'read'), true);
  assert.strictEqual(canPerformAction('editor', 'create'), true);
  assert.strictEqual(canPerformAction('editor', 'delete'), false);

  assert.strictEqual(canPerformAction('manager', 'read'), true);
  assert.strictEqual(canPerformAction('manager', 'create'), true);
  assert.strictEqual(canPerformAction('manager', 'delete'), true);
  assert.strictEqual(canPerformAction('manager', 'manage_permissions'), true);
});
