
    let booksData = [];
    let sciencesData = [];

    // Configuration GitHub pour l'upload d'images
    const GH_OWNER = 'arabic-app';
    const GH_REPO = 'tabaat';

    new Sortable(document.getElementById('bestEditions'), { handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost' });
    new Sortable(document.getElementById('altEditions'),  { handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost' });
    new Sortable(document.getElementById('links'),        { handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost' });

    Promise.all([
        fetch('../books.json').then(r => { if (!r.ok) throw new Error('not found'); return r.json(); }).catch((err) => { console.warn('Offline/failed books fetch:', err); return []; }),
        fetch('../sciences.json').then(r => { if (!r.ok) throw new Error('not found'); return r.json(); }).catch((err) => { console.warn('Offline/failed sciences fetch:', err); return []; })
    ]).then(([books, sciences]) => {
        booksData = books;
        sciencesData = sciences;
        renderSidebar();
    });

    /* ---- SIDEBAR ---- */
    function renderSidebar(searchTerm = '') {
        const list = document.getElementById('booksList');
        list.innerHTML = '';
        const term = String(searchTerm).trim().toLowerCase();
        const currentId = document.getElementById('bookId').value;

        const sortedBooks = [...booksData].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ar'));

        sortedBooks
            .filter(b => (b.title && b.title.toLowerCase().includes(term)) || (b.author && b.author.toLowerCase().includes(term)))
            .forEach(book => {
                const li = document.createElement('li');
                li.textContent = book.title || 'بدون عنوان';
                if (currentId && parseInt(currentId) === book.id) li.classList.add('active');
                li.onclick = () => { loadBookIntoForm(book.id, li); closeSidebar(); };
                list.appendChild(li);
            });
    }

    document.getElementById('adminSearchInput').addEventListener('input', e => renderSidebar(e.target.value));

    document.getElementById('title').addEventListener('blur', function () {
        const val = this.value.trim();
        const currentId = document.getElementById('bookId').value;
        const warn = document.getElementById('duplicateWarning');
        if (!currentId && val) {
            const dup = booksData.find(b => b.title && b.title.trim().toLowerCase() === val.toLowerCase());
            if (dup) {
                warn.style.display = 'flex';
                document.getElementById('btnEditDuplicate').onclick = () => {
                    warn.style.display = 'none';
                    const li = [...document.querySelectorAll('.sidebar-list li')].find(l => l.textContent === dup.title);
                    loadBookIntoForm(dup.id, li);
                };
            } else { warn.style.display = 'none'; }
        } else { warn.style.display = 'none'; }
    });

    /* ---- MOBILE DRAWER ---- */
    function toggleSidebar() {
        const s = document.getElementById('sidebar');
        s.classList.contains('open') ? closeSidebar() : openSidebar();
    }
    function openSidebar() {
        document.getElementById('sidebar').classList.add('open');
        document.getElementById('overlay').classList.add('visible');
    }
    function closeSidebar() {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('visible');
    }

    /* ---- DRAG AND DROP BINDING ---- */
    function bindDragAndDrop(containerGroup, fileInput, dirPath = 'images', allowedExtensions = ['png', 'jpg', 'jpeg', 'webp']) {
        // Empêche le comportement par défaut (qui ouvrirait l'image dans le navigateur)
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            containerGroup.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        ['dragenter', 'dragover'].forEach(eventName => {
            containerGroup.addEventListener(eventName, () => containerGroup.classList.add('drag-over'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            containerGroup.addEventListener(eventName, () => containerGroup.classList.remove('drag-over'), false);
        });

        containerGroup.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            
            if (files && files.length > 0) {
                const ext = files[0].name.split('.').pop().toLowerCase();
                if (allowedExtensions.includes(ext)) {
                    fileInput.files = files; // Transférer le fichier à l'input invisible
                    uploadFileToGitHub(fileInput, dirPath, allowedExtensions); // Lancer l'upload
                } else {
                    alert("الملف غير مدعوم. الامتدادات المسموحة: " + allowedExtensions.join(', '));
                }
            }
        }, false);
    }

    /* ---- ROWS ---- */
    window.addCategoryInput = function (containerId, val = '') {
        const list = document.getElementById(containerId);
        const div = document.createElement('div');
        div.className = 'dynamic-input-group';

        let options = [...sciencesData];
        if (val && !options.includes(val)) options.unshift(val);

        const optionsHTML = options.map(s =>
            `<option value="${s}"${s === val ? ' selected' : ''}>${s}</option>`
        ).join('');

        div.innerHTML = `
            <select class="md-input cat-input" required>
                <option value="" disabled${val ? '' : ' selected'}>اختر العلم من القائمة...</option>
                ${optionsHTML}
            </select>
            <button type="button" class="btn-remove-item" onclick="if(this.parentElement.parentElement.children.length > 1) this.parentElement.remove()" title="حذف">−</button>`;
        list.appendChild(div);
    };

    window.addImageInputToEdition = function (btn) {
        const list = btn.previousElementSibling;
        const div = document.createElement('div');
        div.className = 'dynamic-input-group';
        div.innerHTML = `
            <input type="text" class="md-input ed-image-url" placeholder="اسحب الصورة هنا أو اضغط رفع... أو ضع رابطاً" style="direction:ltr">
            <input type="file" accept="image/png, image/jpeg, image/webp" style="display:none;" onchange="uploadFileToGitHub(this, 'images', ['png', 'jpg', 'jpeg', 'webp'])">
            <button type="button" class="btn-upload-img" onclick="this.previousElementSibling.click()" title="رفع صورة"><span class="material-icons-round">file_upload</span></button>
            <button type="button" class="btn-remove-item" onclick="this.parentElement.remove()">−</button>`;
        list.appendChild(div);
        
        // Attacher les événements Drag & Drop au nouveau groupe
        bindDragAndDrop(div, div.querySelector('input[type="file"]'));
    };

    window.renderCorrectionCard = function(container, corrTitle = '', corrBody = '', attachments = []) {
        const card = document.createElement('div');
        card.className = 'correction-card';
        
        card.innerHTML = `
            <div class="correction-header">
                <input type="text" class="md-input corr-title" placeholder="عنوان التصويب (مثال: خطأ في صفحة 25)..." value="${corrTitle}" required>
                <button type="button" class="btn-remove-item" onclick="this.closest('.correction-card').remove()" title="حذف التصويب">−</button>
            </div>
            <div class="rich-editor" style="margin-top: 6px;">
                <div class="rich-toolbar">
                    <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('bold', false, null);" title="خط عريض"><span class="material-icons-round">format_bold</span></button>
                    <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('italic', false, null);" title="خط مائل"><span class="material-icons-round">format_italic</span></button>
                    <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('underline', false, null);" title="تحته خط"><span class="material-icons-round">format_underlined</span></button>
                    <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('insertUnorderedList', false, null);" title="قائمة نقطية"><span class="material-icons-round">format_list_bulleted</span></button>
                    <button type="button" class="tb-btn" onmousedown="event.preventDefault(); const url = prompt('أدخل رابط URL:'); if(url) document.execCommand('createLink', false, url);" title="إضافة رابط"><span class="material-icons-round">link</span></button>
                    <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('unlink', false, null);" title="إزالة الرابط"><span class="material-icons-round">link_off</span></button>
                    <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('removeFormat', false, null);" title="مسح التنسيق"><span class="material-icons-round">format_clear</span></button>
                </div>
                <div class="rich-editor-content corr-body" contenteditable="true" placeholder="تفاصيل التصويب...">${corrBody}</div>
            </div>
            <div class="sub-container" style="margin-top: 8px; background: var(--md-background)">
                <div class="sub-container-title">
                    <span class="material-icons-round" style="font-size:14px;color:var(--md-primary)">attachment</span>
                    الملحقات (صور أو ملفات PDF):
                </div>
                <div class="attachments-list"></div>
                <button type="button" class="btn-add-item" onclick="window.addNewAttachmentRow(this)">
                    <span class="material-icons-round" style="font-size:14px">attach_file</span> إضافة ملحق
                </button>
            </div>
        `;
        container.appendChild(card);
        
        const attachListContainer = card.querySelector('.attachments-list');
        (attachments || []).forEach(attach => {
            renderAttachmentRow(attachListContainer, attach.title, attach.url);
        });
    };

    window.addNewCorrectionRow = function(btn) {
        const container = btn.previousElementSibling;
        renderCorrectionCard(container);
    };

    window.renderAttachmentRow = function(container, title = '', url = '') {
        const div = document.createElement('div');
        div.className = 'attachment-row dynamic-input-group';
        
        div.innerHTML = `
            <input type="text" class="md-input attach-title" placeholder="عنوان الملحق (مثال: صورة الصفحة قبل التصحيح)..." value="${title}" style="flex: 1;" required>
            <input type="text" class="md-input attach-url" placeholder="رابط الملف أو اسحب/ارفع..." value="${url}" style="flex: 1.5; direction:ltr;" required>
            <input type="file" accept="image/*,application/pdf" style="display:none;" onchange="uploadFileToGitHub(this, 'corrections', ['png', 'jpg', 'jpeg', 'webp', 'pdf'])">
            <button type="button" class="btn-upload-img" onclick="this.previousElementSibling.click()" title="رفع ملف (صورة أو PDF)"><span class="material-icons-round">file_upload</span></button>
            <button type="button" class="btn-remove-item" onclick="this.parentElement.remove()" title="حذف الملحق">−</button>
        `;
        container.appendChild(div);
        
        const fileInput = div.querySelector('input[type="file"]');
        bindDragAndDrop(div, fileInput, 'corrections', ['png', 'jpg', 'jpeg', 'webp', 'pdf']);
    };

    window.addNewAttachmentRow = function(btn) {
        const container = btn.previousElementSibling;
        renderAttachmentRow(container);
    };

    function addEditionRow(containerId, name = '', imagesArray = [], notes = '', corrections = []) {
        const container = document.getElementById(containerId);
        const row = document.createElement('div');
        row.className = 'dynamic-row';

        let imgs = Array.isArray(imagesArray) ? imagesArray : (imagesArray ? [imagesArray] : []);
        if (imgs.length === 0) imgs = [''];

        const imgsHTML = imgs.map(img => `
            <div class="dynamic-input-group">
                <input type="text" class="md-input ed-image-url" placeholder="اسحب الصورة هنا أو اضغط رفع... أو ضع رابطاً" value="${img}" style="direction:ltr">
                <input type="file" accept="image/png, image/jpeg, image/webp" style="display:none;" onchange="uploadFileToGitHub(this, 'images', ['png', 'jpg', 'jpeg', 'webp'])">
                <button type="button" class="btn-upload-img" onclick="this.previousElementSibling.click()" title="رفع صورة من الجهاز"><span class="material-icons-round">file_upload</span></button>
                <button type="button" class="btn-remove-item" onclick="this.parentElement.remove()" title="حذف الرابط">−</button>
            </div>`).join('');

        row.innerHTML = `
            <span class="drag-handle" title="اسحب للترتيب">☰</span>
            <div class="row-inputs">
                <input type="text" class="md-input ed-name" placeholder="اسم دار النشر أو المحقق *" value="${name}" required>
                <div class="sub-container">
                    <div class="sub-container-title">
                        <span class="material-icons-round" style="font-size:14px;color:var(--md-primary)">image</span>
                        صور الطبعة:
                    </div>
                    <div class="images-list">${imgsHTML}</div>
                    <button type="button" class="btn-add-item" onclick="addImageInputToEdition(this)">
                        <span class="material-icons-round" style="font-size:14px">add_photo_alternate</span> إضافة حقل صورة
                    </button>
                </div>
                <div class="rich-editor">
                    <div class="rich-toolbar">
                        <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('bold', false, null);" title="خط عريض"><span class="material-icons-round">format_bold</span></button>
                        <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('italic', false, null);" title="خط مائل"><span class="material-icons-round">format_italic</span></button>
                        <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('underline', false, null);" title="تحته خط"><span class="material-icons-round">format_underlined</span></button>
                        <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('insertUnorderedList', false, null);" title="قائمة نقطية"><span class="material-icons-round">format_list_bulleted</span></button>
                        <button type="button" class="tb-btn" onmousedown="event.preventDefault(); const url = prompt('أدخل رابط URL:'); if(url) document.execCommand('createLink', false, url);" title="إضافة رابط"><span class="material-icons-round">link</span></button>
                        <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('unlink', false, null);" title="إزالة الرابط"><span class="material-icons-round">link_off</span></button>
                        <button type="button" class="tb-btn" onmousedown="event.preventDefault(); document.execCommand('removeFormat', false, null);" title="مسح التنسيق"><span class="material-icons-round">format_clear</span></button>
                    </div>
                    <div class="rich-editor-content ed-notes" contenteditable="true" placeholder="ملاحظات خاصة بهذه الطبعة (تظهر كـ ℹ في الموقع)...">${notes}</div>
                </div>
                <div class="sub-container" style="margin-top: 10px;">
                    <div class="sub-container-title" style="margin-bottom: 8px;">
                        <span class="material-icons-round" style="font-size:14px;color:var(--md-primary)">report_problem</span>
                        تصويبات الطبعة (أخطاء مطبعية أو علمية):
                    </div>
                    <div class="corrections-list"></div>
                    <button type="button" class="btn-add-item" onclick="window.addNewCorrectionRow(this)" style="margin-top: 6px;">
                        <span class="material-icons-round" style="font-size:14px">add_alert</span> إضافة تصويب
                    </button>
                </div>
            </div>
            <button type="button" class="btn-remove" onclick="this.parentElement.remove()" title="حذف">
                <span class="material-icons-round">delete</span>
            </button>`;
        container.appendChild(row);

        const corrListContainer = row.querySelector('.corrections-list');
        (corrections || []).forEach(corr => {
            renderCorrectionCard(corrListContainer, corr.title, corr.body, corr.attachments);
        });

        // Attacher le drag and drop à tous les champs d'images créés dans cette ligne
        const imageGroups = row.querySelectorAll('.dynamic-input-group');
        imageGroups.forEach(group => {
            const fileInput = group.querySelector('input[type="file"]');
            if(fileInput) bindDragAndDrop(group, fileInput);
        });
    }

    function addLinkRow(containerId, title = '', url = '') {
        const container = document.getElementById(containerId);
        const row = document.createElement('div');
        row.className = 'dynamic-row';
        row.innerHTML = `
            <span class="drag-handle" title="اسحب للترتيب">☰</span>
            <div class="row-inputs-horizontal">
                <input type="text" class="md-input link-title" placeholder="عنوان الرابط..." value="${title}" required>
                <input type="text" class="md-input link-url"  placeholder="الرابط الكامل (URL)..." value="${url}" required style="direction:ltr">
            </div>
            <button type="button" class="btn-remove" onclick="this.parentElement.remove()" title="حذف">
                <span class="material-icons-round">delete</span>
            </button>`;
        container.appendChild(row);
    }

    /* ---- GITHUB FILE UPLOAD ---- */
    async function uploadFileToGitHub(fileInput, dirPath = 'images', allowedExtensions = ['png', 'jpg', 'jpeg', 'webp']) {
        const file = fileInput.files[0];
        if (!file) return;

        // Check extension
        const ext = file.name.split('.').pop().toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            alert("الرجاء اختيار ملف ذو امتداد مسموح: " + allowedExtensions.join(', '));
            fileInput.value = '';
            return;
        }

        const token = document.getElementById('githubToken').value.trim();
        if (!token) {
            alert('⚠️ يرجى إدخال GitHub Token في الأعلى لتمكين الرفع!');
            fileInput.value = ''; 
            return;
        }

        const textInput = fileInput.previousElementSibling;
        const reader = new FileReader();
        
        reader.onload = async function(event) {
            const base64Content = event.target.result.split(',')[1];
            const uniqueName = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9.]/g, '');
            const filePath = dirPath + '/' + uniqueName;
            const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;

            document.getElementById('loaderOverlay').classList.add('visible');

            try {
                const response = await fetch(apiUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: `Upload file: ${uniqueName} to ${dirPath}`,
                        content: base64Content
                    })
                });

                if (response.ok) {
                    const publicUrl = `https://${GH_OWNER}.github.io/${GH_REPO}/${filePath}`;
                    textInput.value = publicUrl;
                    showToast('✅ تم رفع الملف بنجاح!');
                } else {
                    const err = await response.json();
                    alert('❌ فشل الرفع: ' + err.message);
                }
            } catch (error) {
                alert('❌ حدث خطأ أثناء الاتصال بـ GitHub.');
            } finally {
                document.getElementById('loaderOverlay').classList.remove('visible');
                fileInput.value = ''; 
            }
        };
        reader.readAsDataURL(file);
    }

    /* ---- CREATE / LOAD ---- */
    function createNewBook() {
        document.getElementById('formContainer').style.display = 'block';
        document.getElementById('formTitle').textContent = 'إضافة كتاب جديد';
        document.getElementById('formIcon').textContent = 'add_circle';
        document.getElementById('bookForm').reset();
        document.getElementById('notes').innerHTML = '';
        document.getElementById('bookId').value = '';
        document.getElementById('duplicateWarning').style.display = 'none';
        
        document.getElementById('btnDeleteBook').style.display = 'none';

        document.getElementById('categoriesList').innerHTML = '';
        addCategoryInput('categoriesList'); 

        document.querySelectorAll('.sidebar-list li').forEach(li => li.classList.remove('active'));
        document.getElementById('bestEditions').innerHTML = '';
        document.getElementById('altEditions').innerHTML = '';
        document.getElementById('links').innerHTML = '';
        addEditionRow('bestEditions');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        closeSidebar();
    }

    function loadBookIntoForm(id, liElement) {
        document.querySelectorAll('.sidebar-list li').forEach(li => li.classList.remove('active'));
        if (liElement) liElement.classList.add('active');

        const book = booksData.find(b => b.id === id);
        if (!book) return;

        document.getElementById('formContainer').style.display = 'block';
        document.getElementById('formTitle').textContent = 'تعديل: ' + book.title;
        document.getElementById('formIcon').textContent = 'edit';
        document.getElementById('duplicateWarning').style.display = 'none';
        
        document.getElementById('btnDeleteBook').style.display = 'inline-flex';

        document.getElementById('bookId').value = book.id;
        document.getElementById('title').value = book.title || '';
        document.getElementById('author').value = book.author || '';
        document.getElementById('notes').innerHTML = book.notes || '';

        document.getElementById('categoriesList').innerHTML = '';
        let cats = Array.isArray(book.category) ? book.category : (book.category ? [book.category] : []);
        if (cats.length === 0) cats = [''];
        cats.forEach(c => addCategoryInput('categoriesList', c));

        const loadEditions = (cid, arr) => {
            const c = document.getElementById(cid);
            c.innerHTML = '';
            (arr || []).forEach(ed => {
                const imgs = ed.images ? ed.images : (ed.image ? [ed.image] : []);
                addEditionRow(cid, ed.name, imgs, ed.notes || '', ed.corrections || []);
            });
        };
        loadEditions('bestEditions', book.best_editions);
        loadEditions('altEditions', book.alt_editions);

        const lc = document.getElementById('links');
        lc.innerHTML = '';
        (book.links || []).forEach(l => addLinkRow('links', l.title, l.url));

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ---- SAVE & DELETE ---- */
    function saveBook(e) {
        e.preventDefault();
        let id = document.getElementById('bookId').value;
        id = id ? parseInt(id) : (booksData.length > 0 ? Math.max(...booksData.map(b => b.id)) + 1 : 1);

        const catInputs = [...document.querySelectorAll('#categoriesList .cat-input')];
        const categoriesArray = catInputs.map(i => i.value.trim()).filter(Boolean);

        const newBook = {
            id,
            title:    document.getElementById('title').value.trim(),
            author:   document.getElementById('author').value.trim(),
            category: categoriesArray,
            notes:    (() => {
                let n = document.getElementById('notes').innerHTML.trim();
                return (n === '<br>' || n === '<div><br></div>' || n === '<p><br></p>') ? '' : n;
            })(),
            best_editions: [], alt_editions: [], links: []
        };

        const cleanHtml = h => (h === '<br>' || h === '<div><br></div>' || h === '<p><br></p>') ? '' : h;
        const collectEditions = (cid, arr) => {
            document.querySelectorAll(`#${cid} .dynamic-row`).forEach(row => {
                const images = [...row.querySelectorAll('.ed-image-url')].map(i => i.value.trim()).filter(Boolean);
                let notesHtml = cleanHtml(row.querySelector('.ed-notes').innerHTML.trim());
                const corrections = [...row.querySelectorAll('.correction-card')].map(card => {
                    const title = card.querySelector('.corr-title').value.trim();
                    let body = cleanHtml(card.querySelector('.corr-body').innerHTML.trim());
                    const attachments = [...card.querySelectorAll('.attachment-row')].map(att => ({
                        title: att.querySelector('.attach-title').value.trim(),
                        url:   att.querySelector('.attach-url').value.trim()
                    })).filter(a => a.title || a.url);
                    return { title, body, attachments };
                }).filter(c => c.title || c.body || c.attachments.length);
                arr.push({ name: row.querySelector('.ed-name').value.trim(), images, notes: notesHtml, corrections });
            });
        };
        collectEditions('bestEditions', newBook.best_editions);
        collectEditions('altEditions', newBook.alt_editions);
        document.querySelectorAll('#links .dynamic-row').forEach(row => {
            newBook.links.push({ title: row.querySelector('.link-title').value.trim(), url: row.querySelector('.link-url').value.trim() });
        });

        const idx = booksData.findIndex(b => b.id === id);
        if (idx >= 0) booksData[idx] = newBook; else booksData.push(newBook);

        document.getElementById('bookId').value = id;
        document.getElementById('btnDeleteBook').style.display = 'inline-flex';
        
        renderSidebar(document.getElementById('adminSearchInput').value);
        showToast('💾 تم الحفظ في الذاكرة. لا تنسَ تحديث الموقع ليتم الرفع!');
    }

    function openDeleteModal() { document.getElementById('deleteModal').classList.add('visible'); }
    function closeDeleteModal() { document.getElementById('deleteModal').classList.remove('visible'); }

    function executeDeleteBook() {
        const id = parseInt(document.getElementById('bookId').value);
        if (!id) return;

        booksData = booksData.filter(b => b.id !== id);
        closeDeleteModal();
        renderSidebar(document.getElementById('adminSearchInput').value);
        document.getElementById('formContainer').style.display = 'none';
        
        showToast('🗑️ تم حذف الكتاب بنجاح. لا تنسَ التحديث!');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ---- EXPORT / SYNC ---- */
    const getJSONString = () => JSON.stringify(booksData, null, 2);

    function copyJSON() { navigator.clipboard.writeText(getJSONString()).then(() => showToast('📋 تم نسخ JSON إلى الحافظة.')); }
    
    function downloadJSON() {
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(new Blob([getJSONString()], { type: 'application/json' })),
            download: '../books.json'
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showToast('💾 تم التحميل.');
    }

    function utf8_to_b64(str) { return btoa(unescape(encodeURIComponent(str))); }

    async function syncToGitHub() {
        const token = document.getElementById('githubToken').value.trim();
        if (!token) { showToast('⚠️ يرجى إدخال رمز GitHub Token أولاً!'); return; }
        localStorage.setItem('github_token_secured', token);

        const path = '../books.json';
        const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
        
        document.getElementById('loaderOverlay').classList.add('visible');

        try {
            let sha = '';
            const getRes = await fetch(apiUrl, { headers: { Authorization: `token ${token}` } });
            if (getRes.ok) sha = (await getRes.json()).sha;

            const putRes = await fetch(apiUrl, {
                method: 'PUT',
                headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'تحديث قاعدة البيانات عبر لوحة الإدارة', content: utf8_to_b64(getJSONString()), sha })
            });

            if (putRes.ok) showToast('🚀 تم الرفع إلى GitHub بنجاح!');
            else { const err = await putRes.json(); showToast('❌ فشل: ' + err.message); }
        } catch (err) {
            showToast('❌ خطأ في الاتصال.');
        } finally {
            document.getElementById('loaderOverlay').classList.remove('visible');
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        const saved = localStorage.getItem('github_token_secured');
        if (saved) document.getElementById('githubToken').value = saved;
    });

    /* ---- TOAST ---- */
    let toastTimer;
    function showToast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.style.display = 'none', 4500);
    }


(function() {
    'use strict';

    /* ── 1. SERVICE WORKER ── */
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('../sw.js', { scope: '../' })
                .then(reg => {
                    reg.addEventListener('updatefound', () => {
                        const nw = reg.installing;
                        nw.addEventListener('statechange', () => {
                            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                                nw.postMessage({ type: 'SKIP_WAITING' });
                            }
                        });
                    });
                })
                .catch(err => console.warn('[PWA Admin] SW:', err));
        });
    }

    /* ── 2. DÉTECTION OS ── */
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|od|ad)/.test(ua);
    const isAndroid = /Android/.test(ua);
    const isInStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;

    /* ── 3. INSTALL BANNER ── */
    const banner     = document.getElementById('pwa-banner');
    const installBtn = document.getElementById('pwa-install-btn');
    const headerInstallBtn = document.getElementById('header-install-btn');
    const dismissBtn = document.getElementById('pwa-dismiss-btn');
    const bannerText = document.getElementById('pwa-banner-text');
    let deferredPrompt = null;
    const DISMISS_KEY = 'pwa_dismissed_admin';

    function showBanner() {
        if (localStorage.getItem(DISMISS_KEY)) return;
        banner.classList.add('visible');
    }
    function hideBanner() { banner.classList.remove('visible'); }

    dismissBtn.addEventListener('click', () => {
        hideBanner();
        localStorage.setItem(DISMISS_KEY, '1');
    });

    async function triggerInstallPrompt() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        hideBanner();
        headerInstallBtn.style.display = 'none';
        if (outcome === 'accepted') localStorage.setItem(DISMISS_KEY, '1');
    }

    if (!isInStandalone) {
        if (isIOS) {
            bannerText.innerHTML = `
                <strong>أضف لوحة الإدارة لشاشتك</strong>
                <div class="pwa-ios-steps">
                    <div class="pwa-ios-step">
                        <span class="step-icon material-icons-round">ios_share</span>
                        <span>اضغط على زر المشاركة ثم</span>
                    </div>
                    <div class="pwa-ios-step">
                        <span class="step-icon material-icons-round">add_box</span>
                        <span>اختر «إضافة إلى الشاشة الرئيسية»</span>
                    </div>
                </div>`;
            installBtn.style.display = 'none';
            headerInstallBtn.style.display = 'block';
            headerInstallBtn.addEventListener('click', () => {
                banner.classList.add('visible');
            });
            setTimeout(showBanner, 2000);
        } else {
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                deferredPrompt = e;
                headerInstallBtn.style.display = 'block';
                setTimeout(showBanner, 1500);
            });
            installBtn.addEventListener('click', triggerInstallPrompt);
            headerInstallBtn.addEventListener('click', triggerInstallPrompt);
            window.addEventListener('appinstalled', () => {
                hideBanner();
                headerInstallBtn.style.display = 'none';
                deferredPrompt = null;
            });
        }
    }



})();
