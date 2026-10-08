const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const script=path.resolve(__dirname,'../scripts/media-inventory.cjs');
const inventory=fs.existsSync(script)?require(script):{};
// Catch deleting evidence, wrong URL decoding, and unsafe treatment of foreign media references.
test('inventory reports candidates without deleting or changing media',()=>{
 assert.equal(typeof inventory.buildInventory,'function');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tabaat-inventory-'));
 try {
 fs.mkdirSync(path.join(root,'images'));fs.mkdirSync(path.join(root,'corrections'));
 for(const name of ['used.jpg','unused.jpg','arabic name.png','foreign.jpg'])fs.writeFileSync(path.join(root,'images',name),'media');
 fs.writeFileSync(path.join(root,'corrections','detail.pdf'),'pdf');
 fs.writeFileSync(path.join(root,'books.json'),JSON.stringify([{images:['https://arabic-app.github.io/tabaat/images/used.jpg?v=1','images/arabic%20name.png'],body:'<a href="corrections/detail.pdf">scan</a>',foreign:'https://other.test/images/foreign.jpg'}]));
 const result=inventory.buildInventory(root);
 assert.equal(result.files.length,5);
 assert.deepEqual(result.unreferenced.map(x=>x.path),['images/foreign.jpg','images/unused.jpg']);
 assert.equal(fs.readFileSync(path.join(root,'images','unused.jpg'),'utf8'),'media');
 assert.equal(result.totalBytes,23);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('references in HTML and backup catalogue protect media, report itself does not',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tabaat-inventory-'));
 try {
 fs.mkdirSync(path.join(root,'images'));fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.mkdirSync(path.join(root,'docs','audit'));
 for(const name of ['logo.png','backup.png','orphan.png'])fs.writeFileSync(path.join(root,'images',name),'img');
 fs.writeFileSync(path.join(root,'index.html'),'<img src="./images/logo.png">');
 fs.writeFileSync(path.join(root,'books.json.bak'),'{"url":"images/backup.png"}');
 fs.writeFileSync(path.join(root,'docs','audit','media-inventory.json'),'images/orphan.png');
 assert.deepEqual(inventory.buildInventory(root).unreferenced.map(x=>x.path),['images/orphan.png']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('CSS and Markdown references with punctuation protect local media',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tabaat-inventory-'));
 try {
 fs.mkdirSync(path.join(root,'images'));for(const n of ['css.png','markdown.png','quoted.png'])fs.writeFileSync(path.join(root,'images',n),'img');
 fs.writeFileSync(path.join(root,'app.css'),'.cover { background: url(images/css.png); }');
 fs.writeFileSync(path.join(root,'README.md'),'![cover](images/markdown.png)\n![other]("images/quoted.png")');
 assert.deepEqual(inventory.buildInventory(root).unreferenced,[]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
