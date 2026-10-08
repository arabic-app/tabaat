const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../admin/index.html'),'utf8');
const settle=()=>new Promise(r=>setTimeout(r,25));
function app({reject=false,ok=true}={}) {
 const dom=new JSDOM('<div class="dynamic-row"><input type="text" class="attach-title" value="Title"><input type="text" class="attach-url" value="previous.pdf"><input type="file"><button class="btn-upload-img"></button></div>',{url:'https://example.test',runScripts:'outside-only'});
 const w=dom.window; const calls=[], notices=[]; let urls=0,revoked=0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.URL.createObjectURL=()=>{urls++;return 'blob:preview';}; w.URL.revokeObjectURL=()=>revoked++;
 w.TabaatMediaUpload={prepareFile:async(file,options)=>{if(reject)throw Error('invalid image'); return {blob:new w.Blob(['compressed-bytes'],{type:'image/webp'}),extension:'webp',width:100,height:150,originalWidth:1000,originalHeight:1500,originalBytes:99999,optimized:true};}};
 w.getConfigToken=()=> 'test-token'; w.getConfigName=()=> 'Editor'; w.openConfigModal=()=>{};
 w.showToast=message=>notices.push(message); w.showLoader=()=>{};w.hideLoader=()=>{};
 w.fetch=async(url,options)=>{calls.push({url,options});return {ok,json:async()=>({message:'denied'})};};
 const start=html.indexOf('    // FILE UPLOAD'); const end=html.indexOf('    // BOOK FORM',start);
 w.eval("const CONFIG={GH_OWNER:'owner',GH_REPO:'repo'}; const $=s=>document.querySelector(s);"+html.slice(start,end));
 const input=w.document.querySelector('[type=file]');Object.defineProperty(input,'files',{value:[new w.File(['original-bytes'],'cover.png',{type:'image/png'})]});
 return {w,dom,input,calls,notices, resources:()=>({urls,revoked})};
}
// Catch network writes before preview confirmation, wrong bytes/extension, and changes lost on failure.
test('upload waits for approval, sends the screen variant and updates only the URL field',async()=>{
 const a=app();try {
 const pending=a.w.uploadFileToGitHub(a.input);await settle();assert.equal(a.calls.length,0);
 const dialog=a.w.document.querySelector('dialog');assert.ok(dialog);assert.ok(dialog.textContent.includes('100 × 150'));
 dialog.querySelector('[data-upload-confirm]').click();await pending;
 assert.equal(a.calls.length,1);assert.match(a.calls[0].url,/images\/.*\.webp$/);
 assert.equal(JSON.parse(a.calls[0].options.body).content,Buffer.from('compressed-bytes').toString('base64'));
 assert.match(a.w.document.querySelector('.attach-url').value,/\.webp$/);
 assert.equal(a.w.document.querySelector('.attach-title').value,'Title');assert.deepEqual(a.resources(),{urls:1,revoked:1});
 }finally{a.w.close();}
});
test('cancel releases preview resources without any GitHub write',async()=>{
 const a=app();try{const pending=a.w.uploadFileToGitHub(a.input);await settle();a.w.document.querySelector('[data-upload-cancel]').click();await pending;
 assert.equal(a.calls.length,0);assert.equal(a.w.document.querySelector('.attach-url').value,'previous.pdf');assert.equal(a.resources().revoked,1);
 }finally{a.w.close();}
});
test('invalid file never reaches GitHub or changes the existing URL',async()=>{
 const a=app({reject:true});try{await a.w.uploadFileToGitHub(a.input);await settle();assert.equal(a.calls.length,0);assert.equal(a.w.document.querySelector('.attach-url').value,'previous.pdf');assert.ok(a.notices.some(x=>x.includes('invalid image')));}finally{a.w.close();}
});
test('failed upload retains URL and frees the input for retry',async()=>{
 const a=app({ok:false});try{const pending=a.w.uploadFileToGitHub(a.input);await settle();a.w.document.querySelector('[data-upload-confirm]').click();await pending;
 assert.equal(a.w.document.querySelector('.attach-url').value,'previous.pdf');assert.equal(a.input.disabled,false);assert.ok(a.notices.some(x=>x.includes('denied')));
 }finally{a.w.close();}
});
test('two upload events on the same field produce only one preview and one write',async()=>{
 const a=app();try{const first=a.w.uploadFileToGitHub(a.input);const second=a.w.uploadFileToGitHub(a.input);await settle();assert.equal(a.w.document.querySelectorAll('dialog').length,1);a.w.document.querySelector('[data-upload-confirm]').click();await Promise.all([first,second]);assert.equal(a.calls.length,1);}finally{a.w.close();}
});
test('removing the target during preview prevents an orphan upload',async()=>{
 const a=app();try{const pending=a.w.uploadFileToGitHub(a.input);await settle();a.input.closest('.dynamic-row').remove();a.w.document.querySelector('[data-upload-confirm]').click();await pending;assert.equal(a.calls.length,0);}finally{a.w.close();}
});
test('target removed during file reading never starts an upload',async()=>{
 const a=app();try{
 let reader;
 a.w.FileReader=class{readAsDataURL(){reader=this;}};
 const pending=a.w.uploadFileToGitHub(a.input);await settle();a.w.document.querySelector('[data-upload-confirm]').click();await settle();
 a.input.closest('.dynamic-row').remove();reader.result='data:image/webp;base64,Ynl0ZXM=';reader.onload();await pending;assert.equal(a.calls.length,0);
 }finally{a.w.close();}
});
test('large files from different fields are processed one at a time',async()=>{
 const a=app();try{
 const other=a.input.closest('.dynamic-row').cloneNode(true);a.w.document.body.appendChild(other);
 const input=other.querySelector('[type=file]');Object.defineProperty(input,'files',{value:[a.input.files[0]]});
 const first=a.w.uploadFileToGitHub(a.input);const second=a.w.uploadFileToGitHub(input);await settle();assert.equal(a.w.document.querySelectorAll('dialog').length,1);
 a.w.document.querySelector('[data-upload-cancel]').click();await Promise.all([first,second]);assert.equal(a.calls.length,0);
 }finally{a.w.close();}
});
