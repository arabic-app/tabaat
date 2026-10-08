const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const origin='https://example.test/tabaat/';
const book=id=>({id,title:'Book '+id,author:'Author',best_editions:[],alt_editions:[],links:[]});
function harness(options={}) {
 const handlers={};const stores=new Map();const waits=[];let network=async()=>new Response(JSON.stringify([book(1)]),{headers:{'Content-Type':'application/json'}});
 const key=request=>new URL(typeof request==='string'?request:request.url,origin).href;
 const caches={
  keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),
  open:async name=>{if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);return {
   put:async(req,res)=>{entries.set(key(req),res.clone());},
   match:async(req,opts={})=>{const wanted=key(req);for(const [url,res]of entries)if(opts.ignoreSearch?url.split('?')[0]===wanted.split('?')[0]:url===wanted)return res.clone();},
   keys:async()=>[...entries.keys()].map(url=>new Request(url)),delete:async req=>entries.delete(key(req)),
   addAll:async urls=>{for(const url of urls)entries.set(key(url),new Response('precache'));}
  };},
  match:async(req,opts)=>{for(const name of stores.keys()){const res=await(await caches.open(name)).match(req,opts);if(res)return res;}}
 };
 const sandbox={self:{registration:{scope:origin},location:{origin:'https://example.test',href:origin+'sw.js'},addEventListener:(n,fn)=>handlers[n]=fn,skipWaiting(){},clients:{claim:async()=>{}}},caches,URL,Request,Response,Headers,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,options.timeout ? Math.min(ms,options.timeout) : ms),clearTimeout,console,fetch:(...args)=>network(...args)};
 vm.createContext(sandbox);sandbox.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);};
 vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),sandbox);
 return {stores,caches,setNetwork:fn=>network=fn,async lifecycle(name){const ps=[];handlers[name]({waitUntil:p=>ps.push(p)});await Promise.all(ps);},async request(url='books.json',extra={}){
   let result;const ps=[];handlers.fetch({request:new Request(new URL(url,origin),extra),respondWith:p=>result=Promise.resolve(p),waitUntil:p=>{ps.push(p);waits.push(p);}});
   if(!result)return null;const response=await result;await Promise.all(ps);return response;
 },waits};
}
test('successive data fetches use one canonical key and offline returns the latest catalogue',async()=>{
 const h=harness();for(let id=1;id<=3;id++){h.setNetwork(async()=>new Response(JSON.stringify([book(id)])));await h.request('books.json?_t='+id);}
 h.setNetwork(async()=>{throw Error('offline');});const res=await h.request('books.json?_t=4');assert.equal((await res.json())[0].id,3);
 const urls=[...h.stores.values()].flatMap(m=>[...m.keys()]).filter(url=>url.includes('books.json'));
 assert.deepEqual(urls,[origin+'books.json']);assert.equal(res.headers.get('X-Tabaat-Source'),'cache');
 assert.ok(h.waits.length);
});
test('offline without any cached catalogue is an availability error, not an empty success',async()=>{
 const h=harness();h.setNetwork(async()=>{throw Error('offline');});const res=await h.request();assert.equal(res.status,503);
});
for(const [label,response]of [
 ['invalid JSON',()=>new Response('<html>error</html>')],
 ['wrong JSON shape',()=>new Response(JSON.stringify({error:'bad'}))],
 ['invalid book fields',()=>new Response(JSON.stringify([{id:2,title:'Bad',best_editions:'invalid'}]))],
 ['HTTP failure',()=>new Response('server error',{status:500})]
])test(label+' preserves the last valid catalogue',async()=>{
 const h=harness();await h.request();h.setNetwork(async()=>response());const res=await h.request();assert.equal(res.headers.get('X-Tabaat-Source'),'cache');assert.equal((await res.json())[0].id,1);
});
test('activation preserves unrelated caches and migrates latest valid legacy data',async()=>{
 const h=harness();const old=await h.caches.open('tabaat-v16');
 await old.put(origin+'books.json?_t=1',new Response(JSON.stringify([book(1)])));
 await old.put(origin+'books.json?_t=2',new Response(JSON.stringify([book(2)])));
 await old.put(origin+'books.json?_t=3',new Response('invalid'));
 await h.caches.open('another-app');await h.lifecycle('activate');assert.ok(h.stores.has('another-app'));
 assert.ok(!h.stores.has('tabaat-v16'));h.setNetwork(async()=>{throw Error('offline');});const res=await h.request();assert.equal((await res.json())[0].id,2);
});
test('external requests and other applications are left to the browser',async()=>{
 const h=harness();assert.equal(await h.request('https://external.test/books.json'),null);assert.equal(await h.request('https://example.test/other/index.html'),null);
});
test('install avoids precaching admin pages that are network-only',async()=>{
 const h=harness();await h.lifecycle('install');const urls=[...h.stores.values()].flatMap(m=>[...m.keys()]);assert.ok(!urls.some(url=>new URL(url).pathname.includes('/admin/')));
});
test('the image cache evicts old entries instead of growing without limit',async()=>{
 const h=harness();h.setNetwork(async()=>new Response('image',{headers:{'Content-Type':'image/png'}}));for(let i=0;i<130;i++)await h.request('images/'+i+'.png');
 const urls=[...h.stores.values()].flatMap(m=>[...m.keys()]).filter(url=>url.includes('/images/'));assert.ok(urls.length<=100);assert.ok(urls.includes(origin+'images/129.png'));
});

test('overlapping cache writes cannot make an older catalogue the offline version',async()=>{
 const h=harness();const open=h.caches.open;h.caches.open=async name=>{const cache=await open(name);const put=cache.put;
 cache.put=async(req,res)=>{const text=await res.clone().text();if(text.includes('Book 1'))await new Promise(r=>setTimeout(r,40));return put(req,res);};return cache;};
 let id=0;h.setNetwork(async()=>new Response(JSON.stringify([book(++id)])));
 const first=h.request();await new Promise(r=>setTimeout(r,5));const second=h.request();await Promise.all([first,second]);
 h.setNetwork(async()=>{throw Error('offline');});assert.equal((await(await h.request()).json())[0].id,2);
});
test('initial installation makes a validated catalogue available on the first offline revisit',async()=>{
 const h=harness();await h.lifecycle('install');await h.lifecycle('activate');h.setNetwork(async()=>{throw Error('offline');});
 const res=await h.request();assert.equal(res.status,200);assert.equal((await res.json())[0].id,1);
});


test('correction and attachment images share the bounded content image cache',async()=>{
 const h=harness();h.setNetwork(async()=>new Response('image',{headers:{'Content-Type':'image/png'}}));
 for(let i=0;i<130;i++)await h.request((i%2?'corrections/':'books_attachments/')+i+'.png');
 const urls=[...h.stores.values()].flatMap(m=>[...m.keys()]).filter(url=>url.includes('/corrections/')||url.includes('/books_attachments/'));
 assert.ok(urls.length<=100);assert.ok(urls.includes(origin+'corrections/129.png'));
});
test('an unavailable image cache does not prevent a live image from loading',async()=>{
 const h=harness();h.caches.open=async()=>{throw Error('cache unavailable');};h.setNetwork(async()=>new Response('live image'));
 const res=await h.request('images/1.png');assert.equal(res.status,200);assert.equal(await res.text(),'live image');
});
test('a stalled JSON body falls back to the saved catalogue within the network deadline',async()=>{
 const h=harness({timeout:30});await h.request();
 h.setNetwork(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('['));}})));
 const result=await Promise.race([h.request().then(async r=>({source:r.headers.get('X-Tabaat-Source'),id:(await r.json())[0].id})),new Promise(resolve=>setTimeout(()=>resolve({source:'hung'}),150))]);
 assert.equal(result.source,'cache');assert.equal(result.id,1);
});
