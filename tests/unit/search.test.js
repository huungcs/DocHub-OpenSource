const test = require('node:test');
const assert = require('node:assert/strict');

// Hàm normalize tiếng Việt từ DocHub core logic
function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim();
}

function matchesSearch(itemText, query) {
  return normalize(itemText).includes(normalize(query));
}

test('Search - Vietnamese accent-insensitive normalization', () => {
  assert.strictEqual(normalize('Đào tạo'), 'dao tao');
  assert.strictEqual(normalize('HỘI ĐỒNG QUẢN TRỊ'), 'hoi dong quan tri');
  assert.strictEqual(normalize('Phòng kế toán - tài chính'), 'phong ke toan - tai chinh');
  assert.strictEqual(normalize('Sổ tay hội nhập nhân viên'), 'so tay hoi nhap nhan vien');
});

test('Search - Matches query regardless of accents or casing', () => {
  const docName = 'Sổ tay hội nhập nhân viên 2026.pdf';

  assert.strictEqual(matchesSearch(docName, 'so tay'), true);
  assert.strictEqual(matchesSearch(docName, 'SỔ TAY'), true);
  assert.strictEqual(matchesSearch(docName, 'nhap'), true);
  assert.strictEqual(matchesSearch(docName, 'HỘI NHẬP'), true);
  assert.strictEqual(matchesSearch(docName, 'nhan vien'), true);
  assert.strictEqual(matchesSearch(docName, 'pdf'), true);
  assert.strictEqual(matchesSearch(docName, 'ke toan'), false);
});

test('Search - Empty query matches everything', () => {
  assert.strictEqual(matchesSearch('Bất kỳ tài liệu nào', ''), true);
  assert.strictEqual(matchesSearch('Bất kỳ tài liệu nào', '   '), true);
});

test('Search - Trim whitespace handling', () => {
  assert.strictEqual(matchesSearch('Quy định lương', '  quy dinh  '), true);
});
