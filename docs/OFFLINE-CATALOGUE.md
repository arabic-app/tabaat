# Catalogue hors ligne

Correctif local du point 6 de l’audit, validé le 8 octobre 2026.

## Données fiables et disponibles

Le service worker utilise une clé canonique par fichier `books.json`, `sciences.json` et `reviews.json`, sans paramètres de requête. Les pages n’ajoutent plus systématiquement de timestamp à ces URL et demandent une lecture réseau avec `cache: 'no-store'`.

Une réponse réseau est acceptée uniquement si elle réussit et contient un JSON conforme aux structures consommées par le site. La validation commune est dans `js/catalogue-data.js`; elle complète l’assainissement du HTML au rendu, sans le remplacer. Une réponse HTTP en erreur, un JSON invalide ou une coupure réseau conservent la dernière copie valide.

Le délai de huit secondes couvre le réseau et la lecture complète du corps JSON. Si aucune copie valide n’est disponible, le service worker renvoie HTTP 503, jamais un tableau vide artificiel avec HTTP 200. Un véritable catalogue vide reste valide.

Les écritures sont attachées à `event.waitUntil` et sérialisées. Une ancienne requête lente ne remplace pas une réponse valide issue d’une requête plus récente. Un échec d’écriture dans le cache ne transforme pas une réponse réseau valide en erreur.

## Interface du catalogue

La page affiche le chargement, la disponibilité du catalogue, l’utilisation d’une copie conservée, l’absence de connexion ou l’échec d’une actualisation. Le bouton permet d’actualiser ou de réessayer. Une erreur d’actualisation conserve les livres déjà affichés et leur date; une reconnexion déclenche une nouvelle tentative.

La date correspond à `Last-Modified` si cet en-tête est valide. Sinon, elle indique explicitement la date de récupération connue; une ancienne copie sans métadonnées affiche que sa date est inconnue. Elle ne prétend pas connaître la date de modification du catalogue dans ce cas.

Les données sont aussi validées dans la page, pour couvrir le premier chargement ou un navigateur sans service worker. Les filtres ne présentent pas « aucun résultat » lorsque le catalogue n’a pas pu être chargé. L’actualisation conserve les filtres disponibles et ne multiplie pas les gestionnaires d’autocomplétion.

## Caches et migration

- `tabaat-v17` : pages publiques et ressources locales de l’interface.
- `tabaat-data-v17` : trois fichiers de données validés.
- `tabaat-images-v17` : au plus 100 images de contenu, y compris les images de corrections et pièces jointes; éviction des entrées les plus anciennes.

L’installation précharge les ressources publiques et tente de conserver les données valides pour la première revisite hors ligne. L’activation récupère les copies valides des anciens caches avant de les supprimer. Elle privilégie les dates de récupération/modification disponibles; en leur absence, l’ordre des générations et des entrées fournit un repli. Les anciennes réponses invalides sont ignorées. Si la migration échoue, les anciens caches ne sont pas supprimés.

Seuls les caches préfixés `tabaat-` devenus obsolètes sont nettoyés. Le service worker intervient uniquement sur les GET de sa propre origine et de son périmètre. Les requêtes vers les API et ressources externes suivent leur fonctionnement réseau habituel.

L’administration reste accessible uniquement avec une connexion et n’est plus préchargée. Ses brouillons IndexedDB du point 3 restent conservés. La limite d’images porte sur le nombre d’entrées, pas sur un budget en octets; le quota et l’éviction automatique du navigateur peuvent limiter la conservation. Les PDF ne sont pas préchargés ni ajoutés au cache d’images.

## Vérification

`npm test` inclut les tests du service worker et du chargement du catalogue : mises à jour successives, migration, cache vide, réponses invalides, origine/périmètre, borne d’images, erreurs de stockage, écritures concurrentes et corps JSON bloqué. Les tests de sécurité et de conservation des brouillons restent inclus.

Contrôle supplémentaire avec Chrome et un service worker réel sur localhost, tous les appels externes bloqués : première revisite hors ligne, reconnexion vers une nouvelle version, réponse invalide conservant le cache, cache vide HTTP 503 avec erreur visible, migration des anciennes versions et conservation d’un cache tiers. Vérification de l’affichage mobile et de l’absence d’erreurs JavaScript.
