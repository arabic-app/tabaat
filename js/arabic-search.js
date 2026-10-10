/* Shared by the static pages and the Worker (side-effect import). */
(function (global) {
    'use strict';
    function normalize(value) {
        return String(value ?? '').normalize('NFC').toLowerCase()
            .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
            .replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي')
            .replace(/ؤ/g, 'و').replace(/ء/g, '').replace(/ة/g, 'ه')
            .replace(/(?<![\p{L}\p{N}])ابن(?![\p{L}\p{N}])/gu, 'بن')
            .replace(/\s+/g, ' ').trim();
    }
    // Catalogue objects are replaced on edits. WeakMap releases removed versions.
    const index = new WeakMap();
    function fields(book) {
        if (index.has(book)) return index.get(book);
        const editions = [...(book.best_editions || []), ...(book.alt_editions || [])];
        const publishers = editions.map(ed => normalize(ed.publisher));
        const verifiers = editions.map(ed => normalize(ed.verifier));
        const result = Object.freeze({
            title: normalize(book.title), author: normalize(book.author),
            category: normalize(Array.isArray(book.category) ? book.category.join(' ') : book.category),
            publishers: Object.freeze(publishers), verifiers: Object.freeze(verifiers),
            editions: publishers.concat(verifiers).join(' ')
        });
        index.set(book, result);
        return result;
    }
    function prepare(books) { books.forEach(fields); }
    function debounce(fn, delay = 180) {
        let timer;
        const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
        run.cancel = () => clearTimeout(timer);
        return run;
    }
    global.TabaatSearch = Object.freeze({ normalize, fields, prepare, debounce });
})(globalThis);
