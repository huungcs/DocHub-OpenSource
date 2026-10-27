const test = require('node:test');
const assert = require('node:assert/strict');

// Mô hình thư mục theo DocHub v2.2
const mockFolders = [
  { id: 'board-docs', parentId: 'all', name: 'Hội đồng quản trị', starred: false },
  { id: 'business-docs', parentId: 'all', name: 'Khối Kinh doanh', starred: false },
  { id: 'admin-dept', parentId: 'all', name: 'Phòng hành chính', starred: true },
  { id: 'hr-dept', parentId: 'all', name: 'Phòng nhân sự', starred: false },
  { id: 'recruitment', parentId: 'hr-dept', name: 'Tuyển dụng', starred: false },
  { id: 'training', parentId: 'hr-dept', name: 'Đào tạo', starred: true },
  { id: 'employee-records', parentId: 'hr-dept', name: 'Hồ sơ nhân sự', starred: false, inherit: false },
  { id: 'operations', parentId: 'all', name: 'Quy trình vận hành', starred: false }
];

const mockDocuments = [
  { id: 'd1', parentId: 'board-docs', name: 'Biên bản họp.pdf' },
  { id: 'd2', parentId: 'training', name: 'Sổ tay hội nhập.pdf' },
  { id: 'd3', parentId: 'training', name: 'Kế hoạch đào tạo.xlsx' },
  { id: 'd4', parentId: 'admin-dept', name: 'Nội quy công ty.docx' }
];

function getChildren(parentId, folders = mockFolders) {
  return folders.filter(f => f.parentId === parentId);
}

function getAncestors(folderId, folders = mockFolders) {
  const list = [];
  let current = folders.find(f => f.id === folderId);
  while (current && current.parentId && current.parentId !== 'all') {
    const parent = folders.find(f => f.id === current.parentId);
    if (parent) {
      list.unshift(parent);
      current = parent;
    } else {
      break;
    }
  }
  return list;
}

function countFiles(folderId, folders = mockFolders, docs = mockDocuments) {
  if (folderId === 'all') return docs.length;
  // File trực tiếp trong thư mục
  return docs.filter(d => d.parentId === folderId).length;
}

function countDescendantFiles(folderId, folders = mockFolders, docs = mockDocuments) {
  if (folderId === 'all') return docs.length;
  const targetFolderIds = new Set([folderId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (targetFolderIds.has(f.parentId) && !targetFolderIds.has(f.id)) {
        targetFolderIds.add(f.id);
        added = true;
      }
    }
  }
  return docs.filter(d => targetFolderIds.has(d.parentId)).length;
}

function parseHashFolder(hash) {
  if (!hash) return 'all';
  const match = hash.match(/#folder=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : 'all';
}

function buildBreadcrumbs(folderId, folders = mockFolders) {
  if (folderId === 'all') return [{ id: 'all', name: 'Tất cả tài liệu' }];
  const current = folders.find(f => f.id === folderId);
  if (!current) return [{ id: 'all', name: 'Tất cả tài liệu' }];
  const ancestors = getAncestors(folderId, folders);
  return [
    { id: 'all', name: 'Tất cả tài liệu' },
    ...ancestors.map(a => ({ id: a.id, name: a.name })),
    { id: current.id, name: current.name }
  ];
}

test('Folder - Children lookup finds direct child folders', () => {
  const rootChildren = getChildren('all');
  assert.strictEqual(rootChildren.length, 5);
  const hrChildren = getChildren('hr-dept');
  assert.strictEqual(hrChildren.length, 3);
  assert.deepStrictEqual(hrChildren.map(c => c.id), ['recruitment', 'training', 'employee-records']);
});

test('Folder - Ancestor path generation', () => {
  const trainingAncestors = getAncestors('training');
  assert.strictEqual(trainingAncestors.length, 1);
  assert.strictEqual(trainingAncestors[0].id, 'hr-dept');
});

test('Folder - Direct and recursive file counting', () => {
  assert.strictEqual(countFiles('training'), 2);
  assert.strictEqual(countFiles('hr-dept'), 0);
  assert.strictEqual(countDescendantFiles('hr-dept'), 2);
  assert.strictEqual(countFiles('all'), 4);
});

test('Folder - Pinned / starred filtering', () => {
  const starred = mockFolders.filter(f => f.starred);
  assert.strictEqual(starred.length, 2);
  assert.deepStrictEqual(starred.map(f => f.id), ['admin-dept', 'training']);
});

test('Folder - Hash #folder= routing parsing', () => {
  assert.strictEqual(parseHashFolder(''), 'all');
  assert.strictEqual(parseHashFolder('#folder=training'), 'training');
  assert.strictEqual(parseHashFolder('#folder=hr-dept'), 'hr-dept');
  assert.strictEqual(parseHashFolder('#invalid'), 'all');
});

test('Folder - Breadcrumbs trail assembly', () => {
  const crumbs = buildBreadcrumbs('training');
  assert.strictEqual(crumbs.length, 3);
  assert.strictEqual(crumbs[0].name, 'Tất cả tài liệu');
  assert.strictEqual(crumbs[1].name, 'Phòng nhân sự');
  assert.strictEqual(crumbs[2].name, 'Đào tạo');
});
