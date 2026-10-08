const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');const path=require('node:path');
const {JSDOM}=require('jsdom');const {IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..');
const book=id=>({id,title:'Book '+id,author:'Author',category:[],best_editions:[],alt_editions:[],links:[]});
const response=(data,headers={})=>({ok:true,headers:{get:name=>headers[name]||null},json:async()=>data});
async function app(fetcher) {
  const file = 'index.html';
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/tabaat/' + file, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.indexedDB = new IDBFactory();
  w.structuredClone = structuredClone;
  Object.defineProperty(w.navigator, 'locks', {value:{request:async(name, options, callback)=>callback({})}});
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.matchMedia = () => ({matches: false, addEventListener() {}});
  w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.Sortable = class {};
  w.fetch = fetcher;
  w.sessionStorage.setItem('__adm_auth__', '776804fd62f4788b');
  for (const name of ['vendor/purify.min.js', 'js/content-security.js', 'js/admin-draft-store.js', 'js/catalogue-data.js']) {
    if (fs.existsSync(path.join(root, name))) w.eval(fs.readFileSync(path.join(root, name), 'utf8'));
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!match[2].trim() || /application\/ld\+json/.test(match[1])) continue;
    let source = match[2];
    w.eval(source);
  }
  await new Promise(resolve => w.setTimeout(resolve, 20));
  return {dom, w, document:w.document};
}

test('catalogue without data shows availability failure and a working retry',async()=>{
 let unavailable=true;const a=await app(async()=>{if(unavailable)throw Error('offline');return response([book(1)]);});
 try {const status=a.document.getElementById('catalogueStatus');assert.ok(status);assert.equal(status.dataset.state,'error');
 assert.equal(a.document.querySelector('.md-card'),null);unavailable=false;a.document.getElementById('retryCatalogue').click();
 await new Promise(r=>a.w.setTimeout(r,30));assert.equal(a.document.querySelector('.book-title').textContent,'Book 1');assert.equal(status.dataset.state,'fresh');
 }finally{a.w.close();}
});
test('cached catalogue displays its source and the date of the displayed data',async()=>{
 const a=await app(async()=>response([book(1)],{'X-Tabaat-Source':'cache','Last-Modified':'Wed, 07 Oct 2026 10:00:00 GMT','X-Tabaat-Cached-At':'2026-10-07T12:00:00.000Z'}));
 try {const status=a.document.getElementById('catalogueStatus');assert.ok(status);assert.equal(status.dataset.state,'cached');
 assert.ok(status.textContent.includes('محفوظة'));assert.ok(status.querySelector('time'));assert.equal(status.querySelector('time').dateTime,'2026-10-07T10:00:00.000Z');
 }finally{a.w.close();}
});
test('refresh failure preserves the displayed catalogue and its original date',async()=>{
 let failed=false;const a=await app(async()=>{if(failed)throw Error('failed');return response([book(1)],{'Last-Modified':'Wed, 07 Oct 2026 10:00:00 GMT'});});
 try {const status=a.document.getElementById('catalogueStatus');assert.ok(status);failed=true;await a.w.loadBooks();
 assert.equal(a.document.querySelector('.book-title').textContent,'Book 1');assert.equal(status.dataset.state,'stale');
 assert.equal(status.querySelector('time').dateTime,'2026-10-07T10:00:00.000Z');
 }finally{a.w.close();}
});
test('invalid catalogue data without a service worker is rejected visibly',async()=>{
 const a=await app(async()=>response([{id:1,title:'Invalid',best_editions:'broken'}]));
 try {const status=a.document.getElementById('catalogueStatus');assert.ok(status);assert.equal(status.dataset.state,'error');assert.equal(a.document.querySelector('.md-card'),null);
 }finally{a.w.close();}
});
