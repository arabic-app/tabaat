
        let booksData = [];
        let currentCarouselImages = [];
        let currentSlideIndex = 0;
        
        let currentSearchTerm = '';
        let currentCategory = 'الكل';

        fetch('books.json')
            .then(r => {
                if (!r.ok) throw new Error('Network error');
                return r.json();
            })
            .then(data => { 
                booksData = data.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ar'));
                initCategories();
                filterAndDisplayBooks(); 
            })
            .catch(err => {
                console.warn('Failed to fetch books.json from network, trying cache fallback...', err);
                // The service worker will intercept this plain 'books.json' call and return cache if offline.
            });

        function getBookCategories(book) {
            if (Array.isArray(book.category)) return book.category;
            if (book.category) return [book.category];
            return [];
        }

        function initCategories() {
            const container = document.getElementById('categoryChips');
            container.innerHTML = '';
            
            let allCategories = [];
            booksData.forEach(b => allCategories.push(...getBookCategories(b)));
            const uniqueCategories = [...new Set(allCategories.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
            
            container.appendChild(createChip('الكل', 'الكل', true));
            uniqueCategories.forEach(cat => container.appendChild(createChip(cat, cat, false)));
        }

        function createChip(label, value, isActive) {
            const btn = document.createElement('button');
            btn.className = `chip ${isActive ? 'active' : ''}`;
            btn.innerText = label;
            btn.dataset.value = value;
            btn.onclick = () => {
                document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                currentCategory = value;
                filterAndDisplayBooks();
            };
            return btn;
        }

        const sfWrapper = document.getElementById('scienceFilterWrapper');
        const sfBtn = document.getElementById('scienceFilterBtn');
        const sfInput = document.getElementById('scienceSearchInput');

        sfBtn.onclick = () => {
            sfWrapper.classList.toggle('expanded');
            if (sfWrapper.classList.contains('expanded')) {
                sfInput.focus();
            } else {
                filterChips(''); // إعادة إظهار التصنيفات عند إغلاق العدسة
            }
        };

        sfInput.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); sfInput.blur(); sfWrapper.classList.remove('expanded'); }
        };

        sfInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            filterChips(term);
        };

        function filterChips(term) {
            document.querySelectorAll('.chip').forEach(chip => {
                if (chip.dataset.value === 'الكل' || chip.dataset.value.toLowerCase().includes(term)) {
                    chip.style.display = 'inline-flex';
                } else {
                    chip.style.display = 'none';
                    if (chip.classList.contains('active')) {
                        // إذا اختفى التصنيف المحدد، نعود لـ "الكل"
                        document.querySelector('.chip[data-value="الكل"]').click();
                    }
                }
            });
        }

        const mainSearch = document.getElementById('searchInput');
        mainSearch.oninput = (e) => { currentSearchTerm = e.target.value.toLowerCase(); filterAndDisplayBooks(); };
        mainSearch.onkeydown = (e) => { if(e.key === 'Enter') { e.preventDefault(); mainSearch.blur(); } };

        function filterAndDisplayBooks() {
            const filtered = booksData.filter(book => {
                const matchesSearch = (book.title && book.title.toLowerCase().includes(currentSearchTerm)) ||
                                      (book.author && book.author.toLowerCase().includes(currentSearchTerm));
                
                const cats = getBookCategories(book);
                const matchesCategory = currentCategory === 'الكل' || cats.includes(currentCategory);
                
                return matchesSearch && matchesCategory;
            });
            displayBooks(filtered);
        }

        function displayBooks(books) {
            const container = document.getElementById('booksContainer');
            container.innerHTML = '';

            if (books.length === 0) {
                container.innerHTML = `<div class="empty-state"><span class="material-icons-round">search_off</span><h3>لا توجد نتائج مطابقة لبحثك في هذا القسم.</h3></div>`;
                return;
            }

            books.forEach(book => {
                const card = document.createElement('div');
                card.className = 'md-card';

                const bookCats = getBookCategories(book);
                const catsHTML = bookCats.map(cat => `
                    <span class="meta-chip">
                        <span class="material-icons-round">category</span>
                        <span class="text">${cat}</span>
                    </span>
                `).join('');

                const renderList = (editions, isEdition, type) => (editions || []).map((ed, idx) => {
                    let actions = '';
                    if (isEdition && ed.corrections && ed.corrections.length) actions += `<button class="md-icon-btn" onclick="openCorrectionsModal(${book.id}, '${type}', ${idx})" title="تصويبات الطبعة"><span class="material-icons-round">report_problem</span></button>`;
                    if (isEdition && ed.notes) actions += `<button class="md-icon-btn" onclick="openNoteModal('${encodeURIComponent(ed.name)}', '${encodeURIComponent(ed.notes)}')" title="ملاحظات حول الطبعة"><span class="material-icons-round">info</span></button>`;
                    if (isEdition && ((ed.images && ed.images.length) || ed.image)) actions += `<button class="md-icon-btn" onclick="openImageModal(${book.id}, '${type}', ${idx})" title="عرض صور الطبعة"><span class="material-icons-round">photo_library</span></button>`;
                    
                    return isEdition 
                        ? `<li class="md-list-item"><span class="edition-name">${ed.name}</span><div class="edition-actions">${actions}</div></li>`
                        : `<li class="md-list-item"><a href="${ed.url}" target="_blank" class="link-item"><span class="material-icons-round">open_in_new</span><span class="edition-name">${ed.title}</span></a></li>`;
                }).join('');

                card.innerHTML = `
                    <h2 class="book-title">${book.title}</h2>
                    <div class="book-meta">
                        <span class="meta-chip"><span class="material-icons-round">person</span><span class="text">${book.author}</span></span>
                        ${catsHTML}
                    </div>
                    ${book.best_editions?.length ? `<div class="section-title"><span class="material-icons-round">verified</span> أفضل الطبعات:</div><ul>${renderList(book.best_editions, true, 'best_editions')}</ul>` : ''}
                    ${book.alt_editions?.length ? `<div class="section-title"><span class="material-icons-round">rule</span> طبعات بديلة جيدة:</div><ul>${renderList(book.alt_editions, true, 'alt_editions')}</ul>` : ''}
                    ${book.links?.length ? `<div class="section-title"><span class="material-icons-round">link</span> روابط مفيدة:</div><ul>${renderList(book.links, false)}</ul>` : ''}
                    ${book.notes ? `<div class="book-notes"><span class="material-icons-round">lightbulb</span><div>${book.notes}</div></div>` : ''}
                `;
                container.appendChild(card);
            });
        }

        function openNoteModal(title, content) {
            document.getElementById('modalTitle').innerText = decodeURIComponent(title);
            document.getElementById('modalBody').innerHTML = decodeURIComponent(content);
            document.getElementById('infoModal').style.display = 'flex';
        }

        function openImageModal(bookId, edType, index) {
            const ed = booksData.find(b => b.id === bookId)[edType][index];
            document.getElementById('modalTitle').innerText = ed.name;
            currentCarouselImages = ed.images?.length ? ed.images : (ed.image ? [ed.image] : []);
            currentSlideIndex = 0;
            renderCarousel();
            document.getElementById('infoModal').style.display = 'flex';
        }

        function renderCarousel() {
            const body = document.getElementById('modalBody');
            if (currentCarouselImages.length <= 1) {
                body.innerHTML = `<div class="carousel-container"><img src="${currentCarouselImages[0]}" class="carousel-img"></div>`;
            } else {
                body.innerHTML = `
                    <div class="carousel-container">
                        <button class="carousel-btn right" dir="ltr" onclick="changeSlide(-1)"><span class="material-icons-round">chevron_right</span></button>
                        <img src="${currentCarouselImages[currentSlideIndex]}" class="carousel-img">
                        <button class="carousel-btn left" dir="ltr" onclick="changeSlide(1)"><span class="material-icons-round">chevron_left</span></button>
                    </div>
                    <div class="carousel-dots">صورة ${currentSlideIndex + 1} من ${currentCarouselImages.length}</div>`;
            }
        }
        
        function changeSlide(dir) { currentSlideIndex = (currentSlideIndex + dir + currentCarouselImages.length) % currentCarouselImages.length; renderCarousel(); }

        function openCorrectionsModal(bookId, edType, edIdx) {
            const ed = booksData.find(b => b.id === bookId)[edType][edIdx];
            document.getElementById('modalTitle').innerText = 'صحح نسختك';
            const list = (ed.corrections || []).map((corr, ci) => `
                <div class="corr-item-clickable" onclick="showCorrectionDetail(${bookId}, '${edType}', ${edIdx}, ${ci})">
                    <span class="material-icons-round">chevron_left</span>
                    <span>${corr.title || 'تصويب ' + (ci + 1)}</span>
                </div>
            `).join('');
            document.getElementById('modalBody').innerHTML = `
                <p style="font-size:0.85rem;color:var(--md-outline);margin-bottom:12px;">اضغط على تصويب لعرض تفاصيله:</p>
                <div class="modal-corrections-list">${list}</div>
            `;
            document.getElementById('infoModal').style.display = 'flex';
        }

        function showCorrectionDetail(bookId, edType, edIdx, corrIdx) {
            const ed = booksData.find(b => b.id === bookId)[edType][edIdx];
            const corr = ed.corrections[corrIdx];
            const attachmentsHTML = (corr.attachments || []).map(att => {
                const isPdf = att.url && att.url.toLowerCase().endsWith('.pdf');
                if (isPdf) {
                    return `<a href="${att.url}" target="_blank" class="pdf-link">
                        <span class="material-icons-round">picture_as_pdf</span>
                        <span>${att.title || 'ملف PDF'}</span>
                    </a>`;
                } else {
                    return `<div class="attach-thumb">
                        <img src="${att.url}" alt="${att.title || 'مرفق'}" loading="lazy" onerror="this.parentElement.style.display='none'">
                        <span>${att.title || 'مرفق'}</span>
                    </div>`;
                }
            }).join('');
            document.getElementById('modalBody').innerHTML = `
                <button class="corr-back-btn" onclick="openCorrectionsModal(${bookId}, '${edType}', ${edIdx})">
                    <span class="material-icons-round" style="font-size:18px">arrow_forward</span> رجوع للقائمة
                </button>
                <div class="corr-detail-title">${corr.title || ''}</div>
                ${corr.body ? `<div class="corr-detail-body">${corr.body}</div>` : ''}
                ${attachmentsHTML ? `
                    <div class="corr-attachments-title">
                        <span class="material-icons-round" style="font-size:16px">attachment</span> الملحقات:
                    </div>
                    <div class="corr-attachments-list">${attachmentsHTML}</div>
                ` : ''}
            `;
        }

        function closeModal() { document.getElementById('infoModal').style.display = 'none'; }
        window.onclick = e => { if (e.target.id === 'infoModal') closeModal(); };
    

    (function() {
        'use strict';

        /* ── 1. SERVICE WORKER REGISTRATION ── */
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js', { scope: './' })
                    .then(reg => {
                        // Vérifier les mises à jour
                        reg.addEventListener('updatefound', () => {
                            const newWorker = reg.installing;
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    // Nouveau contenu disponible, forcer l'activation
                                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                                }
                            });
                        });
                    })
                    .catch(err => console.warn('[PWA] SW non enregistré:', err));
            });
        }

        /* ── 2. DÉTECTION OS ── */
        const ua = navigator.userAgent || '';
        const isIOS = /iP(hone|od|ad)/.test(ua);
        const isAndroid = /Android/.test(ua);
        const isInStandalone = window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;

        /* ── 3. INSTALL BANNER ── */
        const banner   = document.getElementById('pwa-banner');
        const installBtn = document.getElementById('pwa-install-btn');
        const headerInstallBtn = document.getElementById('header-install-btn');
        const dismissBtn = document.getElementById('pwa-dismiss-btn');
        const bannerText = document.getElementById('pwa-banner-text');
        let deferredPrompt = null;
        const DISMISS_KEY = 'pwa_dismissed_tabaat';

        function showBanner() {
            if (localStorage.getItem(DISMISS_KEY)) return;
            banner.classList.add('visible');
        }

        function hideBanner() {
            banner.classList.remove('visible');
        }

        dismissBtn.addEventListener('click', () => {
            hideBanner();
            localStorage.setItem(DISMISS_KEY, '1');
        });

        // Trigger PWA installation prompt
        async function triggerInstallPrompt() {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            hideBanner();
            headerInstallBtn.style.display = 'none';
            if (outcome === 'accepted') {
                localStorage.setItem(DISMISS_KEY, '1');
            }
        }

        if (!isInStandalone) {
            if (isIOS) {
                // iOS : instructions manuelles Partager → Ajouter
                bannerText.innerHTML = `
                    <strong>أضف «أفضل طبعة» لشاشتك الرئيسية</strong>
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
                // Show header install button (but since iOS has no programmatic trigger, we show instructions on click)
                headerInstallBtn.style.display = 'flex';
                headerInstallBtn.addEventListener('click', () => {
                    banner.classList.add('visible');
                });
                // Afficher après 2 secondes
                setTimeout(showBanner, 2000);

            } else if (isAndroid || (!isIOS && !isAndroid)) {
                // Android/Chrome/Desktop : beforeinstallprompt
                window.addEventListener('beforeinstallprompt', (e) => {
                    e.preventDefault();
                    deferredPrompt = e;
                    headerInstallBtn.style.display = 'flex';
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
    