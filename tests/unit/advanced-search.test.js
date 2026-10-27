const {test}=require('node:test');
const assert=require('node:assert/strict');
const {match}=require('../../src/app/search-engine.js');
const fs=require('node:fs');
const path=require('node:path');
const item={kind:'file',name:'Quy định lương thưởng',description:'Phòng hành chính',ext:'pdf',ownerId:'u1',bytes:2*1048576,updatedAt:'2026-09-15T10:00:00Z',starred:true};
test('Advanced search combines accent-insensitive tokens, phrases and exclusions',()=>{
  assert.equal(match(item,'quy dinh "luong thuong" -video'),true);
  assert.equal(match(item,'quy dinh -thuong'),false);
  assert.equal(match(item,'quy khongco'),false);
});
test('Advanced filters combine exact format, owner, dates, sizes and pin',()=>{
  assert.equal(match(item,'',{ext:'PDF',owner:'u1',from:'2026-09-15',to:'2026-09-15',min:'2',max:'2',pinned:true}),true);
  for(const filter of [{ext:'docx'},{owner:'u2'},{from:'2026-09-16'},{to:'2026-09-14'},{min:'3'},{max:'1'}])assert.equal(match(item,'',filter),false);
  assert.equal(match({...item,kind:'folder'},'',{max:'3'}),false);
});
test('Search treats markup as literal data, not executable expressions',()=>{
  assert.equal(match({...item,name:'<script>alert(1)</script>'},'<script>'),true);
  assert.equal(match(item,''),true);
  assert.equal(match({...item,updatedAt:null},'',{from:'2026-01-01'}),false);
});
test('Filter layout groups ranges and progressively stacks on mobile',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../../src/app/index.template.html'),'utf8');
  assert.match(app, /fieldset class="search-filter-field"><legend>Khoảng cập nhật/);
  assert.match(app, /fieldset class="search-filter-field"><legend>Dung lượng/);
  assert.match(app, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(app, /\.search-filter-grid\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(app, /inputmode="decimal"/);
});
test('Mobile filters open a labelled modal sheet from an icon inside search',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../../src/app/index.template.html'),'utf8');
  assert.match(app,/id="filterSheet" class="filter-sheet" aria-labelledby="filterSheetTitle"/);
  assert.match(app,/searchHost\.append\(filterButton\)/);
  assert.match(app,/case 'open-filters':renderFilterSheet\(\);showDialog\('filterSheet'\)/);
  assert.match(app,/\.content-card>\.search-filters\{display:none\}/);
  assert.match(app,/filter-sheet::backdrop/);
});
