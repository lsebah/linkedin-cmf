# linkedin-cmf : moteur d'acquisition LinkedIn CMF

Version 9.0.2 (2026-11-11). Auteur : Laurent Sebah (CMF).

Scripts de la tâche planifiée « Prospection LinkedIn CMF ». La tâche se fait en deux temps :

```
08:30 PRÉPARATION (automatique, aucun envoi)
│   collect.js ► plan.js ► page « Lot du jour » + notification
│
« GO » DE LAURENT (1 message par jour dans la session)
│
EXÉCUTION
    envoi un par un dans l'interface LinkedIn (1 par minute, contrôle du fil avant chaque envoi)
    folk_sync en lot, page mise à jour, notification récapitulative
```

Aucun script de ce dépôt n'envoie de message, d'invitation ou d'acceptation. L'envoi reste un clic dans l'interface, message par message, après le « go ».

## Contenu

| Fichier | Rôle |
|---|---|
| `src/collect.js` | Collecte en lecture seule dans un onglet linkedin.com (requêtes GET et lecture de DOM uniquement). |
| `src/rules.js` | Moteur de règles pur et déterministe : `suivi` + `collect` + `sendlog` + date ► lot du jour. |
| `src/texts.js` | Textes figés A, AI, B, BI, E, C, rotation des versions, salutation et civilité. |
| `src/exclusions.js` | Réseaux exclus, retraités, hors cible, classement par famille. |
| `src/page.js` | Page « Lot du jour » (fragment HTML sobre, sans bouton d'envoi, sans coordonnées). |
| `src/plan.js` | Ligne de commande Node : produit le lot et la page. |
| `src/etat.js` | Ligne de commande Node : met à jour `suivi` (fils lus, envois confirmés). |
| `src/folk_sync.py` | Dédoublonnage, routage et interactions Folk en lot (mode plan, `--dry-run` par défaut). |
| `migration/build_suivi.js` | Construit la collection `suivi` depuis `sendlog`, `watch` et Folk. |
| `migration/appliquer_resolution.js` | Verse dans `suivi` les fiches dont l'URN vient d'être résolu. |
| `schemas/*.schema.json` | Schémas de `suivi`, `collect` et `plan`. |
| `dist/*.min.js` | Versions compactes à coller dans le navigateur (`npm run build`). |
| `prompt/261111_prospection-linkedin-v9.md` | Prompt v9 de la tâche planifiée. |
| `test/` | Tests (Node et Python) et fixtures anonymisées. |

## Tests

```bash
npm test
```

49 tests Node (dont les 15 cas d'acceptation du brief) et 18 tests Python. Aucune dépendance à installer. Node 20 ou plus, Python 3.10 ou plus.

## Préparer un lot

```bash
node src/plan.js --date 2026-11-12 --suivi suivi.json --collect collect.json --sendlog sendlog.json --config config.json --sortie plan.json --html lot.html
```

- `suivi.json` : documents de la collection `suivi` (tableau, ou objet indexé par URN).
- `collect.json` : collecte du jour (`schemas/collect.schema.json`).
- `sendlog.json` : les 7 derniers documents `sendlog` (`[{ "id": "2026-11-11", "inv": 0, "msg": 3, ... }]`).
- `config.json` : `{ "rampeDebut": "2026-11-12" }` (rampe du backlog : 20 par jour la 1re semaine, 35 la 2e, 50 ensuite). Sans cette date, le palier reste à 20.

Le lot (`schemas/plan.schema.json`) contient :
- `plan` : actions ordonnées {ordre, type, compteur, urn, slug, nom, org, famille, version, texte, motif, filLu} ;
- `aTraiter` : réservé à Laurent (réponses reçues, civilité incertaine, fil au tutoiement, versions épuisées) ;
- `reportes` : plafond atteint, fil non lu, un envoi par jour ;
- `ecartes`, `clotures` (Closed-lost dormant), `erreurs` (URN partagé, invalide ou parasite) ;
- `filsALire` : URN dont le fil doit être lu avant de relancer le moteur ;
- `rotation` : dernière version utilisée par série, à écrire dans `sendlog` (champ `rot`).

Déroulé en deux passages : premier lot ► lecture des fils de `filsALire` (`collect.js`, étape `threads`) ► second lot. Un premier message n'est jamais planifié sans fil lu et vide.

## Collecte dans LinkedIn (lecture seule)

Dans un onglet linkedin.com déjà connecté, coller `dist/collect.min.js` dans javascript_tool, puis appeler une étape par appel (moins de 45 s chacun) :

```js
await CMF.collect.run('diagnostic')
await CMF.collect.run('conversations', { depuis: '2026-11-10T09:10Z' })
await CMF.collect.run('birthdays')
await CMF.collect.run('connections', { depuis: '2026-11-10' })
await CMF.collect.run('watch', { liste: [{ id: 'paul-durand-123', n: 'Paul Durand' }] })
await CMF.collect.run('profiles', { slugs: ['paul-durand-123'] })
await CMF.collect.run('threads', { urns: ['ACoA...'] })
await CMF.collect.run('recherche', { requetes: ['Paul Durand Mutuelle X'] })
```

Chaque appel renvoie `{ ok, etape, data, reste, alertes, duree, arret }`. `reste` non vide : rappeler la même étape avec `{ reste }`. `arret: true` : vérification, limite ou déconnexion détectée, tout arrêter.

Garde-fous : 1,2 à 2,5 s entre requêtes, 60 profils et 20 recherches au plus par chargement, URN toujours extrait de la réponse, URN de Laurent (`ACoAAABb3LgB...`) signalé et écarté. Le jeton CSRF est lu dans la page à l'exécution et n'est ni renvoyé ni journalisé.

### Validation sur LinkedIn réel (faite le 2026-11-11)

`dist/collect.min.js` (v9.0.2) a été collé tel quel dans un onglet LinkedIn connecté au compte de Laurent, en lecture seule :

| Étape | Résultat |
|---|---|
| `diagnostic` | identité lue, 10 connexions avec slug et headline, bandeau de profil en version `WebTopCardCore-20`, URN cohérent, 20 conversations avec leur dernier message |
| `conversations` | 20 conversations, réponses reçues détectées |
| `threads` par l'API | 2 s par fil, auteur et date de chaque message |
| `threads` par cadre caché | 7 à 10 s par fil, sans navigation ; fil vide reconnu par le bouton « Supprimer <Prénom Nom> » et la carte de profil ; même résultat que l'API |
| `profiles` | 58 profils résolus en 3 appels, par slug public ou par identifiant de membre (`ACwAA...`) ; connecté, invitation en attente (`SENT`), distance |
| `birthdays` | 10 cartes lues par cadre caché ; les cartes ne portent pas l'URN (à résoudre par `profiles`) ; extraction du nom et de la date corrigée ensuite, non rejouée en réel |

À savoir :
- La page LinkedIn ne peut pas télécharger le script elle-même (sa politique de sécurité bloque raw.githubusercontent.com) : il faut le coller. Le fichier compact est en ASCII pur pour que le collage soit sûr.
- L'URN du compte connecté est lu sur `/voyager/api/me` et écarté des résultats. Il ne commence pas par `ACoAAABb3LgB` : cet URN « parasite » relevé en v8 n'est donc pas celui du compte ; il reste écarté par précaution.
- Non testés en réel : `jobChanges`, `recherche`, `watch` (même mécanique que `profiles`), et le navigateur intégré de la routine (les essais ont été faits dans Chrome).

Pour refaire le contrôle à tout moment : `JSON.stringify(await CMF.collect.run('diagnostic'))` (ni nom ni message dans le résultat). En cas de réponse inattendue, le moteur reste sûr : un fil non lu donne « fil non lu, reporté », jamais un envoi.

## Folk

Pas de clé API : tout passe par Composio (toolkit `folk`).

```bash
python src/folk_sync.py recherche --evenements ev.json            # opérations GET
python src/folk_sync.py plan --evenements ev.json --fiches fiches.json           # dry-run (défaut)
python src/folk_sync.py plan --evenements ev.json --fiches fiches.json --apply   # opérations à exécuter
```

Mode plan : aucun appel réseau ; la sortie liste des opérations `{id, method, endpoint, body}` que la routine exécute une à une avec `COMPOSIO_PROXY_EXECUTE`. `"$ref:creation:N.id"` désigne l'identifiant renvoyé par l'opération `creation:N`. Mode atelier : `sync_atelier(evenements, proxy_execute, apply=False)` dans `COMPOSIO_REMOTE_WORKBENCH` (appel authentifié vérifié en lecture le 2026-11-11).

Événement Folk (un par envoi confirmé, produit par `etat.js envoi`) :

```json
{ "urn": "ACoA...", "slug": "paul-durand-123", "nom": "Paul Durand", "org": "Cabinet Durand", "poste": "CGP",
  "famille": "dist", "categorie": "cgp", "type": "relance1", "version": "B2",
  "texte": "Bonjour Paul,\n...", "dateUTC": "2026-11-12T08:31:00Z" }
```

Types : `premier`, `backlog`, `relance1`, `relance2`, `invitation`, `invitation_acceptee`, `reponse` (avec `statut`), `refus` et `ecarte` (avec `motif`), `cloture`. Les anniversaires n'écrivent rien dans Folk.

Règles appliquées : recherche par nom complet avec et sans accents, rapprochement par slug LinkedIn puis par nom normalisé ; CGP ► CGP France + Weekly, autres ► The List + Weekly (Client Type, Assign Laurent sans retirer les autres, Acquisition LinkedIn si vide) ; les PATCH de groups, emails, phones, urls renvoient toujours l'existant plus l'ajout ; interactions de type linkedin, heure UTC réelle, titre avec la version, pas de doublon (même personne, même minute, même titre) ; jamais de descente de statut sauf vers Closed-lost ; Closed-lost dormant peut repasser en Follow-up après 12 mois ; fiche d'un collègue avec interactions ou contact déjà couvert : aucune écriture, signalement.

## Migration vers « suivi »

```bash
node migration/build_suivi.js --sendlog db/sendlog --watch db/watch --folk folk.json --date 2026-11-11 --sortie suivi.json --a-resoudre a_resoudre.json
```

Faite le 2026-11-11 sur les données réelles (5 702 fiches Folk, 16 jours de `sendlog`, 157 documents `watch`) : 105 documents `suivi` écrits, 139 fiches en file `aresoudre`.

`--sendlog` et `--watch` : dossiers de documents exportés par ArtifactData (`out_dir`). `--folk` : personnes des groupes CGP France, Weekly et The List (réponses d'API). La clé de `suivi` est l'URN : y entrent les invitations acceptées de `watch` et les contacts dont l'URN figure dans les notes de `sendlog`. Les fiches Folk n'ont qu'un slug : elles sortent dans `a_resoudre.json`, que la routine résout par l'étape `profiles` (60 par run) avant de les verser dans `suivi`. Une URL Folk de la forme `/in/ACoAA...` donne directement l'URN ; la connexion reste alors à vérifier. Les fils ne sont pas connus à la migration : le premier run v9 les lit et fixe l'état réel.

Après une résolution par `profiles` : `node migration/appliquer_resolution.js --lot lot.json --resultats resultats.txt --suivi dossier_suivi --date AAAA-MM-JJ` (une ligne `URN|distance|c ou a` par fiche, dans l'ordre du lot).

## Règles (prompt v8, reprises à l'identique)

- Calendrier : samedi et dimanche, anniversaires seulement.
- Plafonds : invitations 12 par jour (8 distributeurs, 4 institutionnels) et 60 sur 7 jours ; premiers messages 8 par jour et 40 sur 7 jours ; backlog 50 par jour et 200 sur 7 jours (rampe 20, 35, 50 par semaine) ; relances et anniversaires sans plafond.
- Ordre : anniversaires, relances, premiers messages, backlog, invitations.
- Relances : A seul de plus de 7 jours ► B ; A + B, B de plus de 14 jours ► E ; A + B + E ► Closed-lost dormant ; contact en dernier ► à traiter ; dernier message de plus de 12 mois sans refus ► cycle remis à zéro, B ; refus ► jamais.
- Anniversaires : déjà souhaité cette année ► rien ; contact en dernier depuis moins de 3 mois ► à signaler.
- Une personne : un envoi par jour, l'anniversaire prime.
- Rotation : version suivante de la série, jamais deux envois consécutifs identiques, jamais deux fois la même version pour un contact.
- Salutation : distributeurs par le prénom ; institutionnels « Madame X » ou « Monsieur X » (civilité déduite du prénom, prénom seul si nom abrégé, à traiter par Laurent si le prénom est mixte ou inconnu).
- « Merci pour la connexion. » si la connexion a moins de 15 jours (distributeurs).

Choix d'interprétation à connaître :
- Échange où Laurent a écrit en dernier après une réponse du contact (consigne du 2026-11-11) : le fil est relu ; si ce dernier message est ancien et resté sans réponse, il se relance avec les mêmes délais (plus de 7 jours ► B, puis plus de 14 jours ► E, puis dormant). Exception : fiche Qualified ou Closed-won dans Folk, jamais de relance automatique.
- Fil au tutoiement : aucun texte figé ne convient, le contact passe en « à traiter ».
- « Société présente 3 fois ou plus dans le lot » : comptée sur les nouveaux prospects du jour (premiers messages, backlog, invitations), pour les deux familles ; les libellés génériques (« Indépendant », « CGP », « MUT ») ne comptent pas.
- Deux contacts avec le même URN : ces contacts sont bloqués (bloc « Erreurs bloquantes »), le reste du lot est maintenu.
- Noms abrégés : exclus des invitations ; pour un contact déjà connecté, salutation par le prénom.

## Textes

Textes v8 recopiés caractère pour caractère, sauf la consigne du 2026-11-11 : « finance structurée » n'est plus employé (AI1, AI2, BI1 parlent de « solutions d'investissement » et de « produits structurés »). L'empreinte SHA-256 de chaque texte est vérifiée par les tests (`test/fixtures/empreintes.json`) : toute retouche d'un texte doit être voulue, puis l'empreinte régénérée.

Garde-fous réglementaires vérifiés par test : aucune promesse de performance, aucun rendement, aucun pourcentage dans les textes.

## Sécurité et confidentialité

- Aucun mot de passe, cookie ou jeton dans le code, le dépôt ou les journaux.
- Aucune coordonnée personnelle (email, téléphone) dans le dépôt, les fixtures, `suivi` ou la page. Les fixtures sont fictives.
- Les données réelles (`suivi.json`, `collect.json`, exports Folk) ne doivent pas être ajoutées au dépôt (`donnees/` et `*.local.json` sont ignorés par Git).
