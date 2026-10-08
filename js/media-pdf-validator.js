/* Isolated, time-bounded PDF structure check. Loaded only for PDF uploads. */
'use strict';
importScripts('../vendor/pdf-lib.min.js');
self.onmessage = async event => {
    try {
        const bytes = event.data;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > 25 * 1024 * 1024) throw new Error('Invalid input');
        const document = await PDFLib.PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
        const count = document.getPageCount();
        if (!Number.isInteger(count) || count < 1 || count > 20000) throw new Error('Invalid pages');
        self.postMessage({ ok: true });
    } catch {
        self.postMessage({ ok: false });
    }
};
