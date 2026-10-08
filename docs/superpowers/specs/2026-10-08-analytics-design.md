# Statistiques fiables — point 7

Direction approuvée puis implémentation explicitement demandée dans la conversation le 8 octobre 2026. Travail local dans la branche audit existante; conserver les correctifs précédents non commités. Aucun déploiement ni nouvelle ressource distante.

## Contrat

Un Durable Object `StatsAggregator`, binding `ANALYTICS`, instance `tabaat-stats-v1`, centralise les événements `pageview`, `search` et `chat`. Son stockage SQLite effectue les incréments atomiques dans une transaction synchrone. Les compteurs quotidiens et recherches sont conservés 35 jours; `/stats` agrège les 30 derniers jours UTC. Les totaux visiteurs sont une somme de visiteurs quotidiens déclarés par les navigateurs, pas des personnes distinctes sur 30 jours.

La réponse `/chat` n'attend pas les statistiques. `ctx.waitUntil` porte une tâche dont les erreurs sont capturées; une panne du compteur ne modifie pas la réponse du chat. `/track` confirme uniquement un événement réellement enregistré; une panne retourne une indisponibilité, sans prétendre avoir compté. Un binding absent n'utilise pas à nouveau les compteurs KV concurrents.

L'initialisation lit les 35 agrégats KV encore disponibles avant toute collecte, puis importe les valeurs et inscrit un marqueur dans une seule transaction SQLite. Le marqueur persiste entre redémarrages; aucune suppression des données KV. Une erreur de lecture/import empêche les nouvelles écritures analytics et reste réessayable, mais le chat continue. Une bascule de déploiement sans anciennes instances qui collectent encore est nécessaire pour éviter de manquer leurs derniers événements; les pertes anciennes ne sont pas reconstructibles.

Le format public existant (`totalViews`, `totalVisitors`, `totalChat`, `todayViews`, `todayVisitors`, `chart`, `topSearches`) est conservé, avec période UTC et date de génération explicites. Le cache de lecture garde sa durée de 60 secondes, utilise une nouvelle clé et reste secondaire : son indisponibilité ne bloque pas la lecture SQLite. L'authentification de `/stats` existante reste inchangée; le durcissement des accès et de `/track` appartient au point 8.

L'administration affiche les vues et questions sur 30 jours, le totalVisitors reçu et la possibilité de compter la même personne plusieurs jours. Elle ne revendique plus une actualisation instantanée.

## Architecture et validation

`telegram-bot/src/analytics.js` porte le Durable Object et ses fonctions de collecte/lecture. `src/index.js` réexporte la classe et raccorde les routes. `wrangler.toml` déclare le binding et la création SQLite compatible avec la version de Wrangler installée. Tests avec Miniflare/SQLite réel, puis compilation locale Wrangler sans publication. Documentation de la bascule et de ses limites.

Sources : [SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [configuration et création](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [ctx.waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/).
