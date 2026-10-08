/* Browser-side upload checks and screen variants. Originals of attachments stay intact. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TabaatMediaUpload = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const script = typeof document !== 'undefined' ? document.currentScript : null;
    const pdfWorkerUrl = script ? new URL('media-pdf-validator.js', script.src).href : null;
    const MiB = 1024 * 1024;
    const limits = Object.freeze({ imageBytes: 15 * MiB, pdfBytes: 25 * MiB, coverBytes: 2 * MiB, pixels: 40 * 1000 * 1000, width: 1600, height: 2200 });
    const fail = message => { throw new Error(message); };
    const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

    function identify(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.length >= 24 && bytes.slice(0, 8).every((b, i) => b === [137,80,78,71,13,10,26,10][i]) && ascii(bytes,12,4) === 'IHDR') {
            return { extension: 'png', type: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
        }
        if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
            let offset = 2;
            while (offset + 4 <= bytes.length) {
                if (bytes[offset++] !== 255) break;
                while (bytes[offset] === 255) offset++;
                const marker = bytes[offset++];
                if (marker === 0xd9 || marker === 0xda) break;
                if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
                if (offset + 2 > bytes.length) break;
                const length = view.getUint16(offset);
                if (length < 2 || offset + length > bytes.length) break;
                if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
                    return { extension: 'jpg', type: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
                }
                offset += length;
            }
        }
        if (bytes.length >= 30 && ascii(bytes,0,4) === 'RIFF' && ascii(bytes,8,4) === 'WEBP') {
            const chunk = ascii(bytes,12,4);
            const u24 = at => bytes[at] + bytes[at+1] * 256 + bytes[at+2] * 65536;
            let width, height;
            if (chunk === 'VP8X') { width = 1 + u24(24); height = 1 + u24(27); }
            else if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = view.getUint16(26,true) & 0x3fff; height = view.getUint16(28,true) & 0x3fff; }
            else if (chunk === 'VP8L' && bytes[20] === 47) { width = 1 + (bytes[21] | ((bytes[22] & 63) << 8)); height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 15) << 10)); }
            if (width && height) return { extension: 'webp', type: 'image/webp', width, height };
        }
        if (/^%PDF-\d\.\d[\r\n]/.test(ascii(bytes,0,Math.min(12,bytes.length)))) return { extension: 'pdf', type: 'application/pdf' };
        fail('نوع الملف غير مدعوم أو بياناته تالفة. استخدم PNG أو JPEG أو WebP، أو PDF للمرفقات.');
    }

    function checkDimensions(width, height) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > limits.pixels || width > 16000 || height > 16000) {
            fail('أبعاد الصورة غير صالحة أو تتجاوز الحد الآمن (40 مليون بكسل).');
        }
    }

    const browserEngine = {
        async validatePDF(bytes) {
            if (!pdfWorkerUrl || typeof Worker === 'undefined') fail('تعذّر التحقق من PDF في هذا المتصفح.');
            const worker = new Worker(pdfWorkerUrl);
            let timeout;
            try {
                await new Promise((resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('انتهت مهلة التحقق من PDF.')), 15000);
                    worker.onmessage = event => event.data && event.data.ok === true ? resolve() : reject(new Error('ملف PDF تالف أو مشفّر أو بلا صفحات.'));
                    worker.onerror = () => reject(new Error('تعذّر التحقق من ملف PDF.'));
                    worker.postMessage(bytes, [bytes.buffer]);
                });
            } finally { clearTimeout(timeout); worker.terminate(); }
        },
        async decode(file) {
            // Image loading has a bounded lifetime and works without createImageBitmap.
            return new Promise((resolve, reject) => {
                const url = URL.createObjectURL(file);
                const img = new Image();
                const cleanup = () => { clearTimeout(timer); URL.revokeObjectURL(url); img.onload = img.onerror = null; };
                const timer = setTimeout(() => { cleanup(); img.src = ''; reject(new Error('انتهت مهلة قراءة الصورة.')); }, 15000);
                img.onload = () => { cleanup(); resolve({ width: img.naturalWidth, height: img.naturalHeight, image: img, close() { img.src = ''; } }); };
                img.onerror = () => { cleanup(); reject(new Error('تعذّر قراءة الصورة: الملف تالف أو غير مدعوم.')); };
                img.src = url;
            });
        },
        async encode(decoded, width, height, type, quality) {
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) fail('تعذّر تجهيز الصورة في هذا المتصفح.');
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            context.drawImage(decoded.image, 0, 0, width, height);
            try {
                return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('تعذّر ضغط الصورة.')), type, quality));
            } finally { canvas.width = canvas.height = 0; }
        }
    };

    async function prepareFile(file, { preserveOriginal = false } = {}, engine = browserEngine) {
        if (!file || !file.size) fail('الملف فارغ.');
        const extension = (file.name || '').split('.').pop().toLowerCase();
        if (!['png','jpg','jpeg','webp','pdf'].includes(extension)) fail('امتداد الملف غير مسموح.');
        const maximum = extension === 'pdf' && preserveOriginal ? limits.pdfBytes : limits.imageBytes;
        if (file.size > maximum) fail(`حجم الملف يتجاوز الحد المسموح (${maximum / MiB} MiB).`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const info = identify(bytes);
        if ((extension === 'jpeg' ? 'jpg' : extension) !== info.extension || (file.type && file.type.toLowerCase() !== info.type)) fail('امتداد الملف أو نوعه لا يطابق محتواه الحقيقي.');
        if (info.extension === 'pdf') {
            if (!preserveOriginal) fail('ملفات PDF مسموحة للمرفقات فقط.');
            if (!/%%EOF\s*$/.test(ascii(bytes,Math.max(0,bytes.length-1024),1024))) fail('ملف PDF غير مكتمل.');
            await engine.validatePDF(bytes);
            return { blob: file, extension: 'pdf', originalBytes: file.size, optimized: false };
        }
        checkDimensions(info.width, info.height); // Before allocating a decoded bitmap.
        const decoded = await engine.decode(file);
        try {
            checkDimensions(decoded.width, decoded.height);
            const result = { blob: file, extension: info.extension, width: decoded.width, height: decoded.height, originalWidth: decoded.width, originalHeight: decoded.height, originalBytes: file.size, optimized: false };
            if (preserveOriginal) return result;
            const scale = Math.min(1, limits.width / decoded.width, limits.height / decoded.height);
            const width = Math.max(1, Math.round(decoded.width * scale));
            const height = Math.max(1, Math.round(decoded.height * scale));
            let blob;
            for (const quality of [0.85, 0.78, 0.70]) {
                blob = await engine.encode(decoded, width, height, 'image/webp', quality);
                if (!['image/webp','image/png'].includes(blob.type) || !blob.size) fail('تعذّر إنشاء صورة صالحة.');
                if (blob.size <= limits.coverBytes) break;
            }
            // A browser without WebP may return PNG; never mislabel those bytes.
            if (scale === 1 && file.size <= limits.coverBytes && blob.size >= file.size) return result;
            if (blob.size > limits.coverBytes) fail('الصورة المضغوطة تتجاوز 2 MiB. اختر صورة أصغر أو أرفق الأصل كمرفق.');
            return { ...result, blob, extension: blob.type === 'image/webp' ? 'webp' : 'png', width, height, optimized: true };
        } finally { if (decoded.close) decoded.close(); }
    }
    return Object.freeze({ prepareFile, limits });
});
