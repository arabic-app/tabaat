// Inject a KV read outage at the storage boundary; the aggregator remains real.
import worker from '../../telegram-bot/src/index.js';
import { StatsAggregator as Aggregator } from '../../telegram-bot/src/analytics.js';
export class StatsAggregator extends Aggregator {
    constructor(ctx, env) {
        super(ctx, {...env, CACHE: {get: async (...args) => {
            if (await env.CACHE.get('test:fail-import') === '1') throw new Error('KV read unavailable');
            return env.CACHE.get(...args);
        }}});
    }
}
export default worker;
