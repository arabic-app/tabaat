/* Local editing data only. GitHub credentials and authentication are never stored here. */
(function () {
    'use strict';
    const journalKey = 'tabaat-admin-drafts-v1';
    let database;
    let writes = Promise.resolve();
    let lastTimestamp = 0;
    let readable = false;
    let ownsLock = false;
    async function acquire() {
        if (!navigator.locks) return 'unsupported';
        return new Promise(resolve => {
            navigator.locks.request('tabaat-admin-editing', { ifAvailable: true }, lock => {
                ownsLock = !!lock;
                resolve(lock ? 'acquired' : 'busy');
                // The browser releases this lock when the document is destroyed.
                return lock ? new Promise(() => {}) : undefined;
            }).catch(() => resolve('unsupported'));
        });
    }
    function open() {
        if (!database) database = new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
            const request = indexedDB.open('tabaat-admin-drafts', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('state');
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); database = null; };
                resolve(db);
            };
            request.onerror = () => { database = null; reject(request.error); };
            request.onblocked = () => { database = null; reject(new Error('Storage blocked')); };
        }).catch(error => { database = null; throw error; });
        return database;
    }
    async function read() {
        let journal = null;
        try { journal = JSON.parse(localStorage.getItem(journalKey)); } catch { /* unavailable or malformed */ }
        try {
            const db = await open();
            const saved = await new Promise((resolve, reject) => {
                const tx = db.transaction('state', 'readonly');
                const request = tx.objectStore('state').get('editing');
                tx.oncomplete = () => resolve(request.result);
                tx.onabort = () => reject(tx.error);
            });
            const latest = journal && (!saved || journal.updatedAt > saved.updatedAt) ? journal : saved;
            lastTimestamp = latest?.updatedAt || 0;
            readable = true;
            return { snapshot: latest, error: null };
        } catch (error) { lastTimestamp = journal?.updatedAt || 0; return { snapshot: journal, error }; }
    }
    function save(snapshot) {
        if (!ownsLock) return Promise.reject(new Error('Editing lock unavailable'));
        if (!readable) return Promise.reject(new Error('Local storage has not been read'));
        const copy = JSON.parse(JSON.stringify(snapshot));
        copy.updatedAt = lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
        // Synchronous recovery journal closes the gap before an IDB transaction commits.
        // If it fails, IDB can still succeed; the UI waits for the actual transaction.
        try { localStorage.setItem(journalKey, JSON.stringify(copy)); } catch { /* IDB remains primary */ }
        const result = writes.catch(() => {}).then(async () => {
            const db = await open();
            await new Promise((resolve, reject) => {
                const tx = db.transaction('state', 'readwrite');
                tx.objectStore('state').put(copy, 'editing');
                tx.oncomplete = resolve;
                tx.onabort = () => reject(tx.error || new Error('Storage aborted'));
                tx.onerror = () => {}; // onabort reports the final transaction failure
            });
        });
        writes = result;
        return result;
    }
    window.TabaatDraftStore = Object.freeze({ acquire, read, save });
})();
