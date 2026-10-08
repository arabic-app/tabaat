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

test('catalogue loads after reconnecting when its initial fetch failed',async()=>{
 let unavailable=true;const a=await app(async()=>{if(unavailable)throw Error('offline');return response([book(1)]);});
 try {
  assert.equal(a.document.querySelector('.md-card'),null);
  unavailable=false;a.w.dispatchEvent(new a.w.Event('online'));
  await new Promise(r=>a.w.setTimeout(r,30));
  assert.equal(a.document.querySelector('.book-title').textContent,'Book 1');
 }finally{a.w.close();}
});
test('cached catalogue renders without status controls',async()=>{
 const a=await app(async()=>response([book(1)],{'X-Tabaat-Source':'cache','Last-Modified':'Wed, 07 Oct 2026 10:00:00 GMT'}));
 try {assert.equal(a.document.querySelector('.book-title').textContent,'Book 1');}
 finally{a.w.close();}
});
test('refresh failure preserves the displayed catalogue',async()=>{
 let failed=false;const a=await app(async()=>{if(failed)throw Error('failed');return response([book(1)]);});
 try {
  failed=true;await a.w.loadBooks();
  assert.equal(a.document.querySelector('.book-title').textContent,'Book 1');
 }finally{a.w.close();}
});
test('invalid catalogue data without a service worker never renders as books',async()=>{
 const a=await app(async()=>response([{id:1,title:'Invalid',best_editions:'broken'}]));
 try {assert.equal(a.document.querySelector('.md-card'),null);}
 finally{a.w.close();}
});
test('catalogue refreshes on reconnection without status controls',async()=>{
 let data=[book(1)];const a=await app(async()=>response(data));
 try {
  assert.equal(a.document.querySelector('.book-title').textContent,'Book 1');
  a.w.dispatchEvent(new a.w.Event('offline'));
  data=[book(2)];a.w.dispatchEvent(new a.w.Event('online'));
  await new Promise(r=>a.w.setTimeout(r,30));
  assert.equal(a.document.querySelector('.book-title').textContent,'Book 2');
 }finally{a.w.close();}
});
