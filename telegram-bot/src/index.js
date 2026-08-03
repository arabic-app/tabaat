// =============================================================================
// Configuration
// =============================================================================
const BOOKS_URL = 'https://arabic-app.github.io/tabaat/books.json';

// Fournisseurs IA (16), essayés dans l'ordre : Gemini d'abord (gros quota gratuit),
// puis Groq en secours. Chaque modèle Gemini a son propre budget de sortie.
// - gemini-2.0-flash    : SANS réflexion => rapide, tout le budget va à la réponse.
// - gemini-flash-latest : filet si 2.0 est retiré par Google. Modèle 3.x à
//   réflexion obligatoire => on la met au minimum (thinkingLevel low) ET on gonfle
//   maxOutputTokens (8000) pour que la réflexion ne tronque JAMAIS la réponse.
const GEMINI_MODELS = [
  { model: 'gemini-2.0-flash', thinking: false, maxOutputTokens: 4096 },
  { model: 'gemini-flash-latest', thinking: true, maxOutputTokens: 8000 },
];
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const GROQ_MAX_TOKENS = 2048; // (2) borne la longueur (assez pour un rendu structuré)

const TELEGRAM_MAX_CHARS = 4096; // (2) limite dure d'un message Telegram

const BOOKS_CACHE_TTL = 300;      // (4) cache du books.json au bord Cloudflare (s)
const RESPONSE_CACHE_TTL = 21600; // (5) cache des réponses IA en KV (6 h)

// (6) Rate-limit : limite/fenêtre définies dans wrangler.toml ([ratelimits.simple]).

// Pondération de la recherche locale (7) : un match dans le titre vaut plus
// qu'un match dans le nom d'un éditeur.
const SEARCH_WEIGHTS = { title: 5, author: 3, category: 2, editions: 1 };
const MAX_RESULTS = 30; // plafond de livres envoyés à l'IA (entrée quasi gratuite sur Gemini)

// Le message d'accueil interpole MAX_RESULTS : si on change la limite,
// le texte se met à jour automatiquement.
const WELCOME_MESSAGE = `السلام عليكم ورحمة الله وبركاته 👋

أنا خبيرك في طبعات الكتب الإسلامية 📚
اسألني عن كتاب أو مؤلف أو علم لتعرف أفضل الطبعات.

مثال:
• ما هي أفضل طبعة لصحيح البخاري ؟
• أفضل طبعة لكتاب فتح الباري
• كتب ابن رجب
• كتب العقيدة
• كتب ابن القيم في الفقه

ℹ️ ملاحظات مهمة:
• كل رسالة تُعالَج على حدة، والبوت لا يتذكر الرسائل السابقة، وذلك بسبب حدود الاستخدام المجاني لأداة الذكاء الاصطناعي.
• لنفس السبب، يقتصر كل بحث على أقرب ${MAX_RESULTS} كتابًا لسؤالك.`;

// Messages génériques destinés à l'utilisateur (3) — jamais de détail technique.
const ERROR_MESSAGE = 'عذراً، حدث خطأ مؤقت. حاول مرة أخرى بعد قليل ⏳';
const RATE_LIMIT_MESSAGE = 'لقد أرسلت رسائل كثيرة بسرعة. انتظر دقيقة من فضلك ⏳';
const NOT_FOUND_MESSAGE = 'لم أجد هذا الكتاب في قاعدة بياناتي. جرّب صياغة أخرى أو تأكّد من الاسم';

// En-têtes CORS : autorisent le widget de chat de l'app web à appeler POST /chat.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// =============================================================================
// Entrée du Worker
// =============================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight (widget de chat web)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Endpoint du widget de chat web (app arabic-app.github.io)
    if (request.method === 'POST' && url.pathname === '/chat') {
      return handleWebChat(request, env);
    }

    // Analytics maison : collecte (public) + lecture (protégée par STATS_KEY)
    if (request.method === 'POST' && url.pathname === '/track') {
      return handleTrack(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/stats') {
      return handleStats(request, env, ctx);
    }

    // Endpoint d'administration one-shot : enregistre le menu de commandes (15)
    if (request.method === 'GET') {
      if (url.pathname === '/setup') {
        return handleSetup(url, env);
      }
      return new Response('Bot is running', { status: 200 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // (1) Sécurité : on vérifie le secret partagé avec Telegram (setWebhook).
    // Tant que WEBHOOK_SECRET n'est pas configuré, on n'impose rien (compat.).
    if (env.WEBHOOK_SECRET) {
      const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (provided !== env.WEBHOOK_SECRET) {
        console.warn('Rejected webhook: bad or missing secret token');
        return new Response('Forbidden', { status: 403 });
      }
    }

    try {
      const update = await request.json();

      if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const userText = update.message.text.trim();

        // Commandes instantanées (aucun appel IA) => réponse immédiate
        if (userText === '/start' || userText === '/help') {
          ctx.waitUntil(sendTelegramMessage(chatId, WELCOME_MESSAGE, env.TELEGRAM_BOT_TOKEN));
          return new Response('OK', { status: 200 });
        }

        ctx.waitUntil(handleMessage(chatId, userText, env));
      }

      // Toujours répondre 200 OK immédiatement pour éviter les retrys Telegram
      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error('Webhook error:', err);
      return new Response('Error', { status: 500 });
    }
  },
};

// =============================================================================
// Orchestration d'un message
// =============================================================================
async function handleMessage(chatId, userText, env) {
  try {
    // (6) Rate-limit par utilisateur (actif seulement si KV branché)
    if (await isRateLimited(chatId, env)) {
      await sendTelegramMessage(chatId, RATE_LIMIT_MESSAGE, env.TELEGRAM_BOT_TOKEN);
      return;
    }

    // (8) Indicateur « en train d'écrire… » pendant que l'IA réfléchit
    await sendChatAction(chatId, 'typing', env.TELEGRAM_BOT_TOKEN);

    // (5) Cache des réponses : la clé est la SIGNATURE DE RECHERCHE (tokens triés),
    // pas le texte brut. Ainsi deux formulations équivalentes (« بن رجب » et
    // « ابن رجب ») partagent la même entrée => réponse identique + quota économisée.
    // Repli sur le texte normalisé si aucun token distinctif.
    const tokens = searchTokens(userText);
    const cacheKey = 'resp:' + (tokens.length ? [...tokens].sort().join(' ') : normalizeArabic(userText));
    let answer = env.CACHE ? await env.CACHE.get(cacheKey) : null;

    if (!answer) {
      answer = await askAI(userText, env);
      if (env.CACHE && answer && answer.includes('📚')) {
        await env.CACHE.put(cacheKey, answer, { expirationTtl: RESPONSE_CACHE_TTL });
      }
    }

    await sendTelegramMessage(chatId, answer, env.TELEGRAM_BOT_TOKEN);
  } catch (error) {
    console.error('Error handling message:', error); // (3) détail dans les logs
    await sendTelegramMessage(chatId, ERROR_MESSAGE, env.TELEGRAM_BOT_TOKEN);
  }
}

// =============================================================================
// Endpoint du widget de chat web (POST /chat) — réutilise le pipeline Telegram
// =============================================================================
async function handleWebChat(request, env) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = (body.message || '').trim();
    if (!message) return jsonResponse({ answer: 'اكتب سؤالك من فضلك 🙏' }, 400);

    const text = message.slice(0, 500); // borne la taille de la question

    // Anti-abus : rate-limit par IP (réutilise le compteur KV)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await isRateLimited('web:' + ip, env)) {
      return jsonResponse({ answer: RATE_LIMIT_MESSAGE }, 429);
    }

    // Cache par signature de recherche (partagé avec le flux Telegram)
    const tokens = searchTokens(text);
    const cacheKey = 'resp:' + (tokens.length ? [...tokens].sort().join(' ') : normalizeArabic(text));
    let answer = env.CACHE ? await env.CACHE.get(cacheKey) : null;
    if (!answer) {
      answer = await askAI(text, env);
      if (env.CACHE && answer && answer.includes('📚')) {
        await env.CACHE.put(cacheKey, answer, { expirationTtl: RESPONSE_CACHE_TTL });
      }
    }
    await bumpStat(env, (s) => { s.c = (s.c || 0) + 1; }); // compteur d'usage du chat web
    return jsonResponse({ answer });
  } catch (err) {
    console.error('Web chat error:', err);
    return jsonResponse({ answer: ERROR_MESSAGE }, 500);
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// =============================================================================
// Analytics maison (auto-hébergé sur KV) — remplace la GitHub Traffic API.
//
// Deux catégories de clés, pour borner le coût KV indéfiniment dans le temps :
// - st:d:YYYY-MM-DD = {v, u} (vues, visiteurs uniques du jour) — TTL 35 j, une
//   seule sert au graphe 30 jours ; jamais listée (dates connues à l'avance).
// - st:d:YYYY-MM-DD = {v, u, c, s:{recherche:count}} — UNE SEULE écriture par
//   événement (une clé "agrégat" séparée avait doublé les écritures et épuisé
//   le plafond gratuit de 1000 put/jour — voir historique). TTL 35 j : largement
//   suffisant puisque /stats ne lit jamais plus que les 30 derniers jours,
//   par dates connues à l'avance (jamais de list()) => coût de lecture borné
//   et constant quel que soit l'âge du site.
// =============================================================================
function todayKey() { return 'st:d:' + new Date().toISOString().slice(0, 10); }

function topEntries(map, n) {
  const out = {};
  Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, n).forEach(([k, v]) => { out[k] = v; });
  return out;
}

// 1 lecture + 1 écriture, sur l'unique clé du jour.
async function bumpStat(env, mutate) {
  if (!env.CACHE) return;
  const key = todayKey();
  const cur = (await env.CACHE.get(key, { type: 'json' })) || { v: 0, u: 0, c: 0, s: {} };
  mutate(cur);
  cur.s = topEntries(cur.s, 60);
  await env.CACHE.put(key, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 35 });
}

// POST /track  { event: 'pageview'|'search'|'chat', q?, newVisitor? }
async function handleTrack(request, env) {
  try {
    const b = await request.json().catch(() => ({}));
    const event = String(b.event || 'pageview');
    await bumpStat(env, (s) => {
      if (event === 'pageview') {
        s.v = (s.v || 0) + 1;
        if (b.newVisitor) s.u = (s.u || 0) + 1;
      } else if (event === 'search') {
        const q = String(b.q || '').trim().slice(0, 80);
        if (q) s.s[q] = (s.s[q] || 0) + 1;
      } else if (event === 'chat') {
        s.c = (s.c || 0) + 1;
      }
    });
    return jsonResponse({ ok: true });
  } catch (e) {
    console.error('track error:', e.message);
    return jsonResponse({ ok: false }, 200);
  }
}

// GET /stats?key=STATS_KEY -> agrégat pour l'admin.
// Coût borné et CONSTANT dans le temps : exactement 30 lectures (dates des 30
// derniers jours, connues à l'avance), quel que soit l'âge du site. Plus de list().
// totalViews/Visitors/Chat = somme sur ces 30 jours (le TTL de 35 j ne
// conservait de toute façon jamais un vrai historique infini).
async function handleStats(request, env, ctx) {
  if (!env.CACHE) return jsonResponse({ error: 'kv_disabled' }, 200);
  const url = new URL(request.url);
  // STATS_KEY est OPTIONNEL : si elle est définie, on l'exige ; sinon /stats est ouvert.
  if (env.STATS_KEY && url.searchParams.get('key') !== env.STATS_KEY) {
    return jsonResponse({ error: 'unauthorized' }, 403);
  }

  // Cache d'edge Cloudflare (gratuit, HORS quota KV) : /stats est un endpoint
  // public sans clé, donc n'importe quel bot/scanner peut le taper en boucle.
  // Ce cache plafonne le coût réel à 1 calcul (30 lectures KV) par minute,
  // quel que soit le nombre d'appels reçus.
  const cache = caches.default;
  const cacheKey = new Request('https://stats-cache.internal/stats');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const now = Date.now();
  const dates = [];
  for (let i = 29; i >= 0; i--) dates.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  const days = await Promise.all(dates.map(d => env.CACHE.get('st:d:' + d, { type: 'json' })));
  const chart = dates.map((date, i) => ({ date, views: (days[i] && days[i].v) || 0 }));

  let totalViews = 0, totalVisitors = 0, totalChat = 0;
  const searches = {};
  days.forEach(d => {
    if (!d) return;
    totalViews += d.v || 0; totalVisitors += d.u || 0; totalChat += d.c || 0;
    Object.entries(d.s || {}).forEach(([q, c]) => { searches[q] = (searches[q] || 0) + c; });
  });

  const today = days[days.length - 1] || {};
  const sortTop = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));

  const payload = JSON.stringify({
    totalViews, totalVisitors, totalChat,
    todayViews: today.v || 0, todayVisitors: today.u || 0,
    chart,
    topSearches: sortTop(searches, 15),
  });
  const baseHeaders = { 'Content-Type': 'application/json', ...CORS_HEADERS };
  const response = new Response(payload, { status: 200, headers: baseHeaders });
  const cacheResponse = new Response(payload, {
    status: 200,
    headers: { ...baseHeaders, 'Cache-Control': 'public, max-age=60' },
  });
  ctx.waitUntil(cache.put(cacheKey, cacheResponse));
  return response;
}

// =============================================================================
// Rate-limit (6) — binding Rate Limiting natif Cloudflare (voir wrangler.toml),
// HORS quota KV. Écrire l'anti-abus sur KV (1 put/message) épuisait le plafond
// gratuit de 1000 put/jour ; ce binding est un produit séparé, sans ce coût.
// =============================================================================
async function isRateLimited(key, env) {
  if (!env.CHAT_RATE_LIMITER) return false; // binding absent (ex. dev local) => pas de limite
  const { success } = await env.CHAT_RATE_LIMITER.limit({ key });
  return !success;
}

// =============================================================================
// Normalisation arabe — identique à la recherche de l'app web (index.html)
// =============================================================================
function normalizeArabic(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')  // variantes de alef -> ا
    .replace(/ى/g, 'ي')      // alef maqsura -> ya (المصطفى ~ المصطفي)
    .replace(/ؤ/g, 'و')      // hamza sur waw -> waw (الأرناؤوط ~ الارناووط)
    .replace(/ئ/g, 'ي')      // hamza sur ya -> ya
    .replace(/ء/g, '')       // hamza isolée retirée
    .replace(/ة/g, 'ه')      // ta marbuta -> ha
    .replace(/[ً-ْ]/g, '')   // retire les diacritiques (harakat)
    .trim();
}

// Retire l'article défini « ال » en tête de mot (البخاري -> بخاري) pour tolérer
// sa présence/absence. Appliqué côté requête uniquement : « بخاري » reste une
// sous-chaîne de « البخاري » dans les données, donc la correspondance marche dans
// les deux sens. Garde-fou de longueur pour ne pas casser les mots courts.
function stripDefiniteArticle(word) {
  return word.startsWith('ال') && word.length >= 5 ? word.slice(2) : word;
}

// 'ابن' et 'بن' sont des connecteurs de noms (Ibn / bin), pas des mots
// distinctifs : on les ignore pour que « ابن رجب » matche « ... بن رجب ... »
// et pour éviter le bruit (sinon tout « ابن X » remonte).
const STOP_WORDS = ['أفضل', 'طبعات', 'طبعة', 'كتب', 'كتاب', 'ما', 'هي', 'من', 'في', 'عن', 'دار', 'مكتبة', 'هل', 'اريد', 'أريد', 'أبحث', 'للكتاب', 'الفلاني', 'ماهي', 'ابن', 'بن'].map(normalizeArabic);

// Transforme une requête en tokens de recherche (normalisation + retrait des mots
// vides + retrait de « ال »). Utilisé à la fois pour la recherche ET pour la clé
// de cache, afin que deux formulations équivalentes (« بن رجب » / « ابن رجب »)
// donnent exactement le même résultat.
function searchTokens(query) {
  return normalizeArabic(query)
    .split(/\s+/)
    .filter(w => !STOP_WORDS.includes(w) && w.length > 2)
    .map(stripDefiniteArticle);
}

// =============================================================================
// Recherche locale (RAG) : récupération + filtrage + compression
// =============================================================================
async function selectRelevantBooks(query) {
  // (4) Cache au bord Cloudflare : books.json n'est pas re-téléchargé à chaque message.
  const response = await fetch(BOOKS_URL, {
    cf: { cacheTtl: BOOKS_CACHE_TTL, cacheEverything: true },
  });
  if (!response.ok) throw new Error('Failed to fetch books.json from GitHub');
  const allBooks = await response.json();

  const words = searchTokens(query);
  if (words.length === 0) return allBooks.slice(0, MAX_RESULTS);

  const scored = allBooks
    .map(book => ({ book, ...analyzeBook(book, words) }))
    .filter(s => s.coverage > 0);
  if (!scored.length) return [];

  // On ne garde que les livres couvrant le PLUS de mots de la requête, puis on
  // départage par score (« صحيح البخاري » -> le vrai البخاري ; « رجب » -> tous ses livres).
  const maxCoverage = Math.max(...scored.map(s => s.coverage));
  return scored
    .filter(s => s.coverage === maxCoverage)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(s => s.book);
}

// (7) Champs de recherche ciblés + normalisés (au lieu de tout le JSON brut).
function bookSearchFields(book) {
  const editions = [...(book.best_editions || []), ...(book.alt_editions || [])];
  const publishers = editions.map(e => e.publisher).filter(Boolean).join(' ');
  const verifiers = editions.map(e => e.verifier).filter(Boolean).join(' ');
  const cats = Array.isArray(book.category) ? book.category.join(' ') : (book.category || '');
  return {
    title: normalizeArabic(book.title),
    author: normalizeArabic(book.author),
    category: normalizeArabic(cats),
    editions: normalizeArabic(publishers + ' ' + verifiers),
  };
}

// (7) Analyse d'un livre pour une requête : couverture (nb de mots distincts
// trouvés) + score pondéré (titre > auteur > catégorie > éditeurs). La couverture
// prime au filtrage ; le score départage à couverture égale.
function analyzeBook(book, words) {
  const fields = bookSearchFields(book);
  let coverage = 0;
  let score = 0;
  for (const word of words) {
    let matched = false;
    for (const [field, weight] of Object.entries(SEARCH_WEIGHTS)) {
      if (fields[field].includes(word)) {
        score += weight;
        matched = true;
      }
    }
    if (matched) coverage += 1;
  }
  return { coverage, score };
}

// Étiquette d'une édition : « éditeur - ت محقق ».
function edLabel(ed) {
  const v = (ed.verifier || '').trim();
  return ed.publisher + (v ? ' - ت ' + v : '');
}

// Réponse finale rendue de façon DÉTERMINISTE depuis les vraies données
// (aucune reformulation par l'IA => pas de découpage, pas d'invention, pas de « لا توجد »).
function formatAnswer(books) {
  return books.map(b => {
    let out = '📚 ' + b.title + '.';
    const best = (b.best_editions || []).filter(e => e.publisher);
    const alt = (b.alt_editions || []).filter(e => e.publisher);
    if (best.length) { out += '\nط.معتمدة:'; best.forEach(e => { out += '\n▫️ ' + edLabel(e); }); }
    if (alt.length) { out += '\nط.بديلة:'; alt.forEach(e => { out += '\n▪️ ' + edLabel(e); }); }
    return out;
  }).join('\n\n');
}

// Liste numérotée légère envoyée à l'IA pour la SÉLECTION (sans éditions => compact + sans ambiguïté).
function booksForSelection(books) {
  return books.map(b => {
    const cats = Array.isArray(b.category) ? b.category.join('، ') : (b.category || '');
    return b.id + '. ' + b.title + ' — ' + b.author + (cats ? ' (' + cats + ')' : '');
  }).join('\n');
}

// =============================================================================
// Appel IA : Gemini (principal) -> Groq (secours)
// =============================================================================
async function askAI(question, env) {
  const candidates = await selectRelevantBooks(question);
  if (!candidates.length) return NOT_FOUND_MESSAGE;

  const selectionPrompt = `أنت مساعد يختار الكتب المناسبة لسؤال المستخدم من قائمة مرقّمة.
القائمة (رقم. العنوان — المؤلف (التصنيفات)):
${booksForSelection(candidates)}

أعِد فقط مصفوفة JSON بأرقام الكتب المناسبة لسؤال المستخدم، مرتّبة من الأنسب إلى الأقل، دون أي نص آخر.
- إذا سأل عن كتاب معيّن، أعِد رقم ذلك الكتاب فقط (أو الأقرب).
- إذا سأل عن مؤلف أو علم أو موضوع (مثل «كتب العقيدة» أو «كتب ابن رجب»)، أعِد أرقام كل الكتب المطابقة في القائمة.
- إذا لم يوجد أي كتاب مناسب، أعِد [].
مثال للإخراج: [12, 5, 33]`;

  let ids = null;
  try {
    const raw = await runAI(selectionPrompt, question, env);
    const m = raw.match(/\[[\d\s,]*\]/);
    if (m) ids = JSON.parse(m[0]);
  } catch (err) {
    console.error('AI selection failed:', err.message);
    return formatAnswer(candidates); // repli : on rend les résultats du RAG
  }

  if (!Array.isArray(ids)) return formatAnswer(candidates);
  const byId = new Map(candidates.map(b => [b.id, b]));
  const chosen = ids.map(id => byId.get(id)).filter(Boolean).slice(0, MAX_RESULTS);
  if (!chosen.length) return NOT_FOUND_MESSAGE;
  return formatAnswer(chosen);
}

// Cascade de fournisseurs : Gemini d'abord, puis Groq en secours. Renvoie le texte brut.
async function runAI(systemPrompt, userText, env) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ];
  const errors = [];
  if (env.GEMINI_API_KEY) {
    for (const cfg of GEMINI_MODELS) {
      try {
        return await callGemini(cfg, systemPrompt, userText, env.GEMINI_API_KEY);
      } catch (err) {
        errors.push('Gemini(' + cfg.model + '): ' + err.message);
        console.error('Gemini "' + cfg.model + '" failed:', err.message);
      }
    }
  }
  if (env.GROQ_API_KEY) {
    for (const model of GROQ_MODELS) {
      try {
        return await callGroqModel(model, messages, env.GROQ_API_KEY);
      } catch (err) {
        errors.push('Groq(' + model + '): ' + err.message);
        console.error('Groq model "' + model + '" failed:', err.message);
      }
    }
  }
  throw new Error('Tous les fournisseurs IA ont échoué : ' + errors.join(' | '));
}

// Appel Gemini (generativelanguage API). La config par modèle décide de la
// réflexion et du budget de sortie (voir GEMINI_MODELS).
async function callGemini(cfg, systemPrompt, question, apiKey) {
  const generationConfig = {
    temperature: 0,
    maxOutputTokens: cfg.maxOutputTokens,
  };
  // Modèles 3.x : réflexion obligatoire => on la met au minimum pour rester rapide.
  if (cfg.thinking) {
    generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: question }] }],
      generationConfig,
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API Error (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim();
  if (!text) throw new Error(`Empty Gemini response (finish: ${candidate?.finishReason || 'none'})`);
  return text;
}

async function callGroqModel(model, messages, apiKey) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0, // réponses stables et déterministes (bot factuel)
      max_tokens: GROQ_MAX_TOKENS, // (2)
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty Groq response'); // (12) garde-fou
  return content;
}

// =============================================================================
// Telegram
// =============================================================================
async function sendTelegramMessage(chatId, text, botToken) {
  // (2) Telegram plafonne à 4096 caractères => on découpe si nécessaire.
  for (const chunk of splitText(text, TELEGRAM_MAX_CHARS)) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
    if (!response.ok) {
      console.error('Telegram API Error:', await response.text());
    }
  }
}

// (8) Affiche « … en train d'écrire ». Non bloquant : on ignore les erreurs.
async function sendChatAction(chatId, action, botToken) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (err) {
    console.error('sendChatAction failed:', err.message);
  }
}

// Découpe un texte long en morceaux <= max, en coupant de préférence sur un
// saut de ligne pour ne pas casser une phrase au milieu.
function splitText(text, max) {
  if (!text) return [ERROR_MESSAGE];
  if (text.length <= max) return [text];

  const chunks = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max; // pas de saut de ligne exploitable
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// =============================================================================
// Setup one-shot : enregistre le menu de commandes Telegram (15)
// GET /setup?secret=<WEBHOOK_SECRET>
// =============================================================================
async function handleSetup(url, env) {
  if (env.WEBHOOK_SECRET && url.searchParams.get('secret') !== env.WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  const commands = [
    { command: 'start', description: 'بدء المحادثة والتعريف بالبوت' },
    { command: 'help', description: 'كيفية استخدام البوت' },
  ];

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    }
  );

  return new Response(await response.text(), { status: response.status });
}
