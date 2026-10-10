const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function api() {
  const file = path.join(root, 'js/arabic-search.js');
  if (fs.existsSync(file)) {
    const context = vm.createContext({setTimeout, clearTimeout});
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    return context.TabaatSearch;
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const code = html.slice(html.indexOf('function normalizeArabic('), html.indexOf('const catalogueState'));
  return {normalize: vm.runInNewContext(code + ';normalizeArabic')};
}
const fixtures = [
  ['  إِبْـن   رَجَب ', 'بن رجب'], ['مصطفى', 'مصطفي'],
  ['الأرناؤوط', 'الارناووط'], ['رئيس', 'رييس'], ['قراءة', 'قراه'],
  ['ٱلرِّسَالة\u06e1', 'الرساله'], ['ابن، رجب', 'بن، رجب'],
  ['ابناء بنان مبنى', 'ابنا بنان مبني'], ['Book\nTitle', 'book title'],
];
for (const [input, expected] of fixtures) test('Arabic search: ' + input, () => {
  assert.equal(api().normalize(input), expected);
});
test('indexed fields are reused and replacement books get fresh fields', () => {
  const search = api();
  assert.equal(typeof search.fields, 'function');
  const book = {title:'مصطفى', author:'ابن رجب', category:['فقه'], best_editions:[{publisher:'مؤسسة الرسالة',verifier:'الأرناؤوط'}]};
  const first = search.fields(book);
  assert.equal(search.fields(book), first);
  assert.equal(first.title, 'مصطفي');
  assert.equal(first.author, 'بن رجب');
  assert.deepEqual(Array.from(first.publishers), ['موسسه الرساله']);
  assert.equal(search.fields({...book,title:'كتاب جديد'}).title, 'كتاب جديد');
});
test('debounce only applies the latest value and cancellation prevents stale work', async () => {
  const search = api();
  assert.equal(typeof search.debounce, 'function');
  const calls=[]; const run=search.debounce(value=>calls.push(value),20);
  run('old');run('new');assert.deepEqual(calls,[]);
  await new Promise(r=>setTimeout(r,40));assert.deepEqual(calls,['new']);
  run('stale');run.cancel();await new Promise(r=>setTimeout(r,40));
  assert.deepEqual(calls,['new']);
});

test('Worker ranking uses shared fields and refreshes the index when the catalogue changes', async()=>{
  let books=[{id:1,title:'مصطفى',author:'ابن رجب'}, {id:2,title:'آخر',author:'كاتب'}];
  const context=vm.createContext({setTimeout,clearTimeout,fetch:async()=>({ok:true,text:async()=>JSON.stringify(books)})});
  vm.runInContext(fs.readFileSync(path.join(root,'js/arabic-search.js'),'utf8'),context);
  const source=fs.readFileSync(path.join(root,'telegram-bot/src/index.js'),'utf8')
    .replace(/^import .*;$/gm,'').replace(/^export \{.*\}.*;$/gm,'').replace('export default','const worker =');
  vm.runInContext(source,context);
  assert.deepEqual(Array.from(await context.selectRelevantBooks('مصطفي'), b=>b.id),[1]);
  assert.deepEqual(Array.from(await context.selectRelevantBooks('بن رجب'), b=>b.id),[1]);
  books=[{id:1,title:'جديد',author:'كاتب'}];
  assert.equal((await context.selectRelevantBooks('مصطفي')).length,0);
  assert.deepEqual(Array.from(await context.selectRelevantBooks('جديد'), b=>b.id),[1]);
});
