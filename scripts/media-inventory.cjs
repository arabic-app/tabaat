#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const mediaDirs = ['images', 'corrections', 'books_attachments', 'editions_attachments'];
const base = new URL('https://arabic-app.github.io/tabaat/');
function walk(dir, skip = new Set()) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry => {
        if (skip.has(entry.name) || entry.isSymbolicLink()) return [];
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(file, skip) : [file];
    });
}
function buildInventory(root) {
    root = path.resolve(root);
    const references = new Map();
    const sources = walk(root, new Set(['.git','node_modules','.superpowers','.worktrees','tests',...mediaDirs]));
    const pattern = /https?:\/\/[^\s"'<>`\\]+|(?:\.{1,2}\/|\/)?(?:images|corrections|books_attachments|editions_attachments)\/[^\s"'<>`\\]+/g;
    const record = (text, source) => {
        for (const match of text.matchAll(pattern)) {
            let local;
            try {
                if (/^https?:/.test(match[0])) {
                    const url = new URL(match[0]);
                    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) continue;
                    local = decodeURIComponent(url.pathname.slice(base.pathname.length));
                } else {
                    local = decodeURIComponent(match[0].replace(/^(?:\.{1,2}\/|\/)/,'').split(/[?#]/)[0]);
                }
            } catch { continue; }
            // Retain the exact path as well as punctuation-free candidates.
            // This protects filenames containing parentheses and Markdown/CSS links.
            const candidates = new Set([path.posix.normalize(local)]);
            while (/[)\],;.}]$/.test(local)) { local = local.slice(0,-1); candidates.add(path.posix.normalize(local)); }
            for (local of candidates) {
            if (!mediaDirs.includes(local.split('/')[0])) continue;
            if (!references.has(local)) references.set(local, new Set());
            references.get(local).add(source);
            }
        }
    };
    const values = (value, source) => {
        if (typeof value === 'string') record(value, source);
        else if (value && typeof value === 'object') Object.values(value).forEach(item => values(item, source));
    };
    const scannedSources = [];
    for (const file of sources) {
        const source = path.relative(root,file).split(path.sep).join('/');
        if (source === 'docs/audit/media-inventory.json' || !/\.(?:json(?:\.bak)?|html|css|js|cjs|md)$/.test(source)) continue;
        const text = fs.readFileSync(file,'utf8');
        if (/\.json(?:\.bak)?$/.test(source)) values(JSON.parse(text),source);
        else record(text,source);
        scannedSources.push(source);
    }
    const files = mediaDirs.flatMap(dir => walk(path.join(root,dir)).map(file => {
        const local = path.relative(root,file).split(path.sep).join('/');
        return {path:local, bytes:fs.statSync(file).size, referencedBy:[...(references.get(local) || [])].sort()};
    })).sort((a,b)=>a.path.localeCompare(b.path));
    return {
        generatedAt:new Date().toISOString(),
        notice:'Candidates for manual review only. Local browser drafts, unpublished branches and external consumers are not included. No deletion is performed.',
        scannedSources, totalBytes:files.reduce((sum,file)=>sum+file.bytes,0), files,
        unreferenced:files.filter(file=>file.referencedBy.length===0),
        overOneMiB:files.filter(file=>file.bytes>1024*1024)
    };
}
if (require.main === module) {
    try { process.stdout.write(JSON.stringify(buildInventory(path.resolve(__dirname,'..')),null,2)+'\n'); }
    catch (error) { console.error('Media inventory failed:', error.message); process.exitCode=1; }
}
module.exports = {buildInventory};
