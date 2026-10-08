# Conservation des modifications administratives

Correctif local du point 3 de l’audit, validé le 7 octobre 2026.

## Comportement

- Les formulaires sont sauvegardés automatiquement : texte, HTML riche assaini, catégories, éditions, images, corrections, pièces jointes, liens et ordre des lignes. Les champs incomplets restent des brouillons, sans devenir des modifications publiables.
- Plusieurs brouillons peuvent être conservés. La liste des brouillons permet de rouvrir une nouvelle fiche abandonnée; rouvrir un livre reprend son formulaire en cours. Le dernier formulaire est restauré au démarrage.
- Le bouton Enregistrer prépare une modification à publier. Les ajouts/modifications et suppressions sont restaurés sur le catalogue chargé au démarrage.
- Les états affichés distinguent sauvegarde en cours, brouillon local, modifications enregistrées en attente de publication, publication et erreur de stockage. La confirmation locale attend la fin de la transaction IndexedDB.
- Une publication utilise un instantané des mutations. Elle ne retire de la file que les mutations réellement envoyées; un nouvel enregistrement pendant la requête reste à publier. Une erreur réseau/GitHub conserve la file et les formulaires.
- Un verrou Web Locks empêche deux onglets administratifs d’écraser leur stockage commun. Fermer le premier onglet puis recharger le second pour reprendre l’édition. Un navigateur sans Web Locks ou une origine non sécurisée bloque l’édition avec un message explicite.
- Si la lecture initiale échoue, les anciens enregistrements ne sont pas remplacés. La rédaction d’une nouvelle fiche reste possible en mémoire; Enregistrer, modifier une fiche existante et publier attendent une lecture réussie. Le bouton de nouvelle tentative relit les anciens changements et conserve les nouveaux brouillons.

## Stockage

`js/admin-draft-store.js` utilise IndexedDB, base `tabaat-admin-drafts`, magasin `state`, clé `editing`, version de schéma 1. Il conserve les brouillons, les mutations, le formulaire actif et les associations de suggestions; aucun PAT GitHub ni marqueur d’authentification n’entre dans cet instantané.

Un journal synchrone `localStorage`, clé `tabaat-admin-drafts-v1`, couvre la fenêtre précédant la fin d’une transaction IndexedDB. Des horodatages monotones permettent de choisir le journal s’il est plus récent. Les transactions sont sérialisées pour empêcher une ancienne écriture de remplacer une plus récente. Le journal n’est pas écrit tant que les anciennes données n’ont pas pu être lues et reconnues.

En cas d’échec du stockage, le formulaire reste en mémoire et le statut signale l’erreur. Garder la page ouverte puis réessayer. Les données restent propres à cet appareil, ce navigateur et cette origine; effacer les données du site efface aussi les brouillons. Une fermeture avant toute sauvegarde réussie, lorsque le stockage est indisponible, ne peut pas garantir leur récupération.

## Suggestions après publication

Enregistrer une suggestion ne la supprime plus. Après confirmation du PUT GitHub contenant son livre, son contenu est comparé à un export CSV frais : une correspondance unique fournit le numéro de ligne actuel. Les lignes sont dédupliquées et supprimées une par une en ordre décroissant. Une correspondance ambiguë est conservée.

L’association publiée reste dans le stockage local jusqu’à ce qu’un export frais indique son absence. Une publication sans nouvelle mutation permet de réessayer le nettoyage d’une suggestion déjà publiée.

L’iframe Apps Script ne fournit toujours pas d’accusé de réception vérifiable. Ce correctif ne présente pas son délai de réponse comme une preuve de suppression. Une modification simultanée du Sheet entre la lecture et le POST reste possible : les identifiants stables et confirmations serveur du point 5 de l’audit restent nécessaires.

## Validation

`npm test` couvre la restauration de brouillons et mutations, les suppressions locales, le changement de fiche, les champs incomplets, les échecs et modifications pendant publication, les suggestions restaurées/déplacées/ambiguës/doublonnées, les erreurs de lecture et leur reprise, les schémas inconnus, le verrou entre onglets et le journal. Les tests utilisent jsdom et fake-indexeddb; aucune API externe d’écriture n’est appelée. Le correctif du point 6 retire le préchargement des ressources admin, puisque l’administration reste accessible uniquement avec une connexion.

Vérification supplémentaire dans Chrome avec IndexedDB et Web Locks natifs, requêtes externes interceptées : restauration d’un formulaire non enregistré puis d’une mutation enregistrée après rechargement, états affichés, second onglet bloqué et reprise après fermeture du premier, contrôle mobile et absence d’erreurs JavaScript.
