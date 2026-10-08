const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {Worker}=require('node:worker_threads');
const {PDFDocument}=require('pdf-lib');
const root=path.resolve(__dirname,'..');
const code=fs.readFileSync(path.join(root,'js/media-upload.js'),'utf8');
function browser(WorkerClass,timers={setTimeout,clearTimeout}) {
 const context=vm.createContext({document:{currentScript:{src:'https://example.test/tabaat/js/media-upload.js'}},URL,Worker:WorkerClass,...timers});
 vm.runInContext(code,context);return context.TabaatMediaUpload;
}
// Use the actual vendored library and production worker, not a substitute parser.
const bootstrap=`const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const scope={Uint8Array,ArrayBuffer,DataView,setTimeout,clearTimeout,console};scope.self=scope;scope.postMessage=data=>parentPort.postMessage(data);
const context=vm.createContext(scope);scope.importScripts=file=>vm.runInContext(fs.readFileSync(path.resolve(workerData.root,'js',file),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(workerData.root,'js/media-pdf-validator.js'),'utf8'),context);
parentPort.on('message',data=>scope.onmessage({data}));`;
test('browser PDF pipeline uses the real isolated parser and terminates workers on success and failure',async()=>{
 let terminated=0;
 class BrowserWorker{
  constructor(url){assert.equal(url,'https://example.test/tabaat/js/media-pdf-validator.js');this.worker=new Worker(bootstrap,{eval:true,workerData:{root}});this.worker.on('message',data=>this.onmessage({data}));this.worker.on('error',()=>this.onerror());}
  postMessage(data,transfer){this.worker.postMessage(data,transfer);}
  terminate(){terminated++;return this.worker.terminate();}
 }
 const media=browser(BrowserWorker);const doc=await PDFDocument.create();doc.addPage();
 const pdf=new File([await doc.save()],'real.pdf',{type:'application/pdf'});
 assert.equal((await media.prepareFile(pdf,{preserveOriginal:true})).blob,pdf);
 const malformed=new File(['%PDF-1.7\nNot a document\n%%EOF'],'fake.pdf',{type:'application/pdf'});
 await assert.rejects(media.prepareFile(malformed,{preserveOriginal:true}));assert.equal(terminated,2);
});
test('a stalled PDF parser expires and is terminated without permitting upload',async()=>{
 let terminated=0;
 class StalledWorker{postMessage(){}terminate(){terminated++;}}
 const media=browser(StalledWorker,{setTimeout:(fn,delay)=>{assert.equal(delay,15000);return setTimeout(fn,5);},clearTimeout});
 await assert.rejects(media.prepareFile(new File(['%PDF-1.7\nbody\n%%EOF'],'stall.pdf'),{preserveOriginal:true}));assert.equal(terminated,1);
});
test('PDF worker load failure rejects the file and releases the worker',async()=>{
 let terminated=0;
 class BrokenWorker{postMessage(){queueMicrotask(()=>this.onerror());}terminate(){terminated++;}}
 await assert.rejects(browser(BrokenWorker).prepareFile(new File(['%PDF-1.7\nbody\n%%EOF'],'broken.pdf'),{preserveOriginal:true}));assert.equal(terminated,1);
});
