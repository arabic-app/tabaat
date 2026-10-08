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

**Les candidats ne sont pas une autorisation de suppression.** Vérifier les brouillons présents sur les appareils, les branches non publiées et les consommateurs externes. Régénérer l’inventaire sur un dépôt à jour avant toute intervention. Les fichiers sources des médias hors du lot de compression restent intacts. Le premier lot de compression, réalisé le 9 octobre, crée 17 variantes WebP dans `images/screen` et remplace uniquement les 17 URL correspondantes dans le catalogue. Le manifeste `docs/media-compression.json` conserve les correspondances, dimensions, poids et empreintes SHA-256, ainsi que la date de suppression des originaux.

## Vérifications

`npm test` couvre les formats invalides, images corrompues, limites avant décodage, proportions et poids, conservation des originaux, échecs d’encodage, confirmation/annulation, octets réellement transmis, erreurs GitHub, doubles événements, PDF malformés, arrêt du worker et inventaire en lecture seule. Les tests de compression utilisent Sharp pour décoder et encoder de vraies images; ils ne prouvent pas le rendu du codec Canvas dans chaque navigateur.

Vérification manuelle à effectuer dans l’administration avant déploiement : choisir une couverture photographique lourde, contrôler la lisibilité des petits caractères dans l’aperçu sur ordinateur et mobile, annuler et vérifier que le champ reste intact, puis confirmer dans un environnement de test. Vérifier également une image de correction, un PDF, Échap et la navigation Tab. La vérification visuelle automatisée n’a pas été réalisée : l’accès du navigateur à la page locale `file:` a été bloqué.

Ces contrôles côté navigateur réduisent les erreurs du parcours d’upload. Ils ne constituent pas une autorisation serveur ni un antivirus PDF; la protection administrative de l’audit, point 2, reste distincte.

## Premier lot de compression du catalogue — 9 octobre 2026

Les 17 couvertures de plus de 2 Mio passent de **63 049 607 à 6 001 370 octets**, soit **90,5 % de réduction pour les images servies**. WebP qualité 85, maximum 1 600 × 2 200 px, proportions conservées, orientation appliquée, sans agrandissement. Après demande explicite de l’utilisateur, les 17 originaux ont été supprimés le 9 octobre, libérant 63 049 607 octets. Seules les variantes restent présentes pour ce lot. Les 17 liens de `books.json.bak` ont également été mis à jour pour conserver une sauvegarde utilisable.

Les 17 variantes ont été décodées et leurs aperçus examinés en planche contact. Ce contrôle confirme l’affichage des couvertures à la taille de consultation, sans garantir la lisibilité de tous les petits caractères lors d’un zoom. Les 432 livres et leurs autres champs sont conservés. Aucun média du catalogue ne manque et l’inventaire ne relève aucun fichier sans référence.

Le [manifeste de compression](media-compression.json) conserve les correspondances historiques; les sources supprimées restent récupérables depuis leur version suivie dans Git. Aucune publication distante n’a été effectuée.

## Deuxième lot — 9 octobre 2026

Les 31 couvertures restantes dépassant 1 Mio ont des variantes WebP qualité 85, maximum 1 600 × 2 200 px, sans agrandissement : **48 547 238 → 10 041 832 octets** (−79,3 %). Les 17 variantes du premier lot ne sont pas recompressées.

L’image de correction du livre 49, *سير أعلام النبلاء*, volume 10, page 504, passe de **4 796 011 → 2 382 078 octets** (−50,3 %). Dimensions conservées : 4 000 × 3 000 px. La tentative WebP sans perte produisait un fichier plus lourd; la variante retenue utilise WebP qualité 95 et effort 6. Une comparaison de texte à taille réelle a été examinée. La compression est avec perte; le JPEG source a ensuite été supprimé à la demande explicite de l’utilisateur.

Les 32 sources de ce lot ont ensuite été supprimées localement à la demande explicite de l’utilisateur, libérant **53 343 249 octets (53,3 Mo)**. Les variantes sont conservées et vérifiées. Le [manifeste du deuxième lot](media-compression-batch2.json) garde leurs correspondances, empreintes et la date de suppression; les originaux restent récupérables depuis Git. Les liens du catalogue courant et de sa sauvegarde sont mis à jour. Le manifeste conserve les correspondances, empreintes et chemins des champs modifiés. Le poids des variantes, **12,4 Mo au lieu de 53,3 Mo**, réduit les transferts de 76,7 %. Après suppression des sources, le gain de stockage net par rapport au lot initial est de 40,9 Mo. Aucun lien média ne manque dans le catalogue courant ni sa sauvegarde. Aucun déploiement effectué.
