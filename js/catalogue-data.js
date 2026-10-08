/* Shared structural validation for network/cache data; rendering still sanitizes rich HTML. */
(function (global) {
    'use strict';
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const text = value => value === undefined || typeof value === 'string';
    const list = (value, valid) => value === undefined || (Array.isArray(value) && value.every(valid));
    const attachment = value => object(value) && text(value.title) && text(value.url);
    const correction = value => object(value) && text(value.title) && text(value.body) && list(value.attachments, attachment);
    const edition = value => object(value) && text(value.publisher) && text(value.verifier) && text(value.notes)
        && text(value.image) && list(value.images, value => typeof value === 'string')
        && (value.volumes === undefined || typeof value.volumes === 'string' || (typeof value.volumes === 'number' && Number.isFinite(value.volumes)))
        && list(value.corrections, correction) && list(value.attachments, attachment);
    const book = value => object(value) && Number.isSafeInteger(value.id) && value.id > 0
        && typeof value.title === 'string' && text(value.author) && text(value.notes) && text(value.date)
        && (value.category === undefined || typeof value.category === 'string' || list(value.category, value => typeof value === 'string'))
        && list(value.best_editions, edition) && list(value.alt_editions, edition) && list(value.links, attachment);
    function valid(name, data) {
        if (name === 'books.json') {
            if (!Array.isArray(data) || !data.every(book)) return false;
            return new Set(data.map(value => value.id)).size === data.length;
        }
        if (name === 'sciences.json') return Array.isArray(data) && data.every(value => typeof value === 'string');
        if (name === 'reviews.json') {
            const reviews = Array.isArray(data) ? data : [data];
            return reviews.every(value => object(value) && typeof value.name === 'string' && typeof value.message === 'string');
        }
        return false;
    }
    global.TabaatData = Object.freeze({ valid });
})(typeof self !== 'undefined' ? self : window);
