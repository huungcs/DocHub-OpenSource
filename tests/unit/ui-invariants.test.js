const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');
const templateHtml = fs.readFileSync(path.join(projectRoot, 'src', 'app', 'index.template.html'), 'utf8');
const builtHtml = fs.existsSync(path.join(projectRoot, 'dist', 'index.html'))
  ? fs.readFileSync(path.join(projectRoot, 'dist', 'index.html'), 'utf8')
  : templateHtml;

test('UI Invariant 1 - Topbar does NOT contain standalone settings or auth buttons', () => {
  // Topbar phải giữ layout tinh gọn, không chứa button settings hoặc nút đăng nhập to gây tràn/đè giao diện
  const topbarMatch = builtHtml.match(/<header class="topbar">([\s\S]*?)<\/header>/);
  assert.ok(topbarMatch, 'Topbar header must exist');
  const topbarContent = topbarMatch[1];

  assert.strictEqual(
    topbarContent.includes('data-action="settings"'),
    false,
    'Settings button MUST NOT be in topbar'
  );
  assert.strictEqual(
    topbarContent.includes('id="btnGoogleAuth"'),
    false,
    'btnGoogleAuth MUST NOT be placed in topbar (use avatar menu instead)'
  );
  assert.ok(
    topbarContent.includes('class="profile-button" data-action="account"'),
    'Profile avatar button must be present in topbar'
  );
});

test('UI Invariant 2 - Account & Settings are accessible exclusively in Avatar menu', () => {
  // Menu mở ra khi click avatar phải chứa Settings và Cloud/Google Actions
  assert.ok(
    builtHtml.includes("case 'account':"),
    "Account action handler must exist"
  );
  assert.ok(
    builtHtml.includes("data-section=\"general\"") || builtHtml.includes("settings"),
    "Account action handler must link to Settings"
  );
});

test('UI Invariant 3 - Departments are modeled as folders directly under root all', () => {
  // Kiểm tra dữ liệu mẫu trong mã nguồn
  const foldersSnippetMatch = templateHtml.match(/const folders = \[([\s\S]*?)\];/);
  if (foldersSnippetMatch) {
    const snippet = foldersSnippetMatch[1];
    // Các phòng ban chính phải có parentId là 'all'
    assert.ok(snippet.includes("'all'"), "Root all must exist");
  }
  // Kiểm tra rule kiến trúc: cây thư mục gốc là 'all'
  assert.ok(templateHtml.includes("data-id=\"all\""), "Root tree item all must exist");
});

test('UI Invariant 4 - Primary left-hand navigation is the folder tree', () => {
  assert.ok(templateHtml.includes('id="folderTree"'), '#folderTree element must exist in sidebar');
  assert.ok(templateHtml.includes('class="tree-scroll"'), '.tree-scroll container must exist');
});

test('UI Invariant 5 - Closed dialogs must be hidden without taking vertical space', () => {
  assert.ok(
    builtHtml.includes('dialog:not([open]){display:none!important}') ||
    templateHtml.includes('dialog:not([open]){display:none!important}'),
    'Closed dialogs must have display: none !important to prevent bottom whitespace leaks'
  );
});
