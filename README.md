# Veracity

> Projet expérimental : les scores et les réponses générés par l'IA peuvent être inexacts. Vérifiez les sources avant de tirer une conclusion.

Extension Chrome qui vérifie les affirmations d'une vidéo YouTube et la façon dont elles sont présentées. Pour chaque vidéo, elle donne deux scores (exactitude des faits, honnêteté du discours), la fiabilité de la note elle-même, des sources et des horodatages cliquables. Elle sert aussi à étudier la vidéo : discussion, transcription, traduction, doublage, lexique d'apprentissage.

## Installer

Prérequis : Node.js, npm et Google Chrome. Clonez le dépôt avant l'installation :

```bash
git clone https://github.com/promind4/Veracity.git
cd Veracity
```

Copiez `.env.example` vers `.env` et renseignez vos clés personnelles, ou saisissez-les directement dans les options de l'extension. Le fichier `.env` est privé et ne doit jamais être publié.

```bash
npm install
npm run build
```

Ensuite, dans Chrome :
1. Va sur `chrome://extensions` et active le **Mode développeur**.
2. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `dist/`.
3. La page d'options s'ouvre : clique sur **Importer un fichier .env** (`.env` à la racine du projet), puis sur **Enregistrer** et **Tester les clés**.

Après une mise à jour du code : `npm run build`, puis ↻ sur la carte de l'extension.

## Moteurs d'IA et quotas

| Service | Rôle | Limite gratuite constatée |
|---|---|---|
| **Gemini** (clé gratuite, aistudio.google.com/apikey) | moteur principal : analyse, discussion, lexique, traduction, transcription audio, doublage | **20 requêtes par jour et par modèle** ; les modèles sont essayés l'un après l'autre. Les modèles « preview » sont souvent saturés (erreur 503). |
| **OpenRouter**, modèles `:free` | secours quand Gemini est épuisé ou saturé | 50 requêtes par jour, mais lent (3 à 4 minutes par appel) |
| Serper | recherche de sources | 2 500 recherches offertes |
| Jina, ScraperAPI, Google Fact Check | recherche de secours, fact-checks existants | |

Une analyse consomme 3 requêtes Gemini (extraction, puis deux passages de vérification). Quand le quota du jour d'un modèle est épuisé, l'extension le saute jusqu'à sa réinitialisation au lieu de réessayer. Comparatif du 13/10/2026 sur 5 vidéos de référence : `gemini-3-flash-preview` classe correctement les cinq (science 99 %, Terre plate 21 %, formation « devenir riche » 38 %) en 20 à 60 secondes par appel ; le modèle OpenRouter donne des notes proches mais 5 fois plus lentes ; `flash-lite` renvoie souvent un JSON inexploitable.

## Utiliser

Sur une vidéo YouTube, le bouton **🔎 Vérifier la véracité** sous le titre (ou l'icône de l'extension) ouvre le panneau. Une vidéo déjà analysée affiche directement ses scores sur ce bouton, et un badge **Faits xx %** apparaît sur ses miniatures (accueil, recherche, suggestions). Le panneau a cinq onglets :

- **Rapport** : vérification des faits et du discours (1 à 3 minutes). La **fiabilité de la note** (haute, moyenne, faible) dit si le score est solide : elle dépend du nombre d'affirmations vérifiées, de la couverture et de l'accord entre deux passages de vérification indépendants.
- **Discussion** : questions à l'IA sur la vidéo (résumé détaillé, process pas à pas, chapitres…). **Sélectionne un mot** dans une réponse, la transcription ou le rapport : un bouton l'ajoute au lexique.
- **Transcription** : texte complet horodaté et cherchable, traduction dans la langue choisie, sous-titres synchronisés sur la vidéo, doublage vocal (Gemini, Piper ou voix du navigateur, une voix par intervenant).
- **Lexique** : vocabulaire à apprendre (voir plus bas).
- **Historique** : toutes les vidéos traitées (scores, catégorie, recherche, filtres) et, dans la bascule **Chaînes**, les chaînes analysées.

### Évaluer une chaîne

Sur une vidéo ou sur la page d'une chaîne, **📺 Évaluer la chaîne** (onglet Rapport) ou Historique → Chaînes. L'extension prend un échantillon de 3, 5 ou 8 vidéos parmi les 15 dernières (en alternant les plus récentes et les plus vues), les note une à une, puis donne un **verdict de chaîne** : fiable, faits corrects mais discours très orienté, mitigée, peu fiable ou commerciale, avec un conseil (« vaut le coup », « ne perds pas ton temps »), la moyenne des faits et du discours, les procédés de persuasion les plus fréquents et le niveau de confiance. Les vidéos de moins de 3 minutes ou sans sous-titres sont écartées. Les vidéos déjà analysées ne sont pas refaites, et si le quota du jour est atteint l'analyse s'arrête en gardant ce qui est fait : relancer reprend. Chaque vidéo de l'échantillon coûte 2 requêtes Gemini (un seul passage de vérification) et 1 à 3 minutes. Le verdict de la chaîne s'affiche aussi sous le nom de l'auteur sur la page de ses vidéos.

En ligne de commande : `npm run try -- x --channel UC… --sample 5`.

### Lexique

- **Extraire le vocabulaire** d'une vidéo (une requête, seulement quand tu cliques) : définition, exemple, rôle dans la vidéo, termes liés. Ton profil (options, « Mon profil ») permet d'adapter le niveau ; il est envoyé aux modèles, n'y mets aucune donnée personnelle.
- **Bibliothèque** commune à toutes les vidéos, avec recherche et filtres ; un terme déjà connu garde sa définition et gagne un lien vers la nouvelle vidéo.
- **Réviser** par cartes ou par QCM (questions générées par l'IA), en **répétition espacée** : une bonne réponse espace la prochaine révision (1, 3, 7, 14, 30 jours), une erreur ramène au début. « Je connais » reprogramme une vérification dans 30 jours.
- **Explique-moi** : une discussion de tutorat par terme.

### Base de connaissances

Dans les options, clique sur **Choisir le dossier de la base…** et sélectionne par exemple `D:\BDD YOUTUBE` ; à la demande de Chrome, choisis « Toujours autoriser ».

```
D:\BDD YOUTUBE\
├── INDEX.md                        table des matières (par catégorie)
├── <Catégorie>\
│   └── <Titre> [id]\
│       ├── rapport.md  discussion.md  transcription.md  traduction.md
│       └── veracity.json           sauvegarde restaurable de cette vidéo
├── _Chaînes\
│   └── <Nom> [UC…]\
│       ├── chaine.md               verdict de la chaîne et vidéos analysées
│       └── chaine.json             sauvegarde restaurable
└── _Lexique\
    ├── LEXIQUE.md                  le lexique, par domaine, avec liens vers la vidéo
    ├── lexique.json                sauvegarde restaurable (termes, statuts, quiz, discussions)
    └── Discussions\<terme>.md      une discussion de tutorat par terme
```

Les vidéos sont classées automatiquement par catégorie (en réutilisant celles qui existent). **Modifier** la catégorie déplace le dossier. Le lexique est sauvegardé automatiquement après chaque modification ; si Chrome demande de réautoriser le dossier, un bouton **Autoriser** apparaît dans l'onglet Lexique. **♻️ Restaurer depuis la base** (onglet Historique) réimporte vidéos, lexique et chaînes après une réinstallation, sans écraser de données plus récentes.

## Développement

| Commande | Rôle |
|---|---|
| `npm test` | tests unitaires (vitest) |
| `npm run typecheck` | vérification des types |
| `npm run try -- <url YouTube ou fichier.txt>` | analyse en ligne de commande, rapport dans `out/` |
| `npm run try -- <url> --ask "question"` | discussion en ligne de commande |
| `npm run calibrate [-- --runs 2]` | analyse les 5 vidéos de référence (`calibration/corpus.json`) et vérifie que les scores tombent dans les fourchettes attendues |
| `npx tsx calibration/compare-models.ts` | compare les moteurs d'IA sur les mêmes données |

Le moteur d'analyse est dans `core/` (TypeScript pur, sans API Chrome) ; l'extension est dans `extension/`.
Spécifications : `docs/superpowers/specs/` · Plans : `docs/superpowers/plans/`.
