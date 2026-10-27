const test = require('node:test');
const assert = require('node:assert/strict');

// Logic định dạng OOXML Word thành HTML hiển thị trên DocHub Media Studio
const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const escape = (s = '') => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

function formatWordRun(runData) {
  let content = '';
  for (const item of runData.children || []) {
    if (item.type === 't') content += escape(item.text);
    else if (item.type === 'br') content += '<br>';
    else if (item.type === 'tab') content += '&emsp;';
  }
  if (!content && runData.text) content = escape(runData.text);
  if (!content) return '';

  const rPr = runData.rPr || {};
  const isB = rPr.b && rPr.b !== '0' && rPr.b !== 'false' && rPr.b !== 'off';
  const isI = rPr.i && rPr.i !== '0' && rPr.i !== 'false' && rPr.i !== 'off';
  const isU = rPr.u && rPr.u !== 'none' && rPr.u !== '0' && rPr.u !== 'false';
  const isS = rPr.strike && rPr.strike !== '0' && rPr.strike !== 'false' && rPr.strike !== 'off';

  if (isB) content = `<strong>${content}</strong>`;
  if (isI) content = `<em>${content}</em>`;
  if (isU) content = `<u>${content}</u>`;
  if (isS) content = `<s>${content}</s>`;

  if (rPr.color && /^[0-9a-fA-F]{6}$/.test(rPr.color) && rPr.color.toLowerCase() !== '000000') {
    content = `<span style="color:#${rPr.color}">${content}</span>`;
  }
  if (rPr.highlight && rPr.highlight !== 'none') {
    content = `<mark style="background:#fff2a8;padding:0 2px;border-radius:2px">${content}</mark>`;
  }

  return content;
}

function formatWordParagraph(pData) {
  const runs = pData.runs || [];
  if (!runs.length) {
    return pData.text ? escape(pData.text) : '';
  }
  return runs.map(formatWordRun).join('');
}

function resolveParagraphAlignment(jcVal) {
  const val = String(jcVal || '').toLowerCase();
  if (val === 'center') return 'center';
  if (val === 'right') return 'right';
  if (val === 'both' || val === 'justify' || val === 'distribute') return 'justify';
  if (val === 'left' || val === 'start') return 'left';
  return '';
}

test('Word Formatting - In đậm (bold) renders <strong> correctly', () => {
  const run = {
    children: [{ type: 't', text: 'Văn bản in đậm quan trọng' }],
    rPr: { b: '1' }
  };
  assert.strictEqual(formatWordRun(run), '<strong>Văn bản in đậm quan trọng</strong>');

  // Thẻ <w:b/> không có thuộc tính (rPr.b === 'true' hoặc '')
  const runDefaultB = {
    children: [{ type: 't', text: 'Chữ đậm mặc định' }],
    rPr: { b: '' }
  };
  // Khi không có thuộc tính rPr.b = '' (tức thẻ <w:b/> rỗng), ta coi là bật bold
  assert.strictEqual(
    formatWordRun({ ...runDefaultB, rPr: { b: 'true' } }),
    '<strong>Chữ đậm mặc định</strong>'
  );
});

test('Word Formatting - In nghiêng (italic) renders <em> correctly', () => {
  const run = {
    children: [{ type: 't', text: 'Ghi chú in nghiêng' }],
    rPr: { i: 'true' }
  };
  assert.strictEqual(formatWordRun(run), '<em>Ghi chú in nghiêng</em>');
});

test('Word Formatting - Gạch chân (underline) renders <u> correctly', () => {
  const run = {
    children: [{ type: 't', text: 'Điều khoản gạch chân' }],
    rPr: { u: 'single' }
  };
  assert.strictEqual(formatWordRun(run), '<u>Điều khoản gạch chân</u>');
});

test('Word Formatting - Gạch ngang (strikethrough) renders <s> correctly', () => {
  const run = {
    children: [{ type: 't', text: 'Giá cũ bỏ qua' }],
    rPr: { strike: 'true' }
  };
  assert.strictEqual(formatWordRun(run), '<s>Giá cũ bỏ qua</s>');
});

test('Word Formatting - Kết hợp vừa đậm vừa nghiêng vừa gạch chân', () => {
  const run = {
    children: [{ type: 't', text: 'Tiêu đề đặc biệt' }],
    rPr: { b: '1', i: '1', u: 'single' }
  };
  assert.strictEqual(formatWordRun(run), '<u><em><strong>Tiêu đề đặc biệt</strong></em></u>');
});

test('Word Formatting - Tắt định dạng khi val=0 hoặc val=false hoặc val=none', () => {
  const run = {
    children: [{ type: 't', text: 'Văn bản bình thường' }],
    rPr: { b: '0', i: 'false', u: 'none', strike: '0' }
  };
  assert.strictEqual(formatWordRun(run), 'Văn bản bình thường');
});

test('Word Formatting - Chống XSS an toàn khi có ký tự đặc biệt <>&"', () => {
  const run = {
    children: [{ type: 't', text: '<script>alert("hack")</script> & "test"' }],
    rPr: { b: '1' }
  };
  assert.strictEqual(
    formatWordRun(run),
    '<strong>&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt; &amp; &quot;test&quot;</strong>'
  );
});

test('Word Formatting - Căn lề đoạn văn bản (alignment)', () => {
  assert.strictEqual(resolveParagraphAlignment('center'), 'center');
  assert.strictEqual(resolveParagraphAlignment('right'), 'right');
  assert.strictEqual(resolveParagraphAlignment('both'), 'justify');
  assert.strictEqual(resolveParagraphAlignment('left'), 'left');
  assert.strictEqual(resolveParagraphAlignment(''), '');
});

test('Word Formatting - Ghép nhiều run định dạng khác nhau trong 1 đoạn văn', () => {
  const p = {
    runs: [
      { children: [{ type: 't', text: 'Xin chào ' }] },
      { children: [{ type: 't', text: 'ông Nguyễn Văn A' }], rPr: { b: '1' } },
      { children: [{ type: 't', text: ' (Chức vụ: ' }] },
      { children: [{ type: 't', text: 'Giám đốc' }], rPr: { i: '1' } },
      { children: [{ type: 't', text: ')' }] }
    ]
  };
  assert.strictEqual(
    formatWordParagraph(p),
    'Xin chào <strong>ông Nguyễn Văn A</strong> (Chức vụ: <em>Giám đốc</em>)'
  );
});
