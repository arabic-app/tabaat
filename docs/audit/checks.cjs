const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const main = fs.readFileSync(path.join(root,'index.html'),'utf8');
const admin = fs.readFileSync(path.join(root,'admin/index.html'),'utf8');
const worker = fs.readFileSync(path.join(root,'telegram-bot/src/index.js'),'utf8');
function extract(source, name) {
 const start = source.indexOf('function '+name+'(');
 const rest=source.slice(start);
 const end=rest.search(/\n    (?:    )?(?:async )?function |\n\/\/ ===/);
 return end<0?rest:rest.slice(0,end);
}
const normSource = main.slice(main.indexOf('function normalizeArabic('), main.indexOf('function loadBooks('));
const norm=vm.runInNewContext(normSource+';normalizeArabic');
let syntax=0;
for(const f of fs.readdirSync(root).filter(f=>f.endsWith('.html')).concat('admin/index.html')) {
 const html = fs.readFileSync(path.join(root,f),'utf8');
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if(/application\/ld\+json/.test(m[1])||!m[2].trim()) continue;
  new vm.Script(m[2],{filename:f}); syntax++;
 }
}
new vm.Script(fs.readFileSync(path.join(root,'sw.js'),'utf8'));
new vm.Script(worker.replace('export default','const worker ='));
console.log('Syntaxe valide:',syntax,'scripts HTML, service worker et Worker');
console.log('Recherche ابن رجب ≠ بن رجب:', norm('ابن رجب')!==norm('بن رجب'));
console.log('Recherche مصطفى ≠ مصطفي:', norm('مصطفى')!==norm('مصطفي'));
const fnStart=admin.indexOf('function mergeChangesOnto(');
const fnEnd=admin.indexOf('async function syncToGitHub(',fnStart);
const merge=vm.runInNewContext(admin.slice(fnStart,fnEnd)+';mergeChangesOnto',{state:{pendingChanges:{upserts:new Map([[433,{id:433,title:'livre A'}]]),deletes:new Set()}}});
const merged=merge([{id:433,title:'livre B'}]);
assert.equal(merged.length,1); assert.equal(merged[0].title,'livre A');
console.log('Création concurrente id=433: livre B écrasé par livre A');
console.log('Protection HTML : vérifiée par npm test (tests/security.test.cjs)');
const ctx={URL,Request,Response,console,caches:{default:{match:async()=>null,put:async()=>{}}}};
vm.createContext(ctx); vm.runInContext(worker.replace('export default','const worker =')+';globalThis.api=worker;',ctx);
(async()=>{
 let stored={v:0,u:0,c:0,s:{}};
 const cache={get:async()=>JSON.parse(JSON.stringify(stored)),put:async(k,v)=>{stored=JSON.parse(v)}};
 await Promise.all([ctx.bumpStat({CACHE:cache},s=>s.v++),ctx.bumpStat({CACHE:cache},s=>s.v++)]);
 assert.equal(stored.v,1);
 console.log('Analytics: 2 incréments concurrents donnent',stored.v,'vue au lieu de 2');
 const response=await ctx.api.fetch(new Request('https://example.test/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:123})}),{},{});
 assert.equal(response.status,500);
 console.log('Chat message numérique: HTTP',response.status,'au lieu de 400');
 const cacheKey = 'resp:' + [...ctx.searchTokens('صحيح البخاري')].sort().join(' ');
 const answers=new Map([[cacheKey,'cached answer']]);
 const kv={get:async key=>answers.get(key)||null,put:async()=>{throw new Error('analytics write failed')}};
 const out=await ctx.api.fetch(new Request('https://example.test/chat',{method:'POST',body:JSON.stringify({message:'صحيح البخاري'})}),{CACHE:kv},{});
 assert.equal(out.status,500);
 console.log('Réponse disponible en cache + analytics indisponible: HTTP',out.status);
})().catch(e=>{console.error(e);process.exitCode=1});
