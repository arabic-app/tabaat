# Confirmation des médias sans référence — 8 octobre 2026

Les **222 candidats, totalisant 52 697 703 octets (52,7 Mo / 50,3 Mio)**, sont confirmés sans référence retrouvée dans le périmètre vérifié. Après confirmation explicite de l’utilisateur, les 222 fichiers ont été supprimés localement le 8 octobre 2026. Ils sont récupérables depuis Git; aucune suppression distante ni publication n’a été effectuée.

| Dossier | Fichiers | Poids |
|---|---:|---:|
| images | 219 | 49 096 884 octets |
| corrections | 2 | 1 025 440 octets |
| editions_attachments | 1 | 2 575 379 octets |
| books_attachments | 0 | 0 |

**160 des 222 fichiers sont identiques octet pour octet à au moins un média référencé**, confirmé par SHA-256. Les 62 autres n’ont pas de copie identique parmi les médias référencés; cela ne démontre pas qu’ils sont différents visuellement.

## Contrôles effectués

- Régénération de l’inventaire : même ensemble de 222 chemins.
- Recherche indépendante des noms de fichiers, bruts et encodés, dans 58 fichiers locaux hors médias, dépendances, tests et rapport généré. Aucun nom retrouvé. Ce contrôle couvre aussi des fichiers omis par le filtre de l’inventaire, notamment la sauvegarde HTML de l’admin et la configuration du Worker.
- Vérification des catalogues des branches locales et références distantes disponibles : `main`, `audit`, `backup-before-audit` et leurs références `origin`. Aucune référence retrouvée. Les références Git distantes locales ne sont pas une vérification en direct des branches distantes.
- Recherche dans les sources locales de Maktabati, hors dépendances et sorties de compilation : aucun nom retrouvé.
- Lecture en direct du catalogue GitHub Pages et de celui de `main` sur GitHub, le 8 octobre à 23 h 35, heure de Paris. Les deux contiennent 432 livres, ont le même SHA-256 et ne référencent aucun des 222 fichiers. Leur contenu correspond également au catalogue local.
- Calcul SHA-256 des 1 096 médias locaux pour identifier les copies exactes.

[Liste complète des fichiers et de leurs doublons](audit/media-unreferenced-confirmed.tsv). Le [rapport JSON](audit/media-inventory.json) contient désormais l’inventaire après nettoyage, la liste des suppressions et les preuves du contrôle initial.

## Portée de la confirmation

« Sans référence » signifie sans référence dans les sources et catalogues vérifiés. Les brouillons conservés dans les navigateurs ne sont pas accessibles dans ce contrôle. Les usages externes hors des sources locales de Maktabati ne peuvent pas être recensés exhaustivement.

Après suppression, 874 médias restent présents et l’inventaire ne trouve plus de fichier sans référence. Les 873 chemins médias distincts retrouvés dans `books.json` existent tous; le catalogue de 432 livres est inchangé, empreinte SHA-256 comprise. Le média supplémentaire est protégé par une référence dans les autres sources ou la sauvegarde.

La liste TSV conserve les noms et empreintes des 222 fichiers supprimés. La régénération de l’inventaire remplace le rapport JSON et son historique de nettoyage; conserver ce compte rendu et la liste TSV pour la traçabilité.
