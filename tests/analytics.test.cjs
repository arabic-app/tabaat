const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {pathToFileURL}=require('node:url');const {Miniflare}=require('miniflare');
const root=path.resolve(__dirname,'..');const workerPath=path.join(root,'telegram-bot/src/index.js');
const day=(offset=0)=>new Date(Date.now()-offset*86400000).toISOString().slice(0,10);
async function runtime(options={}) {
 const durable=fs.existsSync(path.join(root,'telegram-bot/src/analytics.js'));
 const config={name:"analytics-test",unsafeInspectDurableObjects:true,modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:workerPath,compatibilityDate:'2025-07-01',kvNamespaces:['CACHE'],bindings:{STATS_KEY:'test-key'},...options};
 if(durable)config.durableObjects={ANALYTICS:{className:'StatsAggregator',useSQLite:true}};
 return new Miniflare(config);
}
async function track(mf,body){return mf.dispatchFetch('https://test.local/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function stats(mf){return mf.dispatchFetch('https://test.local/stats?key=test-key');}
async function clearStatsCache(mf){const cache=await(await mf.getCaches()).default;await cache.delete('https://stats-cache.internal/stats');await cache.delete('https://stats-cache.internal/stats-v2');}

test('simultaneous pageviews keep every increment and daily visitor flag',async()=>{
 const mf=await runtime();try{
 const responses=await Promise.all(Array.from({length:50},(_,i)=>track(mf,{event:'pageview',newVisitor:i<7})));
 assert.ok(responses.every(r=>r.status===200));const data=await(await stats(mf)).json();assert.equal(data.totalViews,50);assert.equal(data.totalVisitors,7);assert.equal(data.todayViews,50);
 }finally{await mf.dispose();}
});
test('cached chat answer survives a failing analytics write',async()=>{
 const worker=(await import(pathToFileURL(workerPath))).default;const background=[];
 const env={CACHE:{get:async key=>key.startsWith('resp:')?'📚 Cached answer':null,put:async()=>{throw Error('analytics unavailable');}},ANALYTICS:{idFromName:()=>({}),get:()=>({fetch:async()=>{throw Error('analytics unavailable');}})}};
 const response=await worker.fetch(new Request('https://test.local/chat',{method:'POST',body:JSON.stringify({message:'كتاب'})}),env,{waitUntil:task=>background.push(task)});
 assert.equal(response.status,200);assert.equal((await response.json()).answer,'📚 Cached answer');await Promise.all(background);
});
test('chat response does not wait for an unresponsive analytics service',async()=>{
 const worker=(await import(pathToFileURL(workerPath))).default;
 const env={CACHE:{get:async key=>key.startsWith('resp:')?'📚 Cached answer':null,put:()=>new Promise(()=>{})},ANALYTICS:{idFromName:()=>({}),get:()=>({fetch:()=>new Promise(()=>{})})}};
 const result=await Promise.race([worker.fetch(new Request('https://test.local/chat',{method:'POST',body:JSON.stringify({message:'كتاب'})}),env,{waitUntil(){}}),new Promise(r=>setTimeout(()=>r({status:0}),100))]);
 assert.equal(result.status,200);
});
test('legacy daily aggregates are imported once and new events add to them',async()=>{
 const mf=await runtime();try {const kv=await mf.getKVNamespace('CACHE');await kv.put('st:d:'+day(),JSON.stringify({v:10,u:3,c:2,s:{old:4}}));
 await track(mf,{event:'pageview',newVisitor:true});let data=await(await stats(mf)).json();assert.equal(data.totalViews,11);assert.equal(data.totalVisitors,4);
 await kv.put('st:d:'+day(),JSON.stringify({v:999,u:999,c:999,s:{old:999}}));await track(mf,{event:'pageview'});await clearStatsCache(mf);
 data=await(await stats(mf)).json();assert.equal(data.totalViews,12);assert.equal(data.totalChat,2);assert.equal(data.topSearches.find(s=>s.label==='old').count,4);
 }finally{await mf.dispose();}
});
test('daily visitors are summed over exactly thirty UTC days',async()=>{
 const mf=await runtime();try{const kv=await mf.getKVNamespace('CACHE');await kv.put('st:d:'+day(29),JSON.stringify({v:6,u:2,c:3,s:{}}));await kv.put('st:d:'+day(30),JSON.stringify({v:99,u:99,c:99,s:{}}));
 const data=await(await stats(mf)).json();assert.equal(data.totalViews,6);assert.equal(data.totalVisitors,2);assert.equal(data.chart.length,30);assert.deepEqual(data.period,{days:30,timezone:'UTC',startDate:day(29),endDate:day()});
 }finally{await mf.dispose();}
});
test('concurrent searches preserve counts including special property names',async()=>{
 const mf=await runtime();try {await Promise.all(Array.from({length:25},()=>track(mf,{event:'search',q:'__proto__'})));
 const data=await(await stats(mf)).json();assert.equal(data.topSearches.find(s=>s.label==='__proto__')?.count,25);
 }finally{await mf.dispose();}
});
test('without analytics binding tracking reports unavailable instead of falsely accepting',async()=>{
 const worker=(await import(pathToFileURL(workerPath))).default;
 const res=await worker.fetch(new Request('https://test.local/track',{method:'POST',body:JSON.stringify({event:'pageview'})}),{}, {waitUntil(){}});
 assert.equal(res.status,503);assert.equal((await res.json()).ok,false);
});

test('analytics migration survives an object restart without importing KV twice',async()=>{
 const mf=await runtime();try {const kv=await mf.getKVNamespace('CACHE');await kv.put('st:d:'+day(),JSON.stringify({v:8,u:2,c:1,s:{}}));await track(mf,{event:'pageview'});
 await kv.put('st:d:'+day(),JSON.stringify({v:999,u:999,c:999,s:{}}));
 await mf.unsafeEvictDurableObject('analytics-test','StatsAggregator',{name:'tabaat-stats-v1'});
 await track(mf,{event:'pageview'});await clearStatsCache(mf);const data=await(await stats(mf)).json();assert.equal(data.totalViews,10);assert.equal(data.totalVisitors,2);
 }finally{await mf.dispose();}
});
test('a failed legacy import accepts no events and can be retried without data loss',async()=>{
 const mf=await runtime();try {const kv=await mf.getKVNamespace('CACHE');await kv.put('st:d:'+day(),JSON.stringify({v:'corrupt',u:2,c:1,s:{}}));
 const rejected=await track(mf,{event:'pageview'});assert.equal(rejected.status,503);
 await kv.put('st:d:'+day(),JSON.stringify({v:8,u:2,c:1,s:{}}));assert.equal((await track(mf,{event:'pageview'})).status,200);
 const data=await(await stats(mf)).json();assert.equal(data.totalViews,9);assert.equal(data.totalVisitors,2);
 }finally{await mf.dispose();}
});
test('retention removes expired daily rows and expired search counters',async()=>{
 const mf=await runtime({scriptPath:path.join(__dirname,'fixtures/analytics-inspect.mjs')});try {await track(mf,{event:'pageview'});
 const storage=await mf.unsafeGetDurableObjectStorage('analytics-test','StatsAggregator',{name:'tabaat-stats-v1'});
 await storage.exec("INSERT INTO daily VALUES (?, 34, 2, 3)",day(34));
 await storage.exec("INSERT INTO searches VALUES (?, 'retained', 4)",day(34));
 await storage.exec("INSERT INTO daily VALUES (?, 100, 100, 100)",day(35));await storage.exec("INSERT INTO searches VALUES (?, 'expired', 100)",day(35));
 // A restart rechecks retention even if housekeeping already ran today.
 await mf.unsafeEvictDurableObject('analytics-test','StatsAggregator',{name:'tabaat-stats-v1'});await clearStatsCache(mf);await stats(mf);
 assert.deepEqual(await storage.exec('SELECT views, visitors, chats FROM daily WHERE date = ?',day(34)),[{views:34,visitors:2,chats:3}]);
 assert.deepEqual(await storage.exec('SELECT query, count FROM searches WHERE date = ?',day(34)),[{query:'retained',count:4}]);
 assert.equal((await storage.exec('SELECT * FROM daily WHERE date = ?',day(35))).length,0);assert.equal((await storage.exec('SELECT * FROM searches WHERE date = ?',day(35))).length,0);
 }finally{await mf.dispose();}
});
test('an edge cache write failure does not block reading SQLite statistics',async t=>{
 t.mock.method(console,'warn',()=>{});t.mock.method(console,'error',()=>{});
 const worker=(await import(pathToFileURL(workerPath))).default;const old=global.caches;const background=[];
 global.caches={default:{match:async()=>undefined,put(){throw Error('cache unavailable');}}};
 try {const env={ANALYTICS:{idFromName:()=>({}),get:()=>({fetch:async()=>Response.json({totalViews:7,totalVisitors:2})})}};
 const response=await worker.fetch(new Request('https://test.local/stats'),env,{waitUntil:p=>background.push(p)});assert.equal(response.status,200);assert.equal((await response.json()).totalViews,7);await Promise.all(background);
 }finally{global.caches=old;}
});

test('a KV read outage blocks import and collection, then retries without loss',async()=>{
 const mf=await runtime({scriptPath:path.join(__dirname,'fixtures/analytics-read-failure.mjs')});
 try {
  const kv=await mf.getKVNamespace('CACHE');
  await kv.put('st:d:'+day(),JSON.stringify({v:8,u:2,c:1,s:{old:4}}));
  await kv.put('test:fail-import','1');
  assert.equal((await track(mf,{event:'pageview',newVisitor:true})).status,503);
  assert.equal((await stats(mf)).status,503);
  await kv.delete('test:fail-import');
  assert.equal((await track(mf,{event:'pageview',newVisitor:true})).status,200);
  const data=await(await stats(mf)).json();
  assert.equal(data.totalViews,9);assert.equal(data.totalVisitors,3);
  assert.equal(data.totalChat,1);assert.equal(data.topSearches.find(s=>s.label==='old').count,4);
  assert.equal(data.legacyImport,'imported');
 } finally {await mf.dispose();}
});
test('an edge cache read outage still returns durable statistics',async t=>{
 t.mock.method(console,'warn',()=>{});
 const worker=(await import(pathToFileURL(workerPath))).default;
 const old=global.caches;const background=[];
 global.caches={default:{match:async()=>{throw new Error('cache read unavailable');},put:async()=>{}}};
 try {
  const env={ANALYTICS:{idFromName:()=>({}),get:()=>({fetch:async()=>Response.json({totalViews:7,totalVisitors:2})})}};
  const response=await worker.fetch(new Request('https://test.local/stats'),env,{waitUntil:p=>background.push(p)});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{totalViews:7,totalVisitors:2});
  await Promise.all(background);
 } finally {global.caches=old;}
});
