const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const fixture = (overrides = {}) => ({ id: 1, title: 'كتاب', author: "O'Neil", category: ['علوم'], best_editions: [], alt_editions: [], links: [], ...overrides });
async function app(file, books) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/tabaat/' + file, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
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
  w.sessionStorage.setItem('__adm_auth__', '776804fd62f4788b');
  for (const name of ['vendor/purify.min.js', 'js/content-security.js']) {
    if (fs.existsSync(path.join(root, name))) w.eval(fs.readFileSync(path.join(root, name), 'utf8'));
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!match[2].trim() || /application\/ld\+json/.test(match[1])) continue;
    let source = match[2];
    if (file === 'admin/index.html') source = source.replace(/\}\)\(\);\s*$/, 'window.__admin = { state, loadBookIntoForm, saveBook, addCategoryInput }; })();');
    w.eval(source);
  }
  await new Promise(resolve => w.setTimeout(resolve, 20));
  return {dom, w, document:w.document};
}
async function using(file, books, check) {
  const instance = await app(file, books);
  try { await check(instance); } finally { instance.dom.window.close(); }
}

test('catalogue fields render as text instead of creating attacker elements', async () => {
  const value = '<img src=x onerror="alert(1)">';
  await using('index.html', [fixture({ title:value, author:value, category:[value], best_editions:[{publisher:value, verifier:value, volumes:'1" onmouseover="alert(1)', images:[]}] })], ({document:d}) => {
    const card=d.querySelector('.md-card');
    assert.equal(card.querySelector('.book-title').textContent, value);
    assert.equal(card.querySelector('img'), null);
    assert.equal(card.querySelector('[onmouseover]'), null);
  });
});
test('author containing apostrophe remains actionable without executable data', async () => {
  await using('index.html', [fixture()], ({document:d,w}) => {
    const trigger = d.querySelector('.meta-chip');
    assert.equal(trigger.getAttribute('onclick'), null);
    trigger.click();
    assert.ok(d.getElementById('choiceTitle').textContent.includes("O'Neil"));
    d.querySelector('#choiceActions button').click();
    assert.equal(d.getElementById('searchInput').value,"O'Neil");
  });
});
test('book and edition notes remove scripts, CSS, clobbering and executable URLs but keep formatting', async () => {
  const note='<p id="booksContainer" style="background:url(https://evil.test)"><b>ملاحظة</b><a href="javascript:alert(1)">رابط</a><img src=x onerror="alert(1)"><svg onload="alert(1)"></svg><script>alert(1)</script></p>';
  await using('index.html', [fixture({notes:note,best_editions:[{publisher:'دار',notes:note,images:[]}]})], ({document:d}) => {
    const notes=d.querySelector('.book-notes');
    assert.equal(notes.querySelector('img,svg,script,[style],[id]'),null);
    assert.equal(notes.querySelector('b').textContent,'ملاحظة');
    assert.equal(notes.querySelector('a[href^="javascript:"]'),null);
    d.querySelector('.edition-actions button').click();
    assert.equal(d.querySelector('#modalBody img, #modalBody script'),null);
    assert.equal(d.querySelector('#modalBody b').textContent,'ملاحظة');
  });
});
test('unsafe links never become navigable and safe PDF titles survive quotes',async()=>{
  await using('index.html',[fixture({links:[{title:'dangereux',url:'javascript:alert(1)'},{title:'PDF "test" O\'Neil',url:'https://example.test/file.pdf?version=1'}]})],async({document:d,w})=>{
    assert.equal(d.querySelector('a[href^="javascript:"]'),null);
    const pdf=d.querySelector('.md-list-item button'); assert.ok(pdf);
    pdf.click();
    await new Promise(resolve => w.setTimeout(resolve,0));
    assert.equal(d.getElementById('pdfViewerTitle').textContent,'PDF "test" O\'Neil');
    assert.ok(d.getElementById('pdfViewerIframe').src.startsWith('blob:https://example.test/'));
    assert.equal(w.__blobs.get(d.getElementById('pdfViewerIframe').src).type,'application/pdf');
  });
});
test('correction bodies and image URL attributes are protected',async()=>{
  const corr={title:'<img src=x onerror="alert(1)">',body:'<ul><li><u>تصحيح</u></li></ul><img src=x onerror="alert(1)">',attachments:[{title:'bad',url:'data:text/html,<script>alert(1)</script>'},{title:'صورة',url:'https://example.test/image.png'}]};
  await using('index.html',[fixture({best_editions:[{publisher:'دار',images:['x" onerror="alert(1)'],corrections:[corr]}]})],({document:d,w})=>{
    w.openCorrectionsModal(1,'best_editions',0); assert.equal(d.querySelector('#modalBody img'),null);
    d.querySelector('.corr-item-clickable').click();
    assert.equal(d.querySelector('.corr-detail-title').textContent,corr.title);
    assert.equal(d.querySelector('.corr-detail-body img'),null);
    assert.equal(d.querySelector('.corr-detail-body u').textContent,'تصحيح');
    assert.equal(d.querySelector('#modalBody img[src^="data:"]'),null);
    w.openImageModal(1,'best_editions',0);
    assert.equal(d.querySelector('#modalBody [onerror]'),null);
  });
});
test('PDF viewer refuses executable URLs even when called directly',async()=>{
  await using('index.html',[fixture()],({w,document:d})=>{
    w.openPdfViewer('javascript:alert(1)','bad');
    assert.notEqual(d.getElementById('pdfViewerIframe').getAttribute('src'),'javascript:alert(1)');
  });
});
test('admin loading sanitizes every rich editor and safely renders category and input attributes',async()=>{
  const note='<b>texte</b><img src=x onerror="alert(1)"><a href="data:text/html,bad">lien</a>';
  await using('admin/index.html',[fixture({category:['<img src=x onerror="alert(1)">'],notes:note,best_editions:[{publisher:'دار "test"',notes:note,images:[],volumes:'1" onfocus="alert(1)',corrections:[{title:'titre',body:note}]}]})],({w,document:d})=>{
    w.__admin.loadBookIntoForm(1);
    for(const editor of d.querySelectorAll('.rich-editor-content')) {
      assert.equal(editor.querySelector('img,[onerror],a[href^="data:"]'),null);
    }
    assert.equal(d.querySelector('#categoriesList img'),null);
    assert.equal(d.querySelector('.ed-publisher').value,'دار "test"');
    assert.equal(d.querySelector('[onfocus]'),null);
  });
});
test('admin save sanitizes rich content before publication',async()=>{
  await using('admin/index.html',[fixture()],({w,document:d})=>{
    w.__admin.loadBookIntoForm(1);
    d.getElementById('notes').innerHTML='<b>conservé</b><img src=x onerror="alert(1)"><script>bad()</script>';
    w.__admin.saveBook({preventDefault(){}});
    assert.equal(w.__admin.state.pendingChanges.upserts.get(1).notes,'<b>conservé</b>');
  });
});
test('paste into admin rich editor sanitizes before inserting',async()=>{
  await using('admin/index.html',[fixture()],({w,document:d})=>{
    const editor=d.getElementById('notes');
    editor.focus(); const selection=w.getSelection(); const range=d.createRange(); range.selectNodeContents(editor);range.collapse(false); selection.removeAllRanges();selection.addRange(range);
    const event=new w.Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'clipboardData',{value:{getData:type=>type==='text/html'?'<b>collé</b><img src=x onerror="bad()">':'collé'}});
    editor.dispatchEvent(event);
    assert.equal(event.defaultPrevented,true);
    assert.equal(editor.querySelector('img'),null);
    assert.equal(editor.querySelector('b').textContent,'collé');
  });
});
test('admin rejects unsafe URL before saving a book',async()=>{
  await using('admin/index.html',[fixture({links:[{title:'bad',url:'https://example.test'}]})],({w,document:d})=>{
    w.__admin.loadBookIntoForm(1);d.querySelector('.link-url').value='javascript:alert(1)';
    w.__admin.saveBook({preventDefault(){}});
    assert.equal(w.__admin.state.pendingChanges.upserts.size,0);
  });
});

test('reviews from same origin escape names and sanitize rich messages',async()=>{
  await using('reviews.html',[{name:'<img src=x onerror="bad()">',message:'<b>avis</b><img src=x onerror="bad()">'}],({document:d})=>{
    assert.ok(d.querySelector('.review-name').textContent.includes('<img src=x onerror="bad()">'));
    assert.equal(d.querySelector('.review-card img'),null);
    assert.equal(d.querySelector('.review-message b').textContent,'avis');
  });
});
test('URL policy blocks encoded scheme tricks and preserves relative files',async()=>{
  await using('index.html',[fixture()],({w})=>{
    for(const url of ['javascript:alert(1)',' java\nscript:alert(1)','data:image/svg+xml,<svg/>','vbscript:bad()','https://u:p@example.test/a','file:///etc/passwd']) assert.equal(w.TabaatContent.safeUrl(url),'');
    assert.equal(w.TabaatContent.safeUrl('images/cover.jpg'),'https://example.test/tabaat/images/cover.jpg');
    assert.equal(w.TabaatContent.isPdf('https://example.test/a.PDF?v=1#page=2'),true);
    assert.equal(w.TabaatContent.isPdf('https://example.test/page?name=a.pdf'),false);
  });
});
test('admin preserves quoted titles and URLs without creating attributes',async()=>{
  await using('admin/index.html',[fixture({links:[{title:'" autofocus onfocus="bad()',url:'https://example.test/" onfocus="bad()'}]})],({w,document:d})=>{
    w.__admin.loadBookIntoForm(1);
    assert.equal(d.querySelector('.link-title').value,'" autofocus onfocus="bad()');
    assert.equal(d.querySelector('#links [onfocus]'),null);
    assert.equal(d.querySelector('#links [autofocus]'),null);
  });
});
test('catalogue formatting, pagination and edition actions still work with real data',async()=>{
  const books=JSON.parse(fs.readFileSync(path.join(root,'books.json'),'utf8'));
  await using('index.html',books,({w,document:d})=>{
    assert.equal(d.querySelectorAll('#booksContainer > .md-card').length,20);
    w.renderBooksChunk();assert.equal(d.querySelectorAll('#booksContainer > .md-card').length,40);
    const trigger=d.querySelector('[data-action="images"]');assert.ok(trigger);trigger.click();
    assert.ok(d.querySelector('#modalBody .carousel-img').src.startsWith('https://'));
    w.openBookCardModal(books[0].id);assert.equal(d.querySelector('#bookCardModalBody .book-title').textContent,books[0].title);
  });
});
test('rich sanitizer fails closed if local DOMPurify is unavailable',()=>{
  const dom=new JSDOM('',{url:'https://example.test',runScripts:'outside-only'});
  try {
    dom.window.eval(fs.readFileSync(path.join(root,'js/content-security.js'),'utf8'));
    const holder=dom.window.document.createElement('div');
    holder.innerHTML=dom.window.TabaatContent.sanitizeRichHtml('<img src=x onerror="bad()">');
    assert.equal(holder.querySelector('img'),null);
    assert.equal(holder.textContent,'<img src=x onerror="bad()">');
  } finally {dom.window.close();}
});

test('admin rich local links resolve against catalogue root and survive save',async()=>{
  await using('admin/index.html',[fixture({notes:'<a href="corrections/a.pdf">PDF</a>'})],({w,document:d})=>{
    w.__admin.loadBookIntoForm(1);
    assert.equal(d.querySelector('#notes a').href,'https://example.test/tabaat/corrections/a.pdf');
    w.__admin.saveBook({preventDefault(){}});
    assert.equal(w.__admin.state.pendingChanges.upserts.get(1).notes,'<a href="https://example.test/tabaat/corrections/a.pdf" rel="noopener noreferrer">PDF</a>');
  });
});
test('safe HTTP asset paths containing an apostrophe remain usable',async()=>{
  await using('index.html',[fixture()],({w})=>{
    assert.equal(w.TabaatContent.safeUrl("https://example.test/O'Neil.pdf"),"https://example.test/O'Neil.pdf");
  });
});

test('PDF preview rejects HTML served under a PDF filename',async()=>{
  await using('index.html',[fixture()],async({w,document:d})=>{
    w.__pdfBytes=Buffer.from('<html><script>bad()</script></html>');
    await w.openPdfViewer('https://example.test/fake.pdf','bad');
    assert.equal(w.__blobs.size,0);
    assert.ok(!d.getElementById('pdfViewerIframe').src.includes('fake.pdf'));
    assert.ok(d.getElementById('pdfViewerStatus').textContent.length>0);
  });
});
test('closing PDF preview revokes its temporary URL',async()=>{
  await using('index.html',[fixture()],async({w})=>{
    await w.openPdfViewer('https://example.test/valid.pdf','PDF');
    assert.equal(w.__blobs.size,1);
    w.closePdfViewer();assert.equal(w.__blobs.size,0);
  });
});

test('late PDF response cannot reopen a closed preview',async()=>{
  await using('index.html',[fixture()],async({w,document:d})=>{
    let resolve;w.fetch=()=>new Promise(done=>{resolve=done});
    const pending=w.openPdfViewer('https://example.test/valid.pdf','PDF');
    w.closePdfViewer();
    resolve({ok:true,arrayBuffer:async()=>Buffer.from('%PDF-1.4\nfixture')});
    await pending;
    assert.equal(w.__blobs.size,0);
    assert.equal(d.getElementById('pdfViewerIframe').getAttribute('src'),'');
    assert.equal(d.getElementById('pdfViewerModal').style.display,'none');
  });
});
test('external PDF fetch failure offers an isolated link without embedding it',async()=>{
  await using('index.html',[fixture()],async({w,document:d})=>{
    w.fetch=async()=>{throw new Error('CORS')};
    await w.openPdfViewer('https://other.test/valid.pdf','PDF');
    assert.equal(d.getElementById('pdfViewerIframe').getAttribute('src'),'');
    const link=d.querySelector('#pdfViewerStatus a');
    assert.equal(link.href,'https://other.test/valid.pdf');
    assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
  });
});
test('rich editor drops preserve formatting without dangerous elements',async()=>{
  await using('admin/index.html',[fixture()],({w,document:d})=>{
    const editor=d.getElementById('notes');
    const event=new w.Event('drop',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'dataTransfer',{value:{getData:type=>type==='text/html'?'<i>déposé</i><img src=x onerror="bad()">':''}});
    editor.dispatchEvent(event);
    assert.equal(event.defaultPrevented,true);assert.equal(editor.querySelector('img'),null);
    assert.equal(editor.querySelector('i').textContent,'déposé');
  });
});
test('keyboard activates catalogue actions with quoted scalar data',async()=>{
  await using('index.html',[fixture()],({w,document:d})=>{
    d.querySelector('.meta-chip').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    assert.ok(d.getElementById('choiceTitle').textContent.includes("O'Neil"));
  });
});
test('correction image selection uses the matching validated attachment',async()=>{
  await using('index.html',[fixture({best_editions:[{publisher:'دار',images:[],corrections:[{title:'corr',body:'body',attachments:[{url:'javascript:bad()',title:'bad'},{url:'https://example.test/a.png',title:'A'},{url:'https://example.test/b.png',title:'B'}]}]}]})],({w,document:d})=>{
    w.showCorrectionDetail(1,'best_editions',0,0);
    d.querySelectorAll('.attach-thumb')[1].click();
    assert.equal(d.getElementById('pdfViewerImg').src,'https://example.test/b.png');
    assert.equal(d.getElementById('pdfViewerTitle').textContent,'B');
  });
});
