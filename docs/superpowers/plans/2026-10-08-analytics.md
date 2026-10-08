# Statistiques fiables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compter sans incréments perdus et protéger la réponse du chat des erreurs analytics.
**Architecture:** Durable Object SQLite unique; import KV une seule fois; cache de lecture secondaire; collecte chat dans waitUntil.
**Tech Stack:** JavaScript modules, Cloudflare Workers/Durable Objects, SQLite, Miniflare, Node test runner, jsdom.
**Spec:** docs/superpowers/specs/2026-10-08-analytics-design.md

## Global Constraints

- Travail local, branche audit existante; préserver les changements précédents. Aucun déploiement, commit global ni modification des secrets.
- Fenêtre de restitution 30 jours UTC, rétention 35 jours, cache de lecture 60 secondes.
- Format public existant conservé. Identité Durable Object `tabaat-stats-v1`, binding `ANALYTICS`, classe `StatsAggregator`.

## Review Focus

- Migration rejouée après redémarrage : jamais deux fois les valeurs KV.
- Lecture KV échouée au démarrage : aucune collecte qui masque l'historique; chat indépendant.
- Requêtes simultanées et recherche `__proto__` : additions exactes, clés comme données SQL.
- Cache de lecture indisponible : stats SQLite accessibles.
- Historique expiré et fenêtre UTC : anciennes dates exclues et rétention limitée.

### Task 1: Compteur durable et routes

**Files:** créer src/analytics.js dans telegram-bot; modifier src/index.js, wrangler.toml et les dépendances de tests; tests/analytics.test.cjs.
**Interfaces:** `recordAnalytics(env, event)` confirme l'écriture; `readAnalytics(env)` renvoie le payload; `scheduleAnalytics(ctx, env, event)` capture les erreurs et ne bloque pas; `StatsAggregator.fetch(request)` est le service interne.

- [ ] Écrire les tests du Worker réel : 50 pageviews simultanées, panne compteur avec réponse chat cachée, compteurs indépendants de KV, import historique une seule fois, panne de migration réessayable, fenêtre 30/35 jours et cache de lecture non essentiel.
- [ ] Exécuter `node --test tests/analytics.test.cjs` et observer les échecs attendus.
- [ ] Implémenter les interfaces et transactions SQLite, réexporter la classe, raccorder les routes et déclaration Wrangler; supprimer bumpStat KV.
- [ ] Vérifier la suite ciblée et la suite complète, puis compilation Wrangler en dry-run. Aucun commit automatique dans le checkout partagé.

### Task 2: Restitution admin et documentation

**Files:** admin/index.html, tests/admin-stats.test.cjs, tests/syntax.test.cjs, telegram-bot/README.md, docs/AUDIT-2026-10-07.md.
**Interfaces:** `renderStats(data)` conserve les champs publics du Task 1, lit totalVisitors et affiche leur portée réelle.

- [ ] Écrire un test admin où totalViews=100, somme chart=80 et totalVisitors=17; le compteur visiteurs doit afficher17 et les libellés préciser30jours. Exécuter rouge.
- [ ] Corriger branchement et libellés; supprimer promesse de temps réel, documenter UTC/cache60s, migration et déploiement séparé.
- [ ] Exécuter `npm test`, vérifier configuration/build local et revue indépendante du périmètre point7.

## Validation locale du 8 octobre 2026

Implémentation et restitution terminées dans le checkout `audit`, changements
antérieurs conservés, sans commit ni déploiement. Suite complète : 73 tests
réussis, zéro échec. Compilation Wrangler `deploy --dry-run` réussie avec le
binding `ANALYTICS`; `git diff --check` sans erreur.

Les régressions visiteurs (80 vues au lieu de 17 visiteurs), cache d'écriture
synchrone (503 au lieu de 200) et date du graphique en fuseau américain
(7 octobre au lieu de 8 octobre UTC) ont été reproduites puis corrigées.
Les tests Miniflare de redémarrage et rétention utilisent désormais le nom du
Worker et l'inspection SQLite correctement; le wrapper RPC est réservé aux
tests. Le contrôle de syntaxe vérifie les deux vrais modules ES avec Node.

Revue indépendante terminée : aucun problème bloquant. Limites mineures de
couverture différées : exception de lecture KV pendant l'import, échec de
lecture du cache edge, et assertion de conservation à J−34 (suppression à
J−35 couverte). Le déploiement et les contrôles en production restent séparés.

## Suivi demandé et autorisé : déploiement du 8 octobre 2026

Les trois limites de couverture sont résolues et les mutants correspondants
sont détectés. Suite locale 75/75, copie de publication point 7 seule 40/40.
L'utilisateur a autorisé le déploiement, puis explicitement la pause d'environ
deux minutes nécessaire à la stabilisation KV et le plan de rollback.
Worker SQLite d6196480-061b-414c-97eb-5bb68fe6cd07 déployé; import confirmé
avec totaux historiques conservés. Admin GitHub Pages vérifié en ligne après
publication de cf324f3 sur main. Les autres correctifs locaux restent conservés
sur audit et ne font pas partie de cette publication sélective.
