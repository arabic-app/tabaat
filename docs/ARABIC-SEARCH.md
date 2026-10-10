# Recherche arabe commune — audit point 9

Le site public, l’administration, le formulaire et le Worker utilisent `js/arabic-search.js`. Les pages chargent le script local; Wrangler inclut le même fichier par import dans le Worker.

## Règles

La recherche normalise en NFC et minuscules, retire tatweel et signes diacritiques arabes, regroupe les espaces et applique les équivalences suivantes :

- أ / إ / آ / ٱ → ا
- ى / ئ → ي; ؤ → و; ء supprimé; ة → ه
- ابن → بن uniquement comme mot entier, y compris à proximité d’une ponctuation. `ابناء` et `بنان` ne subissent pas cette substitution.

Ce sont des règles de recherche tolérante, pas des corrections orthographiques. Elles peuvent rapprocher des mots distincts; les titres, auteurs et données du catalogue restent inchangés. Le bot conserve ses règles propres de classement, mots vides et retrait de l’article défini.

## Index et saisie

Les champs titre, auteur, catégorie, éditeurs et vérificateurs sont préparés et mémorisés par objet livre dans un WeakMap. Les pages réutilisent ces champs à chaque recherche. L’administration remplace les objets lors de l’enregistrement et de la fusion : les nouvelles versions obtiennent de nouveaux champs; les anciennes peuvent être libérées. Une future modification en place d’un champ indexé nécessiterait une invalidation ou un remplacement de l’objet.

Le Worker compare le contenu du catalogue récupéré à sa dernière copie dans l’instance. Il ne parse et n’indexe à nouveau que lorsque ce contenu change. La récupération réseau et son cache Cloudflare de 300 secondes restent actifs; une nouvelle version apparaît après actualisation de ce cache.

La saisie des recherches principales attend 180 ms. Les boutons d’effacement et filtres explicites restent immédiats; les recherches différées sont annulées pour éviter de réappliquer une ancienne valeur. Le formulaire annule également ses suggestions à la perte de focus et à Échap. La pagination publique reste par lots de 20. Le surlignage du formulaire utilise une portion exacte du texte original; une correspondance obtenue uniquement par normalisation s’affiche sans surlignage pour préserver les lettres et leurs positions.

Le service worker v18 précharge le module local pour la recherche hors ligne.

## Vérification

`npm test` couvre les variantes métier, limites de mots, réutilisation des champs, remplacement d’un livre, temporisation et annulation, recherches publiques et admin, suggestions du formulaire et actualisation de l’index du Worker. Les tests DOM simulent les réponses réseau sans appel aux services externes. Les tests de statistiques utilisent Miniflare et nécessitent l’ouverture d’un port local.

Validation finale : 120 tests sur 120 passent; `wrangler deploy --dry-run` compile le Worker avec le module partagé. La revue indépendante a identifié une sélection clavier de suggestion périmée pendant le délai de saisie : corrigée et couverte par un test de régression.

Correctif local uniquement : site et Worker à publier ensemble pour partager les nouvelles règles. Aucune mesure Lighthouse ou validation visuelle mobile n’a été effectuée dans ce lot.
