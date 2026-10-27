/* Metadata search only: never claims to index remote document bodies. */
(function(root){
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
  function match(item, query, filters={}) {
    const haystack=normalize(`${item.name} ${item.description||''} ${item.ext||''}`);
    const terms=normalize(query).match(/"[^"]+"|\S+/g)||[];
    if(!terms.every(term=>term.startsWith('-')?!haystack.includes(term.slice(1).replace(/"/g,'')):haystack.includes(term.replace(/"/g,''))))return false;
    if(filters.ext && (item.kind!=='file'||normalize(item.ext)!==normalize(filters.ext)))return false;
    if(filters.owner && item.ownerId!==filters.owner)return false;
    if(filters.pinned && !item.starred)return false;
    const date=String(item.updatedAt||'').slice(0,10);
    if(filters.from && (!date||date<filters.from))return false;
    if(filters.to && (!date||date>filters.to))return false;
    if(filters.min && (item.kind!=='file'||(item.bytes||0)<Number(filters.min)*1048576))return false;
    if(filters.max && (item.kind!=='file'||(item.bytes||0)>Number(filters.max)*1048576))return false;
    return true;
  }
  const api={normalize,match};
  if(typeof module!=='undefined')module.exports=api;
  else root.DocHubSearch=api;
})(globalThis);
