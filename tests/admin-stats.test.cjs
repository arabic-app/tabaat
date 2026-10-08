const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
function app() {
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const source = html.slice(html.indexOf('    function renderStats(data)'), html.indexOf('    function initSortable()'));
    dom.window.eval('const $ = sel => document.querySelector(sel);' + source);
    return dom;
}
test('admin displays daily visitor sum instead of chart views', () => {
    const dom = app();
    try {
        dom.window.renderStats({ totalViews: 100, totalVisitors: 17, todayViews: 5, totalChat: 3, chart: [{date: '2026-10-08', views: 80}], topSearches: [] });
        const doc = dom.window.document;
        assert.equal(doc.querySelector('#statTotalViews').textContent, (100).toLocaleString('ar'));
        assert.equal(doc.querySelector('#statUniqueVisitors').textContent, (17).toLocaleString('ar'));
        assert.equal(doc.querySelector('#statChatTotal').textContent, (3).toLocaleString('ar'));
        for (const id of ['statTotalViews', 'statUniqueVisitors', 'statChatTotal']) {
            assert.match(doc.getElementById(id).parentElement.querySelector('.stat-label').textContent, /30/);
        }
        assert.match(doc.querySelector('#statsNotice').textContent, /UTC/);
        assert.match(doc.querySelector('#statsNotice').textContent, /60/);
        assert.doesNotMatch(doc.querySelector('#statsNotice').textContent, /فوري/);
    } finally { dom.window.close(); }
});

test('chart dates stay UTC for browsers west of UTC', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    const dom = app();
    try {
        dom.window.renderStats({ chart: [{date: '2026-10-08', views: 1}] });
        const expected = new Intl.DateTimeFormat('ar', {day:'numeric', month:'short', timeZone:'UTC'}).format(new Date('2026-10-08'));
        assert.equal(dom.window.document.querySelector('.chart-bar-tooltip').textContent, expected + ': 1');
    } finally {
        dom.window.close();
        if (previousTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = previousTimezone;
    }
});
