// A single SQLite-backed Durable Object serializes persisted analytics updates.
const INSTANCE = 'tabaat-stats-v1';
const DAY_MS = 86400000;
const RETENTION_DAYS = 35;
const WINDOW_DAYS = 30;
const utcDate = time => new Date(time).toISOString().slice(0, 10);
const count = value => value === undefined ? 0 : Number.isSafeInteger(value) && value >= 0 ? value : (() => { throw new Error('Invalid legacy count'); })();

function eventData(value) {
    if (!value || !['pageview', 'search', 'chat'].includes(value.event)) throw new Error('Invalid analytics event');
    if (value.event === 'search' && typeof value.q !== 'string') throw new Error('Invalid search');
    return { event: value.event, newVisitor: value.newVisitor === true, q: value.event === 'search' ? value.q.trim().slice(0, 80) : '' };
}

export class StatsAggregator {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.sql = ctx.storage.sql;
        this.initialization = null;
        this.cleanedDay = null;
        ctx.storage.transactionSync(() => {
            this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
            this.sql.exec('CREATE TABLE IF NOT EXISTS daily (date TEXT PRIMARY KEY, views INTEGER NOT NULL, visitors INTEGER NOT NULL, chats INTEGER NOT NULL)');
            this.sql.exec('CREATE TABLE IF NOT EXISTS searches (date TEXT NOT NULL, query TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (date, query))');
        });
    }

    async initialize() {
        if (this.sql.exec("SELECT value FROM meta WHERE key = 'legacy-import-v1'").toArray().length) return;
        const now = Date.now();
        const dates = Array.from({ length: RETENTION_DAYS }, (_, i) => utcDate(now - i * DAY_MS));
        // All reads and validation precede one transaction. A failed import remains retryable.
        const records = this.env.CACHE ? await Promise.all(dates.map(async date => {
            const raw = await this.env.CACHE.get('st:d:' + date, { type: 'json' });
            if (raw === null) return null;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid legacy aggregate');
            if (raw.s !== undefined && (!raw.s || typeof raw.s !== 'object' || Array.isArray(raw.s))) throw new Error('Invalid legacy searches');
            const searches = Object.entries(raw.s || {}).map(([query, value]) => [query, count(value)]);
            return { date, views: count(raw.v), visitors: count(raw.u), chats: count(raw.c), searches };
        })) : [];
        this.ctx.storage.transactionSync(() => {
            for (const record of records) {
                if (!record) continue;
                this.sql.exec('INSERT INTO daily (date, views, visitors, chats) VALUES (?, ?, ?, ?)', record.date, record.views, record.visitors, record.chats);
                for (const [query, value] of record.searches) this.sql.exec('INSERT INTO searches (date, query, count) VALUES (?, ?, ?)', record.date, query, value);
            }
            this.sql.exec("INSERT INTO meta (key, value) VALUES ('legacy-import-v1', ?)", this.env.CACHE ? 'imported' : 'no-legacy-source');
        });
    }

    async ready() {
        if (!this.initialization) this.initialization = this.initialize().catch(error => { this.initialization = null; throw error; });
        await this.initialization;
    }

    cleanup(now) {
        const today = utcDate(now);
        if (this.cleanedDay === today) return;
        const oldest = utcDate(now - (RETENTION_DAYS - 1) * DAY_MS);
        this.ctx.storage.transactionSync(() => {
            this.sql.exec('DELETE FROM daily WHERE date < ?', oldest);
            this.sql.exec('DELETE FROM searches WHERE date < ?', oldest);
        });
        this.cleanedDay = today;
    }

    record(event, now) {
        const date = utcDate(now);
        this.ctx.storage.transactionSync(() => {
            this.sql.exec(`INSERT INTO daily (date, views, visitors, chats) VALUES (?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET views = views + excluded.views,
                visitors = visitors + excluded.visitors, chats = chats + excluded.chats`,
            date, event.event === 'pageview' ? 1 : 0, event.event === 'pageview' && event.newVisitor ? 1 : 0, event.event === 'chat' ? 1 : 0);
            if (event.event === 'search' && event.q) this.sql.exec(`INSERT INTO searches (date, query, count) VALUES (?, ?, 1)
                ON CONFLICT(date, query) DO UPDATE SET count = count + 1`, date, event.q);
        });
    }

    summary(now) {
        const endDate = utcDate(now);
        const startDate = utcDate(now - (WINDOW_DAYS - 1) * DAY_MS);
        const rows = this.sql.exec('SELECT * FROM daily WHERE date BETWEEN ? AND ? ORDER BY date', startDate, endDate).toArray();
        const byDate = new Map(rows.map(row => [row.date, row]));
        const chart = Array.from({ length: WINDOW_DAYS }, (_, i) => {
            const date = utcDate(now - (WINDOW_DAYS - 1 - i) * DAY_MS);
            return { date, views: byDate.get(date)?.views || 0 };
        });
        const today = byDate.get(endDate);
        return {
            totalViews: rows.reduce((sum, row) => sum + row.views, 0),
            totalVisitors: rows.reduce((sum, row) => sum + row.visitors, 0),
            totalChat: rows.reduce((sum, row) => sum + row.chats, 0),
            todayViews: today?.views || 0, todayVisitors: today?.visitors || 0,
            chart,
            topSearches: this.sql.exec('SELECT query AS label, SUM(count) AS count FROM searches WHERE date BETWEEN ? AND ? GROUP BY query ORDER BY count DESC, query ASC LIMIT 15', startDate, endDate).toArray(),
            period: { days: WINDOW_DAYS, timezone: 'UTC', startDate, endDate },
            generatedAt: new Date(now).toISOString(),
            legacyImport: this.sql.exec("SELECT value FROM meta WHERE key = 'legacy-import-v1'").one().value
        };
    }

    async fetch(request) {
        try {
            const path = new URL(request.url).pathname;
            if (path !== '/event' && path !== '/stats') return Response.json({ error: 'not_found' }, { status: 404 });
            if ((path === '/event' && request.method !== 'POST') || (path === '/stats' && request.method !== 'GET')) return new Response(null, { status: 405 });
            let event;
            if (path === '/event') {
                try { event = eventData(await request.json()); }
                catch { return Response.json({ ok: false, error: 'invalid_event' }, { status: 400 }); }
            }
            await this.ready();
            const now = Date.now();
            this.cleanup(now);
            if (event) { this.record(event, now); return Response.json({ ok: true }); }
            return Response.json(this.summary(now));
        } catch (error) {
            console.error('Analytics storage unavailable:', error);
            return Response.json({ ok: false, error: 'analytics_unavailable' }, { status: 503 });
        }
    }
}

function stub(env) {
    if (!env.ANALYTICS) throw new Error('Analytics binding unavailable');
    return env.ANALYTICS.get(env.ANALYTICS.idFromName(INSTANCE));
}
export async function recordAnalytics(env, event) {
    const response = await stub(env).fetch('https://analytics.internal/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    if (!response.ok) throw new Error('Analytics event not recorded');
}
export async function readAnalytics(env) {
    const response = await stub(env).fetch('https://analytics.internal/stats');
    if (!response.ok) throw new Error('Analytics unavailable');
    return response.json();
}
export function scheduleAnalytics(ctx, env, event) {
    const task = Promise.resolve().then(() => recordAnalytics(env, event)).catch(error => console.error('Analytics background event failed:', error.message));
    ctx.waitUntil(task);
}
