# Protection des contenus Tabaat

Correctif du point 1 de l’audit du 7 octobre 2026, selon la conception approuvée dans le chat.

## Comportement

- `js/content-security.js` fournit l’échappement du texte et des attributs, une politique URL HTTP/HTTPS, la détection PDF par chemin et l’assainissement du HTML riche.
- DOMPurify 3.4.16 est servi localement, avec version, licence et intégrité de téléchargement consignées dans `vendor/README.md`.
- Les titres, auteurs, catégories et éditeurs sont échappés; leurs actions utilisent des attributs de données et des événements délégués. Les apostrophes et les guillemets n’entrent plus dans du JavaScript généré.
- Notes et corrections sont assainies avant affichage, avant insertion dans un éditeur et avant sauvegarde. Collage et glisser-déposer dans les éditeurs suivent la même politique. Les noms et messages de la page des avis sont protégés également, car cette page partage l’origine du site et de l’admin.
- Les balises de mise en forme textuelle usuelles, listes, liens et direction de texte sont conservées. Styles arbitraires, classes, identifiants, scripts, images et contenus embarqués sont retirés du HTML riche. Les couvertures et pièces jointes restent gérées par leurs champs dédiés.
- Les URL relatives se résolvent contre la racine du catalogue, y compris depuis `/admin/`. Les protocoles exécutables, URL avec identifiants et délimiteurs dangereux sont refusés. Une URL invalide bloque l’enregistrement du formulaire plutôt que d’être publiée.
- Sans DOMPurify, le HTML riche est affiché comme texte échappé. Aucune dépendance CDN n’est nécessaire à cette protection.

## PDF

Chrome bloque les PDF natifs dans un iframe sandboxé. Le lecteur télécharge donc le fichier, vérifie la signature `%PDF-`, puis affiche une URL temporaire dont le type est forcé à `application/pdf`. Une réponse HTML sous un nom `.pdf` n’est jamais directement embarquée.

Le chargement est annulable, expire après 20 secondes et ne peut pas rouvrir une modale fermée. L’URL temporaire est libérée à la fermeture ou lors du passage à une image. En cas de blocage CORS d’un hébergeur externe, un lien explicite avec `noopener noreferrer` permet d’ouvrir le fichier séparément; un fichier identifié comme non-PDF ne reçoit pas ce repli.

Cela ajoute un téléchargement préalable au premier affichage d’un PDF. Le lecteur natif peut afficher le nom technique de l’URL temporaire dans sa propre barre; le titre métier reste dans la modale de Tabaat.

## Vérification

```sh
npm ci
npm test
```

Node.js compatible avec l’engine du `package.json` est nécessaire pour les tests uniquement; le site conserve son fonctionnement statique.

La suite couvre les injections de texte/attributs, les URL exécutables, les notes, corrections et avis, les éditeurs au chargement/sauvegarde/collage/dépôt, les chemins relatifs, les actions clavier, la pagination sur le catalogue réel, la sélection d’images et les courses de chargement PDF. Elle vérifie aussi la syntaxe des scripts existants.

Un contrôle isolé dans Chrome headless a vérifié le catalogue desktop/mobile, une modale d’image et le lecteur PDF natif. Les requêtes externes ont été neutralisées; aucun service distant n’a reçu de mutation. La relecture indépendante a détecté le problème de chemins relatifs, ensuite corrigé et couvert par un test.

## Périmètre

Le catalogue n’est pas réécrit en masse. L’authentification admin et le stockage du PAT GitHub relèvent du point 2, encore ouvert. La CSP stricte et le durcissement des autres scripts CDN restent des protections complémentaires à traiter séparément : les scripts statiques inline actuels nécessitent une adaptation dédiée.
