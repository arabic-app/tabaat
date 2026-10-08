# Bot Telegram « Expert en Éditions »

Bot Telegram (Cloudflare Workers) qui recommande les meilleures éditions de
livres islamiques/arabes à partir de `books.json`, via un RAG local + Groq.

## Architecture

1. Telegram envoie le message au Worker (`POST /webhook`).
2. Le Worker télécharge `books.json` (mis en cache 5 min au bord Cloudflare).
3. Recherche locale pondérée (titre > auteur > catégorie > éditeurs) après
   normalisation arabe (identique à la recherche de l'app web).
4. Les 30 meilleurs livres (best + alt editions) sont envoyés à Groq.
5. Réponse renvoyée à l'utilisateur (et mise en cache 6 h si KV activé).

## Secrets (obligatoires)

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN   # jeton BotFather
npx wrangler secret put GEMINI_API_KEY       # aistudio.google.com/apikey (principal)
npx wrangler secret put GROQ_API_KEY         # console.groq.com/keys (secours)
npx wrangler secret put WEBHOOK_SECRET       # chaîne aléatoire (anti-abus)
```

`WEBHOOK_SECRET` : une chaîne secrète que tu choisis (ex. sortie de
`openssl rand -hex 16`). Tant qu'elle n'est pas définie, le Worker accepte
tous les POST (rétro-compatible) ; une fois définie, seuls les webhooks signés
par Telegram passent.

## KV (cache réponses + rate-limit) — optionnel mais recommandé

```bash
npx wrangler kv namespace create CACHE
```

Colle l'`id` renvoyé dans `wrangler.toml` (bloc `[[kv_namespaces]]`), décommente
le bloc, puis redéploie. Sans KV, le bot fonctionne normalement (cache et
rate-limit simplement inactifs).

## Déploiement

```bash
npm run deploy
```

## Enregistrer le webhook (avec secret) et le menu de commandes

```bash
# Webhook + secret (remplace <TOKEN>, <URL_WORKER>, <SECRET>)
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_WORKER>/webhook&secret_token=<SECRET>"

# Menu de commandes /start /help (une seule fois)
curl "<URL_WORKER>/setup?secret=<SECRET>"
```

## Modèles IA (cascade)

1. **Gemini `gemini-2.0-flash`** (principal) — sans réflexion => rapide, pas de
   troncature. Gros quota gratuit (~1500 req/jour, 1M tokens/min).
2. **Gemini `gemini-flash-latest`** — filet si Google retire le 2.0. Modèle 3.x à
   réflexion obligatoire : mise au minimum (`thinkingLevel: low`) + `maxOutputTokens`
   gonflé à 8000 pour que la réflexion ne tronque pas la réponse.
3. **Groq** `llama-3.3-70b-versatile` puis `llama-3.1-8b-instant`.

Réglages dans `GEMINI_MODELS` / `GROQ_MODELS` (`src/index.js`). Si `GEMINI_API_KEY`
est absent, le bot passe directement à Groq.

Si `GEMINI_API_KEY` n'est pas défini, le bot utilise directement Groq.
Réglages dans `GEMINI_MODEL` / `GROQ_MODELS` (`src/index.js`).

## Statistiques (audit, point 7)

`/track` enregistre les événements `pageview`, `search` et `chat` dans le
Durable Object SQLite `StatsAggregator`, binding `ANALYTICS`, instance
`tabaat-stats-v1`. Les incréments sont atomiques. Les données quotidiennes
sont conservées 35 jours, et `/stats?key=STATS_KEY` restitue les 30 derniers
jours UTC, aujourd'hui inclus. `totalVisitors` additionne les visiteurs
quotidiens déclarés par le navigateur : une personne présente plusieurs jours
peut être comptée plusieurs fois. Il ne mesure pas les personnes distinctes
sur toute la période.

`/chat` programme sa collecte avec `ctx.waitUntil` et absorbe les erreurs du
compteur, sans attendre son résultat. `/track` renvoie 503 si l'événement ne
peut pas être enregistré. Sans binding `ANALYTICS`, les statistiques sont
indisponibles; aucun retour aux incréments KV concurrents. Le cache de lecture
`/stats` dure 60 secondes et ses erreurs ne bloquent pas la lecture SQLite.
Le contrôle d'accès existant est inchangé : configurer `STATS_KEY`; le refus
obligatoire en absence de secret et l'anti-abus de `/track` restent au point 8.

### Migration et mise en production

La première lecture ou collecte importe les 35 agrégats KV `st:d:YYYY-MM-DD`
encore présents. Les valeurs et le marqueur d'import sont enregistrés dans une
seule transaction. Un redémarrage ne relance pas l'import. Une lecture ou une
validation échouée bloque l'import et les nouvelles collectes jusqu'à une
nouvelle tentative réussie. Les données KV ne sont pas supprimées.

La configuration Wrangler déclare le binding et le stockage SQLite via
`[exports.StatsAggregator]`. Le déploiement reste une opération séparée :

1. Vérifier `npm test` à la racine puis `npx wrangler deploy --dry-run` ici.
2. Prévoir une fenêtre sans collecte par les anciennes instances avant le
   premier import. Vérifier qu'elles ont terminé leurs écritures, puis que
   les dernières valeurs KV sont visibles; ne pas activer les deux collecteurs
   en parallèle. L'import ne rattrape pas les écritures KV arrivées ensuite.
3. Après déploiement autorisé, contrôler le binding et les réponses `/track`,
   `/stats` (avec clé) et `/chat`, ainsi que les journaux d'import.

Les pertes historiques dues aux anciens incréments concurrents ne sont pas
reconstructibles. Un retour à l'ancien Worker réactiverait ces compteurs KV
et ne lirait pas les événements ajoutés dans SQLite.

Tests locaux : `tests/analytics.test.cjs` (SQLite réel via Miniflare),
`tests/admin-stats.test.cjs` et `tests/syntax.test.cjs`. Aucun déploiement
n'est effectué par ces tests.
