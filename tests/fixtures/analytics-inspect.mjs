// Test-only RPC wrapper lets Miniflare inspect the real aggregator's SQLite storage.
import { DurableObject } from 'cloudflare:workers';
import worker from '../../telegram-bot/src/index.js';
import { StatsAggregator as Aggregator } from '../../telegram-bot/src/analytics.js';
export class StatsAggregator extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.aggregator = new Aggregator(ctx, env);
    }
    fetch(request) { return this.aggregator.fetch(request); }
}
export default worker;
