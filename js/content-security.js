/* Shared security boundary for catalogue content and administrative rich editors. */
(function (root) {
    'use strict';
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    // Shared assets resolve against the catalogue root, including from /admin/.
    const script = root.document.querySelector('script[src$="js/content-security.js"]');
    const catalogueBase = script ? new URL('../', script.src).href : root.document.baseURI;
    // Resolve local assets consistently while allowing ordinary HTTP links.
    // Reject executable schemes, credentials and characters used to break attributes.
    function safeUrl(value) {
        if (typeof value !== 'string') return '';
        const text = value.trim();
        if (!text || /[\u0000-\u001f\u007f<>"`]/.test(text)) return '';
        try {
            const url = new URL(text, catalogueBase);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
            return url.href;
        } catch { return ''; }
    }

    function isPdf(value) {
        const url = safeUrl(value);
        return Boolean(url && new URL(url).pathname.toLowerCase().endsWith('.pdf'));
    }

    const purifier = root.DOMPurify;
    if (purifier && purifier.isSupported) {
        purifier.addHook('uponSanitizeAttribute', (node, data) => {
            if (data.attrName === 'href') {
                const url = safeUrl(data.attrValue);
                if (!url) data.keepAttr = false;
                else data.attrValue = url;
            }
        });
        purifier.addHook('afterSanitizeAttributes', node => {
            if (node.nodeName === 'A') node.setAttribute('rel', 'noopener noreferrer');
        });
    }
    function sanitizeRichHtml(value) {
        const html = String(value ?? '');
        // Fail closed if the local dependency could not load or the browser is unsupported.
        if (!purifier || !purifier.isSupported) return escapeHtml(html);
        return purifier.sanitize(html, {
            ALLOWED_TAGS: ['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
                'ul', 'ol', 'li', 'blockquote', 'a', 'h2', 'h3', 'h4', 'sub', 'sup'],
            ALLOWED_ATTR: ['href', 'title', 'dir', 'rel'],
            ALLOW_DATA_ATTR: false,
            ALLOW_ARIA_ATTR: false,
            SANITIZE_DOM: true
        });
    }

    function insertEditorContent(editor, html) {
        const clean = sanitizeRichHtml(html);
        editor.focus();
        if (typeof root.document.execCommand === 'function' &&
            root.document.execCommand('insertHTML', false, clean)) return;
        const selection = root.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : root.document.createRange();
        if (!editor.contains(range.commonAncestorContainer)) {
            range.selectNodeContents(editor);
            range.collapse(false);
        }
        range.deleteContents();
        const template = root.document.createElement('template');
        template.innerHTML = clean;
        const last = template.content.lastChild;
        range.insertNode(template.content);
        if (last) { range.setStartAfter(last); range.collapse(true); }
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
        editor.dispatchEvent(new root.Event('input', { bubbles: true }));
    }

    function protectRichEditors(container) {
        function transfer(event) {
            const editor = event.target.closest && event.target.closest('.rich-editor-content');
            if (!editor || !container.contains(editor)) return;
            const transfer = event.clipboardData || event.dataTransfer;
            event.preventDefault();
            if (!transfer) return;
            const html = transfer.getData('text/html');
            const text = transfer.getData('text/plain');
            insertEditorContent(editor, html || escapeHtml(text).replace(/\r?\n/g, '<br>'));
        }
        container.addEventListener('paste', transfer);
        container.addEventListener('drop', transfer);
    }
    root.TabaatContent = Object.freeze({ escapeHtml, safeUrl, isPdf, sanitizeRichHtml, protectRichEditors });
})(window);
