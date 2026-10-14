const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('robots.txt exists and contains proper directives', () => {
  const robotsPath = path.join(root, 'robots.txt');
  assert.ok(fs.existsSync(robotsPath), 'robots.txt should exist');
  const content = fs.readFileSync(robotsPath, 'utf8');

  assert.match(content, /User-agent:\s*\*/i);
  assert.match(content, /Allow:\s*\//i);
  assert.match(content, /Disallow:\s*\/admin/i);
  assert.match(content, /Sitemap:\s*https:\/\/arabic-app\.github\.io\/tabaat\/sitemap\.xml/i);
});

test('sitemap.xml exists and is well-formed with core pages', () => {
  const sitemapPath = path.join(root, 'sitemap.xml');
  assert.ok(fs.existsSync(sitemapPath), 'sitemap.xml should exist');
  const content = fs.readFileSync(sitemapPath, 'utf8');

  assert.ok(content.startsWith('<?xml'), 'sitemap should start with xml declaration');
  assert.match(content, /<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.match(content, /<loc>https:\/\/arabic-app\.github\.io\/tabaat\/<\/loc>/);
  assert.match(content, /<loc>https:\/\/arabic-app\.github\.io\/tabaat\/about\.html<\/loc>/);
  assert.match(content, /<loc>https:\/\/arabic-app\.github\.io\/tabaat\/infos\.html<\/loc>/);
  assert.match(content, /<loc>https:\/\/arabic-app\.github\.io\/tabaat\/feedback\.html<\/loc>/);
  assert.match(content, /<loc>https:\/\/arabic-app\.github\.io\/tabaat\/reviews\.html<\/loc>/);
});

test('index.html contains required Google SEO tags and structured data', () => {
  const indexPath = path.join(root, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  // Google site verification
  assert.match(html, /<meta\s+name=["']google-site-verification["']\s+content=["']googleed73c222ce779f74["']/i);

  // Robots meta
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*index[^"']*follow[^"']*["']/i);

  // Social & rich snippets
  assert.match(html, /<meta\s+property=["']og:image["']/i);
  assert.match(html, /<meta\s+name=["']twitter:card["']/i);

  // Structured data LD+JSON
  const ldJsonMatches = [...html.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)];
  assert.ok(ldJsonMatches.length > 0, 'should have at least one ld+json block');
  for (const m of ldJsonMatches) {
    const data = JSON.parse(m[1].trim());
    assert.ok(data['@context']);
  }
});

test('admin pages disallow indexing via robots meta tag', () => {
  for (const adminFile of ['admin.html', 'admin/index.html']) {
    const filePath = path.join(root, adminFile);
    const html = fs.readFileSync(filePath, 'utf8');
    assert.match(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*["']/i, `${adminFile} must have noindex robots tag`);
  }
});

test('public subpages have canonical links and descriptions', () => {
  const subpages = ['about.html', 'infos.html', 'feedback.html', 'reviews.html'];
  for (const page of subpages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(html, /<meta\s+name=["']description["']/i, `${page} must have a meta description`);
    assert.match(html, /<link\s+rel=["']canonical["']/i, `${page} must have a canonical link`);
  }
});
