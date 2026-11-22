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
  let deletions = [], submissions = [];
  w.HTMLFormElement.prototype.submit = function () {
    submissions.push(Object.fromEntries([...this.querySelectorAll('input')].map(input=>[input.name,input.value])));
    const row = this.querySelector('[name=rowIndex]');
    if (row) deletions.push(Number(row.value));
    options.onSubmit?.(submissions.at(-1));
  };
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
  if (options.loginDelay === undefined) w.sessionStorage.setItem('__adm_auth__', '776804fd62f4788b');
  else {
    w.TextEncoder = TextEncoder;
    const expected = html.match(/PASSWORD_HASH: '([a-f0-9]+)'/)[1];
    Object.defineProperty(w.crypto, 'subtle', {value:{digest:async()=>{
      await new Promise(resolve=>setTimeout(resolve,options.loginDelay));
      return Uint8Array.from(Buffer.from(expected,'hex')).buffer;
    }}});
  }
  if (options.journal) w.localStorage.setItem('tabaat-admin-drafts-v1', JSON.stringify(options.journal));
  for (const name of ['js/arabic-search.js', 'vendor/purify.min.js', 'js/content-security.js', 'js/admin-draft-store.js', 'js/catalogue-data.js']) {
    if (fs.existsSync(path.join(root, name))) w.eval(fs.readFileSync(path.join(root, name), 'utf8'));
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!match[2].trim() || /application\/ld\+json/.test(match[1])) continue;
    let source = match[2];
    if (file === 'admin/index.html') source = source.replace(/\}\)\(\);\s*$/, 'window.__admin = { state, loadBookIntoForm, saveBook, addCategoryInput, createNewBook, executeDeleteBook, syncToGitHub, acceptSuggestion, openRejectModal, executeReject, openReplyEmailModal, sendReplyEmail }; })();');
    w.eval(source);
  }
  await new Promise(resolve => w.setTimeout(resolve, 80));
  return {dom, w, document:w.document, deletions, submissions};
}

function input(a, id, value) { const el=a.document.getElementById(id); el.value=value; el.dispatchEvent(new a.w.Event('input',{bubbles:true})); }
function save(a) { a.w.__admin.saveBook({preventDefault(){}}); }
async function reload(a, books, storage) { await settle(); a.w.close(); return app(books,storage); }
test('viewing and clicking an unchanged book never creates a draft, including after reload', async () => {
 const db = new IDBFactory(); let a = await app([fixture(), fixture(2)], db);
 try {
 a.w.__admin.loadBookIntoForm(1);
 a.document.getElementById('title').click();
 a.document.getElementById('title').dispatchEvent(new a.w.Event('change', {bubbles: true}));
 await settle();
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state, 'published');
 assert.equal(a.document.getElementById('localDrafts').hidden, true);
 a.w.__admin.loadBookIntoForm(2);
 await settle();
 const exit = new a.w.Event('beforeunload', {cancelable: true});
 a.w.dispatchEvent(exit);
 assert.equal(exit.defaultPrevented, false);
 a = await reload(a, [fixture(), fixture(2)], db);
 assert.equal(a.document.getElementById('title').value, 'Original 2');
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state, 'published');
 assert.equal(a.document.getElementById('localDrafts').hidden, true);
 assert.equal(a.w.__admin.state.pendingChanges.upserts.size, 0);
 } finally { a.w.close(); }
});
test('reverting a real edit clears its draft even after restoring it from local storage', async () => {
 const db = new IDBFactory(); let a = await app([fixture()], db);
 try {
 a.w.__admin.loadBookIntoForm(1); input(a, 'title', 'Changed'); await settle();
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state, 'draft');
 a = await reload(a, [fixture()], db);
 input(a, 'title', 'Original 1'); await settle();
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state, 'published');
 assert.equal(a.document.getElementById('formTitle').textContent, 'تعديل: Original 1');
 assert.equal(a.document.getElementById('localDrafts').hidden, true);
 } finally { a.w.close(); }
});
test('reverting an edit to an already saved book keeps its pending publication', async () => {
 const a = await app([fixture()]);
 try {
 a.w.__admin.loadBookIntoForm(1); input(a, 'title', 'Saved locally'); save(a);
 input(a, 'title', 'Unsaved'); await settle();
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state, 'draft');
 input(a, 'title', 'Saved locally'); await settle();
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state, 'saved');
 assert.equal(a.w.__admin.state.pendingChanges.upserts.get(1).title, 'Saved locally');
 } finally { a.w.close(); }
});
for (const changed of [false, true]) test(`legacy stored drafts preserve real edits and clear false drafts: changed=${changed}`, async () => {
 const book = {...fixture(), category: [''], notes: ''};
 if (changed) book.title = 'Real old edit';
 const a = await app([fixture()], new IDBFactory(), {journal: {
 version: 1, updatedAt: Date.now(), active: '1',
 drafts: [['1', {book, suggestion: null, dirty: true}]], suggestions: [], upserts: [], deletes: []
 }});
 try {
 assert.equal(a.document.getElementById('title').value, book.title);
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state, changed ? 'draft' : 'published');
 assert.equal(a.document.getElementById('formTitle').textContent, (changed ? 'مسودة: ' : 'تعديل: ') + book.title);
 if (changed) {
 input(a, 'title', 'Original 1'); await settle();
 assert.equal(a.document.getElementById('localSaveStatus').dataset.state, 'published');
 }
 } finally { a.w.close(); }
});
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

test('admin search matches Arabic variants and clearing cancels the pending query', async()=>{
 const a=await app([{...fixture(),title:'مصطفى',author:'ابن رجب'},fixture(2)]);
 try {
  input(a,'adminSearchInput','مصطفي');
  await new Promise(r=>setTimeout(r,220));
  assert.equal(a.document.querySelectorAll('#booksList li').length,1);
  input(a,'adminSearchInput','absent');
  a.document.getElementById('clearSearchBtn').click();
  await new Promise(r=>setTimeout(r,220));
  assert.equal(a.document.querySelectorAll('#booksList li').length,2);
 }finally{a.w.close();}
});

test('catalogue status includes drafts on books other than the open book', async()=>{
 const a=await app([fixture(),fixture(2)]);
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','Draft A');await settle();
  a.w.__admin.loadBookIntoForm(2);await settle();
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'draft');
  assert.equal(a.document.getElementById('bookSyncStatus').dataset.state,'published');
 }finally{a.w.close();}
});

test('pending publication on another book does not mark the open book as pending', async()=>{
 const a=await app([fixture(),fixture(2)]);
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','Saved A');save(a);
  a.w.__admin.loadBookIntoForm(2);await settle();
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'saved');
  assert.equal(a.document.getElementById('bookSyncStatus').dataset.state,'published');
 }finally{a.w.close();}
});

test('saving an unchanged book leaves its publication queue and date unchanged', async()=>{
 const original={...fixture(),date:'2020-01-01'};
 const a=await app([original]);
 try {
  a.w.__admin.loadBookIntoForm(1);save(a);await settle();
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
  assert.equal(a.w.__admin.state.books[0].date,'2020-01-01');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
 }finally{a.w.close();}
});

test('reloading a previously viewed book displays fresh remote data', async()=>{
 const db=new IDBFactory();let a=await app([fixture()],db);
 try {
  a.w.__admin.loadBookIntoForm(1);await settle();
  a=await reload(a,[{...fixture(),title:'Remote update'}],db);
  assert.equal(a.document.getElementById('title').value,'Remote update');
  save(a);await settle();assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
 }finally{a.w.close();}
});

test('reverting an edit after publication restores the published status', async()=>{
 const a=await app([fixture()],new IDBFactory(),{fetch:async(url,opts={})=>{
  if(String(url).includes('api.github.com')) return opts.method==='PUT'?{ok:true}:{ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture()])).toString('base64')})};
  return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=>''};
 }});
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','Published title');save(a);
  await a.w.__admin.syncToGitHub();await settle();
  input(a,'title','Temporary change');await settle();input(a,'title','Published title');await settle();
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
  const exit=new a.w.Event('beforeunload',{cancelable:true});a.w.dispatchEvent(exit);
  assert.equal(exit.defaultPrevented,false);
 }finally{a.w.close();}
});

for (const active of [false, true]) test(`successful publication refreshes clean cached forms without reloading: active=${active}`,async()=>{
 const remote=[fixture(),{...fixture(2),author:'Remote author'}];
 const a=await app([fixture(),fixture(2)],new IDBFactory(),{fetch:async(url,opts={})=>{
  if(String(url).includes('api.github.com'))return opts.method==='PUT'?{ok:true}:{ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify(remote)).toString('base64')})};
  return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture(),fixture(2)],text:async()=>''};
 }});
 try {
  a.w.__admin.loadBookIntoForm(2);a.w.__admin.loadBookIntoForm(1);input(a,'title','Local A');save(a);
  if(active)a.w.__admin.loadBookIntoForm(2);
  await a.w.__admin.syncToGitHub();
  if(!active)a.w.__admin.loadBookIntoForm(2);
  assert.equal(a.document.getElementById('author').value,'Remote author');
  input(a,'title','Local B');save(a);
  assert.equal(a.w.__admin.state.pendingChanges.upserts.get(2).author,'Remote author');
 }finally{a.w.close();}
});

test('normalization-only edits do not create a publication or leave a dirty draft',async()=>{
 const original={...fixture(),date:'2020-01-01',best_editions:[{publisher:'Publisher',images:[],notes:'',corrections:[],volumes:2}]};
 const a=await app([original]);
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','  Original 1  ');input(a,'author',' Author ');
  a.document.querySelector('.ed-volumes').value='٠٢';
  a.document.querySelector('.ed-volumes').dispatchEvent(new a.w.Event('input',{bubbles:true}));
  save(a);await settle();
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
  assert.equal(a.w.__admin.state.books[0].date,'2020-01-01');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
 }finally{a.w.close();}
});

test('normalizing a saved local change preserves the pending publication',async()=>{
 const a=await app([fixture()]);
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','Pending title');save(a);
  const pending=a.w.__admin.state.pendingChanges.upserts.get(1);
  input(a,'title',' Pending title ');save(a);await settle();
  assert.equal(a.w.__admin.state.pendingChanges.upserts.get(1),pending);
  assert.equal(a.document.getElementById('title').value,'Pending title');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'saved');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
 }finally{a.w.close();}
});

test('refresh after publication preserves an unsaved edit made during the request',async()=>{
 const db=new IDBFactory();let release,started;
 const waiting=new Promise(resolve=>started=resolve);const gate=new Promise(resolve=>release=resolve);
 let a=await app([fixture(),fixture(2)],db,{fetch:async(url,opts={})=>{
  if(String(url).includes('api.github.com')) {
   if(opts.method==='PUT'){started();await gate;return {ok:true};}
   return {ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture(),{...fixture(2),author:'Remote author'}])).toString('base64')})};
  }
  return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture(),fixture(2)],text:async()=>''};
 }});
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','Publish A');save(a);a.w.__admin.loadBookIntoForm(2);
  const sync=a.w.__admin.syncToGitHub();await waiting;input(a,'title','Keep unsaved B');release();await sync;
  assert.equal(a.document.getElementById('title').value,'Keep unsaved B');
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
  a=await reload(a,[fixture(),{...fixture(2),author:'Remote author'}],db);
  assert.equal(a.document.getElementById('title').value,'Keep unsaved B');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'draft');
 }finally{a.w.close();}
});

for (const reloaded of [false,true]) test(`reverting a draft uses fresh remote fields before the next edit: reloaded=${reloaded}`,async()=>{
 const db=new IDBFactory();const remote=[fixture(),{...fixture(2),author:'Remote author'}];
 let a=await app([fixture(),fixture(2)],db,{fetch:async(url,opts={})=>{
  if(String(url).includes('api.github.com'))return opts.method==='PUT'?{ok:true}:{ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify(remote)).toString('base64')})};
  return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture(),fixture(2)],text:async()=>''};
 }});
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','Publish A');save(a);
  a.w.__admin.loadBookIntoForm(2);input(a,'title','Draft B');
  await a.w.__admin.syncToGitHub();
  if(reloaded)a=await reload(a,remote,db);
  assert.equal(a.document.getElementById('title').value,'Draft B');
  input(a,'title','Original 2');await settle();
  assert.equal(a.document.getElementById('author').value,'Remote author');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
  input(a,'title','Next edit');save(a);
  assert.equal(a.w.__admin.state.pendingChanges.upserts.get(2).author,'Remote author');
 }finally{a.w.close();}
});

test('reverting a draft of a remotely deleted book closes the stale form',async()=>{
 const a=await app([fixture(),fixture(2)],new IDBFactory(),{fetch:async(url,opts={})=>{
  if(String(url).includes('api.github.com'))return opts.method==='PUT'?{ok:true}:{ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture()])).toString('base64')})};
  return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture(),fixture(2)],text:async()=>''};
 }});
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','Publish A');save(a);
  a.w.__admin.loadBookIntoForm(2);input(a,'title','Draft B');await a.w.__admin.syncToGitHub();
  input(a,'title','Original 2');await settle();
  assert.equal(a.document.getElementById('formContainer').getAttribute('aria-hidden'),'true');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
  const exit=new a.w.Event('beforeunload',{cancelable:true});a.w.dispatchEvent(exit);
  assert.equal(exit.defaultPrevented,false);
 }finally{a.w.close();}
});

for(const failure of ['offline','invalid']) test(`catalogue ${failure} blocks creating and publishing colliding books until retry succeeds`,async()=>{
 let available=false,puts=0;
 const a=await app([fixture()],new IDBFactory(),{fetch:async(url,opts={})=>{
  if(String(url).includes('api.github.com')){if(opts.method==='PUT')puts++;return {ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify([fixture()])).toString('base64')})};}
  if(String(url).includes('books.json')&&!available){if(failure==='offline')throw new Error('offline');return {ok:true,json:async()=>({wrong:'shape'})};}
  return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=>''};
 }});
 try {
  a.w.__admin.createNewBook();input(a,'title','Collision');save(a);await a.w.__admin.syncToGitHub();
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);assert.equal(puts,0);
  assert.equal(a.document.getElementById('catalogueLoadError').hidden,false);
  available=true;a.document.getElementById('retryCatalogueLoad').click();await settle();
  a.w.__admin.createNewBook();input(a,'title','New book');save(a);
  assert.equal(a.w.__admin.state.pendingChanges.upserts.get(2).title,'New book');
  assert.equal(a.w.__admin.state.books.find(book=>book.id===1).title,'Original 1');
 }finally{a.w.close();}
});

test('invalid sciences data does not discard a valid book catalogue',async()=>{
 const a=await app([fixture()],new IDBFactory(),{fetch:async url=>({ok:true,json:async()=>{
  if(String(url).includes('sciences'))throw new Error('invalid JSON');return [fixture()];
 },text:async()=>''})});
 try {assert.equal(a.w.__admin.state.books.length,1);a.w.__admin.createNewBook();input(a,'title','New');save(a);assert.ok(a.w.__admin.state.pendingChanges.upserts.has(2));}
 finally{a.w.close();}
});

test('slow successful login initializes the admin exactly once',async()=>{
 let catalogueReads=0;
 const a=await app([fixture()],new IDBFactory(),{loginDelay:650,fetch:async url=>{
  if(String(url).includes('books.json'))catalogueReads++;
  return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=>''};
 }});
 try {
  input(a,'authPasswordInput','simulated valid password');
  a.document.getElementById('authForm').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,1000));
  assert.equal(a.w.__admin.state.books.length,1);assert.equal(catalogueReads,1);
  a.document.getElementById('btn-new-book-sidebar').click();assert.equal(a.document.getElementById('formContainer').getAttribute('aria-hidden'),'false');
 }finally{a.w.close();}
});

for(const confirmed of [false,true]) test(`reject resolves the current row by content and requires confirmed absence: confirmed=${confirmed}`,async()=>{
 let csv='type,book,edition\nbook,Other,Other\nbook,Target,Publisher';
 const a=await app([fixture()],new IDBFactory(),{
  fetch:async url=>({ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=>csv}),
  onSubmit:request=>{if(confirmed&&request.action==='delete')csv='type,book,edition\nbook,Other,Other';}
 });
 try {
  a.w.__admin.state.suggestions=[{_rowIndex:2,type:'book',book:'Target',edition:'Publisher'}];
  a.w.__admin.openRejectModal(2,null);await a.w.__admin.executeReject();
  assert.deepEqual(a.deletions,[3]);
  const target=a.w.__admin.state.suggestions.some(row=>row.book==='Target');
  assert.equal(target,!confirmed);
  assert.equal(a.document.getElementById('toast').textContent.includes('تم حذف الاقتراح'),confirmed);
 }finally{a.w.close();}
});

test('duplicate notes or suggestions can be deleted one by one via executeReject',async()=>{
 let csv='type,book,edition\ngeneral,Note,Duplicate body\ngeneral,Note,Duplicate body';
 const a=await app([fixture()],new IDBFactory(),{
  fetch:async url=>({ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=>csv}),
  onSubmit:request=>{if(request.action==='delete'&&Number(request.rowIndex)===3)csv='type,book,edition\ngeneral,Note,Duplicate body';}
 });
 try {
  a.w.__admin.openRejectModal(3,null);await a.w.__admin.executeReject();
  assert.deepEqual(a.deletions,[3]);
  assert.equal(a.w.__admin.state.suggestions.length,1);
  assert.match(a.document.getElementById('toast').textContent,/تم حذف الاقتراح/);
 }finally{a.w.close();}
});

test('email without server acknowledgement retains its text and never claims successful delivery',async()=>{
 const a=await app([fixture()]);
 try {
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','Original');
  input(a,'replyEmailBody','Keep my reply');a.w.__admin.sendReplyEmail();
  await new Promise(resolve=>setTimeout(resolve,1900));
  assert.equal(a.document.getElementById('replyEmailModal').getAttribute('aria-hidden'),'false');
  assert.equal(a.document.getElementById('replyEmailBody').value,'Keep my reply');
  assert.doesNotMatch(a.document.getElementById('toast').textContent,/تم إرسال الرد/);
  assert.match(a.document.getElementById('replyEmailStatus').textContent,/تأكيد/);
  a.w.__admin.sendReplyEmail();assert.equal(a.submissions.length,1);
 }finally{a.w.close();}
});

test('catalogue outage preserves restored drafts while editing remains blocked',async()=>{
 const db=new IDBFactory();let available=false;let a=await app([fixture()],db);
 try {
  a.w.__admin.loadBookIntoForm(1);input(a,'title','Local draft');await settle();a.w.close();
  a=await app([fixture()],db,{fetch:async url=>{
   if(String(url).includes('books.json')) {
    if(!available)throw new Error('offline');
    return {ok:true,json:async()=>[{...fixture(),author:'Remote author'}]};
   }
   return {ok:true,json:async()=>[],text:async()=>''};
  }});
  assert.equal(a.document.getElementById('title').value,'Local draft');
  input(a,'title','Original 1');await settle();
  assert.equal(a.document.getElementById('formContainer').getAttribute('aria-hidden'),'false');
  assert.equal(a.document.getElementById('author').value,'Author');
  save(a);assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
  available=true;a.document.getElementById('retryCatalogueLoad').click();await settle();
  assert.equal(a.document.getElementById('author').value,'Remote author');
  input(a,'title','Next edit');save(a);
  assert.equal(a.w.__admin.state.pendingChanges.upserts.get(1).author,'Remote author');
 }finally{a.w.close();}
});

test('failed suggestion read sends no delete and restores its button',async()=>{
 const a=await app([fixture()]);
 try {
  a.w.__admin.state.suggestions=[{_rowIndex:2,type:'book',book:'Target',edition:'Publisher'}];
  const button=a.document.createElement('button');
  a.w.__admin.openRejectModal(2,button);a.w.fetch=async()=>({ok:false});
  await a.w.__admin.executeReject();assert.deepEqual(a.deletions,[]);assert.equal(button.disabled,false);
  assert.equal(a.w.__admin.state.suggestions.length,1);
 }finally{a.w.close();}
});

test('invalid CSV response cannot falsely confirm a suggestion deletion',async()=>{
 let posted=false;
 const a=await app([fixture()],new IDBFactory(),{
  fetch:async url=>({ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture()],text:async()=>posted?'<html>Service unavailable</html>':'type,book,edition\nbook,Target,Publisher'}),
  onSubmit:()=>posted=true
 });
 try {
  a.w.__admin.openRejectModal(2,null);await a.w.__admin.executeReject();
  assert.deepEqual(a.deletions,[2]);assert.equal(a.w.__admin.state.suggestions.length,1);
  assert.doesNotMatch(a.document.getElementById('toast').textContent,/تم حذف الاقتراح/);
 }finally{a.w.close();}
});

test('reopening an unconfirmed email retains the reply and prevents duplicate submissions',async()=>{
 const a=await app([fixture()]);
 try {
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','Original');
  input(a,'replyEmailBody','Reply to keep');a.w.__admin.sendReplyEmail();
  const status=a.document.getElementById('replyEmailStatus').textContent;
  a.document.getElementById('btn-cancel-reply').click();
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','Original');
  assert.equal(a.document.getElementById('replyEmailBody').value,'Reply to keep');
  assert.equal(a.document.getElementById('replyEmailStatus').textContent,status);
  assert.equal(a.document.getElementById('btn-send-reply').disabled,true);
  assert.equal(a.document.getElementById('replyEmailBody').readOnly,true);
  a.w.__admin.sendReplyEmail();assert.equal(a.submissions.length,1);
 }finally{a.w.close();}
});

test('reply drafts and submission states remain separate for different messages',async()=>{
 const a=await app([fixture()]);
 try {
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','First message');
  input(a,'replyEmailBody','First reply');a.w.__admin.sendReplyEmail();
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','Second message');
  assert.equal(a.document.getElementById('replyEmailBody').value,'');
  assert.equal(a.document.getElementById('replyEmailBody').readOnly,false);
  assert.equal(a.document.getElementById('btn-send-reply').disabled,false);
  input(a,'replyEmailBody','Second draft');
  a.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  a.w.__admin.openReplyEmailModal('other@example.test','Subject','Second message');
  assert.equal(a.document.getElementById('replyEmailBody').value,'');
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','Second message');
  assert.equal(a.document.getElementById('replyEmailBody').value,'Second draft');
  assert.equal(a.document.getElementById('btn-send-reply').disabled,false);
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','First message');
  assert.equal(a.document.getElementById('replyEmailBody').value,'First reply');
  assert.equal(a.document.getElementById('btn-send-reply').disabled,true);
  assert.equal(a.submissions.length,1);
 }finally{a.w.close();}
});

test('a reply that fails before submission stays editable after reopening',async()=>{
 const a=await app([fixture()]);
 try {
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','Original');
  input(a,'replyEmailBody','Retry this reply');
  const submit=a.w.HTMLFormElement.prototype.submit;
  a.w.HTMLFormElement.prototype.submit=function(){throw new Error('submission blocked');};
  a.w.__admin.sendReplyEmail();
  const status=a.document.getElementById('replyEmailStatus').textContent;
  a.document.getElementById('btn-cancel-reply').click();
  a.w.__admin.openReplyEmailModal('recipient@example.test','Subject','Original');
  assert.equal(a.document.getElementById('replyEmailBody').value,'Retry this reply');
  assert.equal(a.document.getElementById('replyEmailStatus').textContent,status);
  assert.equal(a.document.getElementById('btn-send-reply').disabled,false);
  assert.equal(a.document.getElementById('replyEmailBody').readOnly,false);
  a.w.HTMLFormElement.prototype.submit=submit;
  a.w.__admin.sendReplyEmail();assert.equal(a.submissions.length,1);
 }finally{a.w.close();}
});

test('createNewBook without edits never creates a dirty draft, accumulates empty drafts, or blocks reload', async()=>{
 const db=new IDBFactory(); let a=await app([fixture()],db);
 try {
  a.w.__admin.createNewBook();
  await settle();
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
  const exit=new a.w.Event('beforeunload',{cancelable:true}); a.w.dispatchEvent(exit);
  assert.equal(exit.defaultPrevented,false);
  a.w.__admin.createNewBook();
  a.w.__admin.loadBookIntoForm(1);
  await settle();
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
  a.w.__admin.createNewBook();
  await settle();
  a=await reload(a,[fixture()],db);
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
 }finally{a.w.close();}
});

test('editing a new book then clearing all fields resets dirty to false', async()=>{
 const a=await app([fixture()]);
 try {
  a.w.__admin.createNewBook();
  input(a,'title','Temporary'); await settle();
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'draft');
  assert.equal(a.document.getElementById('localDrafts').hidden,false);
  input(a,'title',''); await settle();
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
  const exit=new a.w.Event('beforeunload',{cancelable:true}); a.w.dispatchEvent(exit);
  assert.equal(exit.defaultPrevented,false);
 }finally{a.w.close();}
});

test('startup cleans all legacy unchanged non-active drafts and category=[] asymmetry', async()=>{
 const cleanOne={...fixture(1),category:[],notes:''};
 const cleanTwo={...fixture(2),category:[],notes:''};
 const dirtyThree={...fixture(3),title:'Real Edit 3',category:[''],notes:''};
 const emptyNew={id:null,title:'',author:'',category:[''],notes:'',best_editions:[{publisher:'',verifier:'',volumes:'',images:[''],notes:'',corrections:[],attachments:[]}],alt_editions:[],links:[]};
 const a=await app([fixture(1),fixture(2),fixture(3)],new IDBFactory(),{journal:{
  version:1,updatedAt:Date.now(),active:'1',
  drafts:[
   ['1',{book:cleanOne,suggestion:null,dirty:true}],
   ['2',{book:cleanTwo,suggestion:null,dirty:true}],
   ['3',{book:dirtyThree,suggestion:null,dirty:true}],
   ['new:ghost',{book:emptyNew,suggestion:null,dirty:true}]
  ],
  suggestions:[],upserts:[],deletes:[]
 }});
 try {
  const options=[...a.document.getElementById('localDrafts').options].map(o=>o.value).filter(Boolean);
  assert.deepEqual(options,['3']);
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'draft');
  assert.equal(a.document.getElementById('bookSyncStatus').dataset.state,'published');
  a.w.__admin.loadBookIntoForm(2); await settle();
  assert.equal(a.document.getElementById('bookSyncStatus').dataset.state,'published');
 }finally{a.w.close();}
});

test('rich editors leaving <br>, <div><br></div> or <p><br></p> do not create false dirty drafts', async()=>{
 const a=await app([{...fixture(),best_editions:[{publisher:'P',images:[],notes:'',corrections:[{title:'C',body:'',attachments:[]}]}]}]);
 try {
  a.w.__admin.loadBookIntoForm(1);
  const notes=a.document.getElementById('notes');
  const edNotes=a.document.querySelector('.ed-notes');
  const corrBody=a.document.querySelector('.corr-body');
  notes.innerHTML='<br>';
  edNotes.innerHTML='<div><br></div>';
  corrBody.innerHTML='<p><br></p>';
  notes.dispatchEvent(new a.w.Event('input',{bubbles:true}));
  await settle();
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
  assert.equal(a.document.getElementById('localDrafts').hidden,true);
 }finally{a.w.close();}
});

test('localSaveStatus omits 0 مسودة when only pending changes exist', async()=>{
 const a=await app([fixture()]);
 try {
  a.w.__admin.loadBookIntoForm(1);
  input(a,'title','Saved only');
  save(a);
  await settle();
  const status=a.document.getElementById('localSaveStatus');
  assert.equal(status.dataset.state,'saved');
  assert.doesNotMatch(status.textContent,/0 مسودة/);
  assert.match(status.textContent,/1 تغيير/);
 }finally{a.w.close();}
});

test('btnDiscardDraft discards dirty new and existing book drafts appropriately', async()=>{
 const a=await app([fixture(1),fixture(2)]);
 try {
  a.w.__admin.createNewBook();
  assert.equal(a.document.getElementById('btnDiscardDraft').style.display,'none');
  input(a,'title','New Draft'); await settle();
  assert.equal(a.document.getElementById('btnDiscardDraft').style.display,'inline-flex');
  a.document.getElementById('btnDiscardDraft').click(); await settle();
  assert.equal(a.document.getElementById('formContainer').getAttribute('aria-hidden'),'true');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');

  a.w.__admin.loadBookIntoForm(1);
  input(a,'title','Saved Title'); save(a);
  input(a,'title','Dirty Over Saved'); await settle();
  assert.equal(a.document.getElementById('btnDiscardDraft').style.display,'inline-flex');
  a.document.getElementById('btnDiscardDraft').click(); await settle();
  assert.equal(a.document.getElementById('title').value,'Saved Title');
  assert.equal(a.document.getElementById('bookSyncStatus').dataset.state,'saved');
  assert.equal(a.document.getElementById('btnDiscardDraft').style.display,'none');

  a.w.__admin.loadBookIntoForm(2);
  input(a,'title','Dirty Published'); await settle();
  a.document.getElementById('btnDiscardDraft').click(); await settle();
  assert.equal(a.document.getElementById('title').value,'Original 2');
  assert.equal(a.document.getElementById('bookSyncStatus').dataset.state,'published');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'saved');
 }finally{a.w.close();}
});

test('saving values identical to remoteBooks clears the pending publication and restores date', async()=>{
 const original={...fixture(1),date:'2021-05-10'};
 const a=await app([original]);
 try {
  a.w.__admin.loadBookIntoForm(1);
  input(a,'title','Temporary Save'); save(a);
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,1);
  input(a,'title','Original 1'); save(a); await settle();
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
  assert.equal(a.w.__admin.state.books[0].date,'2021-05-10');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');
 }finally{a.w.close();}
});

test('btnRevertSaved reverts pending edits on existing books and removes unpublished new books', async()=>{
 const original={...fixture(1),date:'2020-02-02'};
 const a=await app([original]);
 try {
  a.w.__admin.loadBookIntoForm(1);
  assert.equal(a.document.getElementById('btnRevertSaved').style.display,'none');
  input(a,'title','Pending Edit'); save(a);
  assert.equal(a.document.getElementById('btnRevertSaved').style.display,'inline-flex');
  a.document.getElementById('btnRevertSaved').click(); await settle();
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
  assert.equal(a.w.__admin.state.books[0].title,'Original 1');
  assert.equal(a.w.__admin.state.books[0].date,'2020-02-02');
  assert.equal(a.document.getElementById('title').value,'Original 1');
  assert.equal(a.document.getElementById('localSaveStatus').dataset.state,'published');

  a.w.__admin.createNewBook();
  input(a,'title','Unpublished New'); save(a);
  assert.equal(a.w.__admin.state.books.length,2);
  a.document.getElementById('btnRevertSaved').click(); await settle();
  assert.equal(a.w.__admin.state.books.length,1);
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
  assert.equal(a.document.getElementById('formContainer').getAttribute('aria-hidden'),'true');
 }finally{a.w.close();}
});

test('sidebar items expose draft and saved status attributes without altering textContent', async()=>{
 const a=await app([fixture(1),fixture(2)]);
 try {
  a.w.__admin.loadBookIntoForm(1);
  input(a,'title','Draft 1'); await settle();
  let li1=a.document.querySelector('#booksList li[data-id="1"]');
  assert.equal(li1.dataset.status,'draft');
  assert.equal(li1.textContent,'Original 1');
  save(a); await settle();
  li1=a.document.querySelector('#booksList li[data-id="1"]');
  assert.equal(li1.dataset.status,'saved');
  assert.equal(li1.textContent,'Draft 1');
  const li2=a.document.querySelector('#booksList li[data-id="2"]');
  assert.equal(li2.dataset.status,undefined);
 }finally{a.w.close();}
});

test('acceptSuggestion reuses an existing unpublished draft for the same suggestion instead of duplicating', async()=>{
 const a=await app([fixture(1)]);
 try {
  a.w.__admin.state.suggestions=[{_rowIndex:2,type:'book',book:'Suggested Book',edition:'Ed 1',verifier:'Ver 1'}];
  a.w.__admin.acceptSuggestion(0); await settle();
  a.w.__admin.loadBookIntoForm(1);
  a.w.__admin.acceptSuggestion(0); await settle();
  const options=[...a.document.getElementById('localDrafts').options].map(o=>o.value).filter(Boolean);
  assert.equal(options.length,1);
 }finally{a.w.close();}
});

test('suggestions and feedback keep edition and verifier aligned by index when a verifier is empty', async()=>{
 const a=await app([fixture(1)]);
 try {
  a.w.__admin.state.suggestions=[{_rowIndex:2,type:'book',book:'Aligned Book',edition:'دار ١ ## دار ٢',verifier:' ## محقق ٢',source:'مصدر'}];
  a.w.__admin.acceptSuggestion(0);
  const rows=[...a.document.querySelectorAll('#bestEditions > .dynamic-row')];
  assert.equal(rows.length,2);
  assert.equal(rows[0].querySelector('.ed-publisher').value,'دار ١');
  assert.equal(rows[0].querySelector('.ed-verifier').value,'');
  assert.equal(rows[1].querySelector('.ed-publisher').value,'دار ٢');
  assert.equal(rows[1].querySelector('.ed-verifier').value,'محقق ٢');
 }finally{a.w.close();}

 const fbHtml=fs.readFileSync(path.join(root,'feedback.html'),'utf8');
 const fbDom=new JSDOM(fbHtml,{url:'https://example.test/tabaat/feedback.html',runScripts:'outside-only',pretendToBeVisual:true});
 const fw=fbDom.window;
 try {
  fw.fetch=async()=>({ok:true,json:async()=>[]});
  let submitted=null;
  fw.HTMLFormElement.prototype.submit=function(){
   submitted=Object.fromEntries([...this.querySelectorAll('input')].map(i=>[i.name,i.value]));
  };
  for(const name of ['js/arabic-search.js','js/catalogue-data.js']){
   if(fs.existsSync(path.join(root,name))) fw.eval(fs.readFileSync(path.join(root,name),'utf8'));
  }
  for(const match of fbHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(match[2].trim()) fw.eval(match[2]);
  }
  await new Promise(r=>fw.setTimeout(r,30));
  fw.addEditionRow();
  fw.addEditionRow();
  const eds=fw.document.querySelectorAll('#editionsList .edition-input');
  const vers=fw.document.querySelectorAll('#editionsList .verifier-input');
  eds[0].value='طبعة ١'; vers[0].value='محقق ١';
  eds[1].value='طبعة ٢'; vers[1].value='';
  eds[2].value='طبعة ٣'; vers[2].value='محقق ٣';
  fw.document.getElementById('bookInput').value='كتاب اختبار';
  fw.document.getElementById('sourceInput').value='عالم';
  fw.document.getElementById('suggestionForm').dispatchEvent(new fw.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>fw.setTimeout(r,20));
  assert.equal(submitted.edition,'طبعة ١##طبعة ٢##طبعة ٣');
  assert.equal(submitted.verifier,'محقق ١####محقق ٣');
 }finally{fw.close();}
});

test('syncToGitHub reallocates colliding new book IDs instead of overwriting concurrent remote books', async()=>{
 let pushed=null;
 const concurrentRemote=[fixture(1),{...fixture(2),title:'Concurrent Remote Book'}];
 const a=await app([fixture(1)],new IDBFactory(),{fetch:async(url,opts={})=>{
  if(String(url).includes('api.github.com')){
   if(opts.method==='PUT'){pushed=JSON.parse(Buffer.from(JSON.parse(opts.body).content,'base64').toString('utf8')); return {ok:true};}
   return {ok:true,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify(concurrentRemote)).toString('base64')})};
  }
  return {ok:true,json:async()=>String(url).includes('sciences')?[]:[fixture(1)],text:async()=>''};
 }});
 try {
  a.w.__admin.createNewBook();
  input(a,'title','Local New Book'); save(a);
  assert.equal(a.w.__admin.state.pendingChanges.upserts.get(2).title,'Local New Book');
  await a.w.__admin.syncToGitHub();
  assert.equal(pushed.length,3);
  assert.equal(pushed.find(b=>b.id===2).title,'Concurrent Remote Book');
  assert.equal(pushed.find(b=>b.id===3).title,'Local New Book');
  assert.equal(a.document.getElementById('bookId').value,'3');
  assert.equal(a.w.__admin.state.pendingChanges.upserts.size,0);
 }finally{a.w.close();}
});

test('config modal reads, saves and clears stats_key', async()=>{
 const a=await app([fixture(1)]);
 try {
  a.w.localStorage.setItem('stats_key','secret-stats-key');
  a.document.getElementById('btn-open-config').click();
  assert.equal(a.document.getElementById('configStatsKey').value,'secret-stats-key');
  input(a,'configStatsKey','updated-key');
  a.document.getElementById('configForm').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(a.w.localStorage.getItem('stats_key'),'updated-key');
  a.document.getElementById('btn-open-config').click();
  input(a,'configStatsKey','');
  a.document.getElementById('configForm').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(a.w.localStorage.getItem('stats_key'),null);
 }finally{a.w.close();}
});

test('admin html has no orphan closing button and repeated category/autocomplete setups close cleanly', async()=>{
 const html=fs.readFileSync(path.join(root,'admin/index.html'),'utf8');
 assert.doesNotMatch(html,/<\/button>\s*<\/button>\s*<\/header>/);
 const a=await app([fixture(1)]);
 try {
  a.w.__admin.loadBookIntoForm(1);
  a.w.__admin.addCategoryInput('فقه');
  const displays=a.document.querySelectorAll('#categoriesList .searchable-select-display');
  displays[displays.length-1].click();
  const dropdowns=a.document.querySelectorAll('#categoriesList .searchable-select-dropdown.open');
  assert.equal(dropdowns.length,1);
  a.document.body.click();
  assert.equal(a.document.querySelectorAll('#categoriesList .searchable-select-dropdown.open').length,0);
 }finally{a.w.close();}
});

test('feedback note submission keeps submit button disabled in flight and blocks duplicate submissions', async()=>{
 const fbHtml=fs.readFileSync(path.join(root,'feedback.html'),'utf8');
 const fbDom=new JSDOM(fbHtml,{url:'https://example.test/tabaat/feedback.html',runScripts:'outside-only',pretendToBeVisual:true});
 const fw=fbDom.window;
 try {
  fw.fetch=async()=>({ok:true,json:async()=>[],text:async()=>''});
  const submissions=[];
  fw.HTMLFormElement.prototype.submit=function(){
   submissions.push(Object.fromEntries([...this.querySelectorAll('input')].map(i=>[i.name,i.value])));
  };
  for(const name of ['js/arabic-search.js','js/catalogue-data.js']){
   if(fs.existsSync(path.join(root,name))) fw.eval(fs.readFileSync(path.join(root,name),'utf8'));
  }
  for(const match of fbHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(match[2].trim()) fw.eval(match[2]);
  }
  await new Promise(r=>fw.setTimeout(r,30));
  fw.switchType('general');
  fw.document.getElementById('subjectInput').value='ملاحظة عامة';
  fw.document.getElementById('contentInput').value='تفاصيل الملاحظة';
  const form=fw.document.getElementById('suggestionForm');
  form.dispatchEvent(new fw.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(fw.document.getElementById('submitBtn').disabled,true);
  form.dispatchEvent(new fw.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(submissions.length,1);
  fw.document.getElementById('formResponseFrame').dispatchEvent(new fw.Event('load'));
  assert.equal(fw.document.getElementById('submitBtn').disabled,false);
  assert.equal(fw.document.getElementById('successState').classList.contains('visible'),true);
 }finally{fw.close();}
});
