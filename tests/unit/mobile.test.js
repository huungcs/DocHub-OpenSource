const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');
const templateHtml = fs.readFileSync(path.join(projectRoot, 'src', 'app', 'index.template.html'), 'utf8');

test('Mobile - Media query breakpoint matches progressive mobile definition', () => {
  const expectedQuery = '(max-width:700px), (max-width:1000px) and (max-height:500px) and (pointer:coarse)';
  assert.ok(
    templateHtml.includes(expectedQuery),
    'Mobile query must exactly match DocHub mobile breakpoint specification'
  );
});

test('Mobile - Dock navigation structure defines the 4 core actions', () => {
  assert.ok(templateHtml.includes('class="m-dock'), 'm-dock CSS class must exist');
  assert.ok(templateHtml.includes('data-action="open-nav"'), 'm-dock must have open-nav button');
  assert.ok(templateHtml.includes('data-phone="search"'), 'm-dock must have search trigger');
  assert.ok(templateHtml.includes('data-action="create-menu"'), 'm-dock must have upload/create action');
  assert.ok(templateHtml.includes('data-action="account"'), 'm-dock must have account trigger');
});

test('Mobile - Search overlay toggles open class on topbar', () => {
  assert.ok(templateHtml.includes("classList.toggle('search-open')"), 'Mobile search must toggle search-open class');
});

test('Settings stat-card: Desktop is compact auto-height while mobile preserves aspect-ratio 1:1', () => {
  const desktopMatch = templateHtml.match(/\.stat-card\{([^}]+)\}/);
  assert.ok(desktopMatch, '.stat-card base rule must exist');
  assert.strictEqual(desktopMatch[1].includes('aspect-ratio:1'), false, 'Desktop stat-card must not have aspect-ratio:1');
  assert.ok(templateHtml.includes('.stat-card{aspect-ratio:1'), 'Mobile stat-card must retain aspect-ratio:1');
});

