const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const modulePath = path.resolve(__dirname, '../js/media-upload.js');
const media = fs.existsSync(modulePath) ? require(modulePath) : {};
const image = async (width=100, height=150, format='png') => new File([await sharp({create:{width,height,channels:4,background:'#176957'}})[format]().toBuffer()], 'cover.'+format, {type:'image/'+format});
const engine = {
  async validatePDF(bytes) { const doc=await PDFDocument.load(bytes,{throwOnInvalidObject:true,updateMetadata:false}); if(doc.getPageCount()<1) throw Error('No pages'); },
  async decode(file) { const bytes=Buffer.from(await file.arrayBuffer()); const info=await sharp(bytes).metadata(); return {width:info.width,height:info.height,bytes,close(){}}; },
  async encode(decoded,width,height,type,quality) { return new Blob([await sharp(decoded.bytes).resize(width,height).toFormat(type.split('/')[1],{quality:Math.round(quality*100)}).toBuffer()],{type}); }
};
// These checks catch extension-only validation, unbounded decode and accidental loss of attachment detail.
test('renamed HTML, mismatched MIME, SVG, empty and oversize files are refused', async () => {
  assert.equal(typeof media.prepareFile, 'function');
  for (const file of [new File(['<script>alert(1)</script>'],'fake.png',{type:'image/png'}), new File([''],'empty.jpg'), new File(['<svg/>'],'drawing.svg'), new File([new Uint8Array(15*1024*1024+1)],'large.png')]) {
    await assert.rejects(media.prepareFile(file,{},engine));
  }
  const png=await image();
  await assert.rejects(media.prepareFile(new File([png],'fake.jpg',{type:'image/jpeg'}),{},engine));
  await assert.rejects(media.prepareFile(new File([png],'real.png',{type:'text/html'}),{},engine));
});
test('valid signature with corrupt image data fails decoding', async () => {
  const bytes=Buffer.alloc(32); Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(bytes); bytes.writeUInt32BE(100,16);bytes.writeUInt32BE(100,20);
  await assert.rejects(media.prepareFile(new File([bytes],'corrupt.png'),{},engine));
});
test('huge declared dimensions are rejected before decoding', async () => {
  const bytes=Buffer.from(await (await image()).arrayBuffer()); bytes.writeUInt32BE(100000,16);
  let decoded=false;
  await assert.rejects(media.prepareFile(new File([bytes],'huge.png'),{}, {decode(){decoded=true;throw Error('decoder should not run');}}));
  assert.equal(decoded,false);
});
test('cover is resized proportionally with actual encoded dimensions and matching extension', async () => {
  const source=await image(2000,3000);
  const result=await media.prepareFile(source,{},engine);
  const info=await sharp(Buffer.from(await result.blob.arrayBuffer())).metadata();
  assert.equal(info.width,1467); assert.equal(info.height,2200);
  assert.equal(result.extension,'webp'); assert.equal(result.blob.type,'image/webp');
  assert.ok(result.blob.size<source.size); assert.equal(result.optimized,true);
});
test('small images are never enlarged or replaced with a heavier encoding', async () => {
  const source=await image(20,30);
  const result=await media.prepareFile(source,{}, {...engine, encode:async()=>new Blob([new Uint8Array(100000)],{type:'image/webp'})});
  assert.equal(result.width,20); assert.equal(result.height,30); assert.equal(result.blob,source); assert.equal(result.optimized,false);
});
test('correction images retain their original bytes and resolution', async () => {
  const source=await image(2000,3000,'jpeg');
  const result=await media.prepareFile(source,{preserveOriginal:true},engine);
  assert.equal(result.blob,source); assert.equal(result.width,2000); assert.equal(result.height,3000); assert.equal(result.extension,'jpg');
});
test('PDFs are accepted only as attachments, kept intact and limited in size', async () => {
  const doc=await PDFDocument.create();doc.addPage([100,100]);
  const pdf=new File([await doc.save()],'scan.pdf',{type:'application/pdf'});
  await assert.rejects(media.prepareFile(pdf,{},engine));
  assert.equal((await media.prepareFile(pdf,{preserveOriginal:true},engine)).blob,pdf);
  await assert.rejects(media.prepareFile(new File(['<html>'],'fake.pdf'),{preserveOriginal:true},engine));
  await assert.rejects(media.prepareFile(new File(['%PDF-1.7\n',new Uint8Array(25*1024*1024)],'large.pdf'),{preserveOriginal:true},engine));
});
test('encoding failure and excessively heavy output do not silently upload a huge original', async () => {
  const source=await image(2000,3000);
  await assert.rejects(media.prepareFile(source,{}, {...engine,encode:async()=>{throw Error('encoder unavailable');}}));
  await assert.rejects(media.prepareFile(source,{}, {...engine,encode:async()=>new Blob([new Uint8Array(3*1024*1024)],{type:'image/webp'})}));
});
test('PDF with plausible markers but no document structure is refused', async()=>{
 await assert.rejects(media.prepareFile(new File(['%PDF-1.7\nThis is not a PDF document.\n%%EOF'],'fake.pdf',{type:'application/pdf'}),{preserveOriginal:true},engine));
});
