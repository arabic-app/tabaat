# Images et uploads — audit, point 10

## Nouveaux fichiers

L’administration charge `js/media-upload.js`. Un fichier est contrôlé avant toute requête GitHub : extension autorisée, taille, signature et cohérence du MIME déclaré lorsqu’il est présent. Les images sont également décodées. Les dimensions annoncées dans l’en-tête sont vérifiées avant décodage : maximum 40 millions de pixels, et 16 000 pixels par côté. Le décodage expire après 15 secondes.

| Usage | Entrée maximale | Traitement |
|---|---:|---|
| Couvertures (`images`) | 15 Mio | Maximum 1 600 × 2 200 px, proportions conservées, sans agrandissement. WebP qualité 0,85, puis 0,78 et 0,70 si nécessaire. Maximum 2 Mio après traitement. |
| Images de corrections et pièces jointes | 15 Mio | Original conservé après validation et décodage, pour garder les détails lisibles. |
| PDF joints | 25 Mio | Extension/MIME, en-tête PDF, marqueur de fin et structure contrôlés. Original conservé. Pas de PDF dans les couvertures. |

PNG, JPEG et WebP sont autorisés. SVG, GIF et autres formats sont refusés. Un PNG retourné par un navigateur sans encodage WebP garde l’extension PNG. Une petite image est conservée si la conversion la rend plus lourde. Un échec de compression ne provoque pas l’envoi silencieux d’une grosse couverture originale.

Pour les PDF, `js/media-pdf-validator.js` charge la copie locale de PDF-Lib 1.17.1 dans un worker, uniquement au moment de la validation. Le document doit être lisible, non chiffré et contenir entre 1 et 20 000 pages. Le worker est arrêté après résultat, erreur ou 15 secondes, pour ne pas bloquer l’administration. Sa licence est conservée dans `vendor/pdf-lib.LICENSE.md`.

Une boîte de dialogue affiche le nom, l’aperçu de l’image, le poids avant/après et les dimensions finales. L’administrateur peut annuler ou confirmer l’envoi. Les PDF ne sont pas intégrés dans cet aperçu. Le dialogue natif gère le focus et Échap; l’URL temporaire est libérée à la fermeture.

Un seul fichier est traité à la fois, pour éviter plusieurs décodages lourds et des aperçus concurrents. Le bouton de fichier est bloqué pendant son traitement. La suppression du champ avant confirmation empêche l’envoi. Un échec GitHub conserve l’URL précédente. Le transfert a une limite de 30 secondes; un délai dépassé peut être ambigu si GitHub a reçu l’écriture : vérifier le dépôt avant de réessayer. Le nom envoyé porte l’extension du format effectif et un UUID.

## Publication et médias non référencés

Les fichiers sont toujours envoyés à GitHub avant publication du livre. Le message de succès rappelle d’enregistrer le livre et de publier les changements. Un formulaire abandonné après envoi peut donc laisser un média non référencé. Le point 10 ne change pas le protocole de publication et ne supprime aucun fichier.

Lancer depuis la racine :

```sh
node scripts/media-inventory.cjs > docs/audit/media-inventory.json
```

Le script lit les quatre dossiers médias et recherche les références dans les données JSON, la sauvegarde du catalogue et les sources HTML/CSS/JS/Markdown locales. Les liens locaux et ceux de `https://arabic-app.github.io/tabaat/` sont reconnus, y compris les chemins encodés. Le rapport inclut poids, sources des références, fichiers dépassant 1 Mio et candidats sans référence. Il n’effectue aucune suppression.

**Les candidats ne sont pas une autorisation de suppression.** Vérifier les brouillons présents sur les appareils, les branches non publiées et les consommateurs externes. Régénérer l’inventaire sur un dépôt à jour avant toute intervention. Les anciens médias ne sont ni modifiés ni recompressés.

## Vérifications

`npm test` couvre les formats invalides, images corrompues, limites avant décodage, proportions et poids, conservation des originaux, échecs d’encodage, confirmation/annulation, octets réellement transmis, erreurs GitHub, doubles événements, PDF malformés, arrêt du worker et inventaire en lecture seule. Les tests de compression utilisent Sharp pour décoder et encoder de vraies images; ils ne prouvent pas le rendu du codec Canvas dans chaque navigateur.

Vérification manuelle à effectuer dans l’administration avant déploiement : choisir une couverture photographique lourde, contrôler la lisibilité des petits caractères dans l’aperçu sur ordinateur et mobile, annuler et vérifier que le champ reste intact, puis confirmer dans un environnement de test. Vérifier également une image de correction, un PDF, Échap et la navigation Tab. La vérification visuelle automatisée n’a pas été réalisée : l’accès du navigateur à la page locale `file:` a été bloqué.

Ces contrôles côté navigateur réduisent les erreurs du parcours d’upload. Ils ne constituent pas une autorisation serveur ni un antivirus PDF; la protection administrative de l’audit, point 2, reste distincte.
