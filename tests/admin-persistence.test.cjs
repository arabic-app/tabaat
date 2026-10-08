const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.resolve(__dirname, '..');
const fixture = (id=1) => ({id,title:'Original '+id,author:'Author',category:[],best_editions:[],alt_editions:[],links:[]});
const settle = () => new Promise(r=>setTimeout(r,80));
async function app(books, storage = new IDBFactory(), options = {}) {
  const file = 'admin/index.html';
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/tabaat/' + file, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.indexedDB = storage;
  Object.defineProperty(w.navigator, 'locks', {value:options.locks || {request:async(name, opts, callback)=>callback({})}});
  w.structuredClone = structuredClone;
  let deletions = [];
  w.HTMLFormElement.prototype.submit = function () { deletions.push(Number(this.querySelector('[name=rowIndex]').value)); };
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.matchMedia = () => ({matches: false, addEventListener() {}});
  w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.Sortable = class {};
  w.__pdfBytes = Buffer.from('%PDF-1.4\nfixture');
  w.__blobs = new Map();
  w.URL.createObjectURL = blob => { const url = 'blob:https://example.test/pdf-' + w.__blobs.size; w.__blobs.set(url, blob); return url; };
  w.URL.revokeObjectURL = url => w.__blobs.delete(url);
  w.fetch = async url => ({ok: true, headers: {get: () => null}, arrayBuffer: async () => w.__pdfBytes, json: async () => String(url).includes('sciences') ? ['علوم'] : books, text: async () => String(url).includes('reviews.json') ? JSON.stringify(books) : ''});
  if (options.fetch) w.fetch = options.fetch;
  w.localStorage.setItem('sync_name', 'test');
  w.localStorage.setItem('github_token_secured', 'test-token');
  w.sessionStorage.setItem('__adm_auth__', '776804fd62f4788b');
  for (const name of ['vendor/purify.min.js', 'js/content-security.js', 'js/admin-draft-store.js', 'js/catalogue-data.js']) {
    if (fs.existsSync(path.join(root, name))) w.eval(fs.readFileSync(path.join(root, name), 'utf8'));
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!match[2].trim() || /application\/ld\+json/.test(match[1])) continue;
    let source = match[2];
    if (file === 'admin/index.html') source = source.replace(/\}\)\(\);\s*$/, 'window.__admin = { state, loadBookIntoForm, saveBook, addCategoryInput, createNewBook, executeDeleteBook, syncToGitHub, acceptSuggestion }; })();');
    w.eval(source);
  }
  await new Promise(resolve => w.setTimeout(resolve, 80));
  return {dom, w, document:w.document, deletions};
}

function input(a, id, value) { const el=a.document.getElementById(id); el.value=value; el.dispatchEvent(new a.w.Event('input',{bubbles:true})); }
function save(a) { a.w.__admin.saveBook({preventDefault(){}}); }
async function reload(a, books, storage) { await settle(); a.w.close(); return app(books,storage); }
test('saved changes survive reload and merge onto the freshly loaded catalogue',async()=>{
 const db=new IDBFactory(); let a=await app([fixture()],db);
 try { a.w.__admin.loadBookIntoForm(1); input(a,'title','Local saved'); save(a);
 a=await reload(a,[fixture(),fixture(2)],db);
 assert.equal(a.w.__admin.state.books.find(b=>b.id===1).title,'Local saved');
 assert.equal(a.w.__admin.state.books.length,2);
 assert.equal(a.w.__admin.state.pendingChanges.upserts.size,1);
 assert.equal(a.document.getElementById('title').value,'Local saved');
 } finally {a.w.close();}
});
test('unsaved form survives reload without becoming a publishable change',async()=>{
 const db=new IDBFactory(); let a=await app([fixture()],db);
 try {a.w.__admin.createNewBook(); input(a,'title','Draft only');
 a.document.getElementById('notes').innerHTML='<b>Rich draft</b>';
 a.document.getElementById('notes').dispatchEvent(new a.w.Event('input',{bubbles:true}));
 a=await reload(a,[fixture()],db);
 assert.equal(a.document.getElementById('title').value,'Draft only');
 assert.equal(a.document.getElementById('notes').innerHTML,'<b>Rich draft</b>');
 assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
 } finally {a.w.close();}
});
test('local deletion survives reload',async()=>{
 const db=new IDBFactory(); let a=await app([fixture()],db);
 try { a.w.__admin.loadBookIntoForm(1); a.w.__admin.executeDeleteBook();
 a=await reload(a,[fixture()],db); assert.equal(a.w.__admin.state.books.length,0);
 assert.ok(a.w.__admin.state.pendingChanges.deletes.has(1));
 } finally {a.w.close();}
});
test('switching between books preserves unsaved forms',async()=>{
 const a=await app([fixture(),fixture(2)]);
 try {a.w.__admin.loadBookIntoForm(1); input(a,'title','Unsubmitted');
 a.w.__admin.loadBookIntoForm(2); a.w.__admin.loadBookIntoForm(1);
 assert.equal(a.document.getElementById('title').value,'Unsubmitted');
 } finally {a.w.close();}
});
test('suggestion remains until GitHub confirms publication, including after failed sync',async()=>{
 let allow=false; const a=await app([fixture()],new IDBFactory(), {fetch:async(url,opts={})=>{
 if(String(url).includes('api.github.com')) return opts.method==='PUT' ? {ok:allow,status:500,json:async()=>({message:'failure'})} : {ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture()])).toString('base64')})};
 return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=> 'type,book,edition\nbook,Suggestion,Publisher'};
 }});
 try {a.w.__admin.acceptSuggestion(0); save(a); assert.deepEqual(a.deletions,[]);
 await a.w.__admin.syncToGitHub(); assert.deepEqual(a.deletions,[]);
 assert.equal(a.w.__admin.state.pendingChanges.upserts.size,1);
 allow=true; await a.w.__admin.syncToGitHub(); assert.deepEqual(a.deletions,[2]);
 assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
 } finally {a.w.close();}
});

test('failed local storage is visible and does not discard in-memory edits',async()=>{
 const a=await app([fixture()],{open(){throw new Error('storage disabled');}});
 try {a.w.__admin.createNewBook(); input(a,'title','Keep this'); save(a); await settle();
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'error');
 assert.equal(a.document.getElementById('title').value,'Keep this');
 assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
 } finally {a.w.close();}
});
test('an edit made during publication survives both success and reload',async()=>{
 const db=new IDBFactory(); let release; let started;
 const waiting=new Promise(r=>started=r); const gate=new Promise(r=>release=r);
 let a=await app([fixture()],db,{fetch:async(url,opts={})=>{
 if(String(url).includes('api.github.com')) {
 if(opts.method==='PUT'){started();await gate;return {ok:true};}
 return {ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture()])).toString('base64')})};
 }
 return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=>''};
 }});
 try {a.w.__admin.loadBookIntoForm(1); input(a,'title','First');save(a);
 const sync=a.w.__admin.syncToGitHub();await waiting;input(a,'title','Second');save(a);release();await sync;
 assert.equal(a.w.__admin.state.pendingChanges.upserts.get(1).title,'Second');
 a=await reload(a,[fixture()],db);assert.equal(a.w.__admin.state.pendingChanges.upserts.get(1).title,'Second');
 } finally {a.w.close();}
});
test('unfinished corrections, links and raw volume digits survive reload',async()=>{
 const db=new IDBFactory(); let a=await app([fixture()],db);
 try {a.w.__admin.createNewBook();
 a.document.querySelector('.btn-add-correction').click();
 a.document.querySelector('.corr-title').value='Unfinished';
 a.document.querySelector('.ed-volumes').value='٠٢';
 a.document.querySelector('.ed-volumes').dispatchEvent(new a.w.Event('input',{bubbles:true}));
 a=await reload(a,[fixture()],db);
 assert.equal(a.document.querySelector('.corr-title').value,'Unfinished');
 assert.equal(a.document.querySelector('.ed-volumes').value,'٠٢');
 } finally {a.w.close();}
});
test('persisted suggestion is matched by content after its sheet row moves',async()=>{
 const db=new IDBFactory(); let a=await app([fixture()],db,{fetch:async url=>({ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=> 'type,book,edition\nbook,Suggestion,Publisher'})});
 try {a.w.__admin.acceptSuggestion(0);save(a);a=await reload(a,[fixture()],db);
 a.w.fetch=async(url,opts={})=>String(url).includes('api.github.com') ? (opts.method==='PUT'?{ok:true}:{ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture()])).toString('base64')})}) : {ok:true,text:async()=> 'type,book,edition\nbook,Other,Other\nbook,Suggestion,Publisher'};
 await a.w.__admin.syncToGitHub();assert.deepEqual(a.deletions,[3]);
 } finally {a.w.close();}
});
test('ambiguous identical suggestions are kept after publication',async()=>{
 const a=await app([fixture()]);
 try {a.w.__admin.state.suggestions=[{_rowIndex:2,type:'book',book:'Suggestion',edition:'Publisher'}];a.w.__admin.acceptSuggestion(0);save(a);
 a.w.fetch=async(url,opts={})=>String(url).includes('api.github.com') ? (opts.method==='PUT'?{ok:true}:{ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture()])).toString('base64')})}) : {ok:true,text:async()=> 'type,book,edition\nbook,Suggestion,Publisher\nbook,Suggestion,Publisher'};
 await a.w.__admin.syncToGitHub();assert.deepEqual(a.deletions,[]);
 } finally {a.w.close();}
});
test('local journal contains editing data and no GitHub credential',async()=>{
 const a=await app([fixture()]);
 try {a.w.__admin.createNewBook();input(a,'title','Local');
 const journal=a.w.localStorage.getItem('tabaat-admin-drafts-v1');
 assert.ok(journal && journal.includes('Local'));assert.ok(!journal.includes('test-token'));
 } finally {a.w.close();}
});

test('accepting the same suggestion twice sends a single row deletion',async()=>{
 const a=await app([fixture()]);
 try {a.w.__admin.state.suggestions=[{_rowIndex:2,type:'book',book:'Suggestion',edition:'Publisher'}];
 a.w.__admin.acceptSuggestion(0);save(a);a.w.__admin.acceptSuggestion(0);save(a);
 a.w.fetch=async(url,opts={})=>String(url).includes('api.github.com') ? (opts.method==='PUT'?{ok:true}:{ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture()])).toString('base64')})}) : {ok:true,text:async()=> 'type,book,edition\nbook,Suggestion,Publisher\nbook,Next,Other'};
 await a.w.__admin.syncToGitHub();assert.deepEqual(a.deletions,[2]);
 } finally {a.w.close();}
});
test('immediate recovery journal advances even for edits in the same millisecond',async()=>{
 const a=await app([fixture()]);
 try {a.w.Date.now=()=>123;a.w.__admin.createNewBook();input(a,'title','First');
 const first=JSON.parse(a.w.localStorage.getItem('tabaat-admin-drafts-v1'));
 input(a,'title','Second');const second=JSON.parse(a.w.localStorage.getItem('tabaat-admin-drafts-v1'));
 assert.ok(second.updatedAt>first.updatedAt);
 } finally {a.w.close();}
});


test('a second active admin tab cannot overwrite the first tab local work',async()=>{
 const db=new IDBFactory(); let held=false;
 const locks={request:async(name,options,callback)=>{const granted=!held;if(granted)held=true;return callback(granted?{}:null);}};
 const a=await app([fixture(),fixture(2)],db,{locks});const b=await app([fixture(),fixture(2)],db,{locks});
 try {a.w.__admin.loadBookIntoForm(1);input(a,'title','First tab');save(a);await settle();
 b.w.__admin.loadBookIntoForm(2);input(b,'title','Second tab');save(b);await settle();
 assert.equal(b.document.getElementById('localSaveStatus').dataset.state,'locked');
 const reloaded=await app([fixture(),fixture(2)],db);
 try {assert.equal(reloaded.w.__admin.state.books.find(book=>book.id===1).title,'First tab');}finally{reloaded.w.close();}
 }finally{a.w.close();b.w.close();}
});

test('retry after a failed initial read preserves previously unread edits',async()=>{
 const db=new IDBFactory();const first=await app([fixture(),fixture(2)],db);
 first.w.__admin.loadBookIntoForm(1);input(first,'title','Old durable edit');save(first);await settle();first.w.close();
 let unavailable=true;const storage={open(...args){if(unavailable)throw new Error('Temporarily inaccessible');return db.open(...args);}};
 const a=await app([fixture(),fixture(2)],storage);
 try {a.w.__admin.createNewBook();input(a,'title','New memory edit');save(a);await settle();
 assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
 assert.equal(a.w.localStorage.getItem('tabaat-admin-drafts-v1'),null);
 unavailable=false;a.document.getElementById('retryLocalSave').click();await settle();
 assert.equal(a.w.__admin.state.pendingChanges.upserts.get(1)?.title,'Old durable edit');
 assert.equal(a.document.getElementById('title').value,'New memory edit');
 save(a);await settle();assert.equal(a.w.__admin.state.pendingChanges.upserts.get(3)?.title,'New memory edit');
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'saved');
 }finally{a.w.close();}
});

test('an unknown stored schema is preserved instead of being overwritten',async()=>{
 const db=new IDBFactory();const seed=await app([fixture()],db);seed.w.__admin.createNewBook();input(seed,'title','Old draft');await settle();seed.w.close();
 const connection=await new Promise((resolve,reject)=>{const r=db.open('tabaat-admin-drafts',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise((resolve,reject)=>{const tx=connection.transaction('state','readwrite');tx.objectStore('state').put({version:99,updatedAt:Date.now(),important:'Do not discard'},'editing');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 connection.close();const a=await app([fixture()],db);
 try {a.w.__admin.createNewBook();input(a,'title','New memory draft');save(a);await settle();
 assert.equal(a.w.localStorage.getItem('tabaat-admin-drafts-v1'),null);
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'error');
 }finally{a.w.close();}
});
