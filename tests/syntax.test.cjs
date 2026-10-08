const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('all application scripts remain syntactically valid',()=>{
  const pages=fs.readdirSync(root).filter(name=>name.endsWith('.html')).concat('admin/index.html');
  for(const file of pages) {
    const html=fs.readFileSync(path.join(root,file),'utf8');
    for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/application\/ld\+json/.test(m[1]) || !m[2].trim()) continue;
      new vm.Script(m[2],{filename:file});
    }
  }
  for(const file of ['js/content-security.js','vendor/purify.min.js','sw.js']) new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
  for (const file of ['telegram-bot/src/index.js', 'telegram-bot/src/analytics.js']) execFileSync(process.execPath, ['--check', path.join(root, file)], {stdio:'pipe'});
});
