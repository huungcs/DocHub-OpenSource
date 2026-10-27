const test = require('node:test');
const assert = require('node:assert/strict');

// Hàm sinh tên tệp duy nhất theo DocHub logic
function getUniqueName(desiredName, parentId, existingDocs) {
  const parts = desiredName.split('.');
  const ext = parts.length > 1 ? '.' + parts.pop() : '';
  const base = parts.join('.');
  
  const siblings = existingDocs.filter(d => d.parentId === parentId && !d.deletedAt);
  const names = new Set(siblings.map(s => s.name));
  
  if (!names.has(desiredName)) return desiredName;
  
  let index = 1;
  while (names.has(`${base} (${index})${ext}`)) {
    index++;
  }
  return `${base} (${index})${ext}`;
}

// Format bytes sang chuỗi hiển thị
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Tách đuôi mở rộng
function splitExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return { name: filename, ext: '' };
  return {
    name: filename.slice(0, idx),
    ext: filename.slice(idx + 1).toLowerCase()
  };
}

// Logic tạo bản sao khi chỉnh sửa (Không ghi đè bản gốc - UI Invariant)
function createEditCopy(originalDoc, updatedContent) {
  const { name, ext } = splitExtension(originalDoc.name);
  return {
    ...originalDoc,
    id: 'doc_' + Math.random().toString(36).slice(2, 9),
    name: `${name} (Bản sao chỉnh sửa)${ext ? '.' + ext : ''}`,
    originalId: originalDoc.id,
    updatedAt: new Date().toISOString(),
    content: updatedContent,
    source: 'edited_copy'
  };
}

test('Document - Unique name generation increments suffix correctly', () => {
  const docs = [
    { parentId: 'f1', name: 'Báo cáo tài chính.pdf' },
    { parentId: 'f1', name: 'Báo cáo tài chính (1).pdf' },
    { parentId: 'f2', name: 'Báo cáo tài chính.pdf' } // Thư mục khác không ảnh hưởng
  ];

  assert.strictEqual(getUniqueName('Báo cáo tài chính.pdf', 'f1', docs), 'Báo cáo tài chính (2).pdf');
  assert.strictEqual(getUniqueName('Báo cáo tài chính.pdf', 'f2', docs), 'Báo cáo tài chính (1).pdf');
  assert.strictEqual(getUniqueName('Tài liệu mới.docx', 'f1', docs), 'Tài liệu mới.docx');
});

test('Document - Extension parsing handles various patterns', () => {
  assert.deepStrictEqual(splitExtension('report.pdf'), { name: 'report', ext: 'pdf' });
  assert.deepStrictEqual(splitExtension('archive.tar.gz'), { name: 'archive.tar', ext: 'gz' });
  assert.deepStrictEqual(splitExtension('README'), { name: 'README', ext: '' });
  assert.deepStrictEqual(splitExtension('.gitignore'), { name: '.gitignore', ext: '' });
});

test('Document - Format bytes human readable', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(1024), '1 KB');
  assert.strictEqual(formatBytes(1024 * 1024 * 2.5), '2.5 MB');
});

test('Document - UI Invariant: Edit creates a new copy, never overwrites original', () => {
  const original = {
    id: 'd100',
    parentId: 'training',
    name: 'Sổ tay hội nhập.docx',
    content: 'Phiên bản gốc',
    bytes: 5000
  };

  const copy = createEditCopy(original, 'Phiên bản đã sửa');

  assert.notStrictEqual(copy.id, original.id);
  assert.strictEqual(copy.name, 'Sổ tay hội nhập (Bản sao chỉnh sửa).docx');
  assert.strictEqual(copy.originalId, 'd100');
  assert.strictEqual(copy.content, 'Phiên bản đã sửa');
  assert.strictEqual(original.content, 'Phiên bản gốc'); // Bản gốc không đổi
});
