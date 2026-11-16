# Veracity — extension Chrome de vérification de vidéos YouTube

Date : 2026-10-11 · Statut : à valider

## 1. Objectif

Sur une page YouTube, un clic sur « Vérifier » doit dire en environ une minute si la vidéo est fiable. L'outil vérifie les **faits**, comme VideoVFY. Il évalue aussi l'**honnêteté du discours** : extrapolations, généralisations, techniques de vente, conflits d'intérêts.

Usage personnel dans un premier temps. L'architecture garde le moteur d'analyse (`core/`) indépendant de Chrome, pour qu'on puisse le réutiliser plus tard dans un serveur ou un produit.

**Contrainte de coût : 0 €.** On n'utilise que des modèles et des API gratuits.

### Hors périmètre (v1)
TikTok et les autres plateformes, les fichiers locaux, la transcription audio (Whisper) des vidéos sans sous-titres, l'historique, les comptes et le paiement, Firefox.

## 2. Services externes (testés le 2026-10-11)

| Rôle | Service | Limite gratuite |
|---|---|---|
| LLM | OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free` | **50 req/jour**, 20/min (compte avec moins de 10 $ achetés) |
| LLM de secours | `nvidia/nemotron-3-super-120b-a12b:free`, puis `inclusionai/ling-3.1-flash` | idem |
| Recherche web | Serper `google.serper.dev/search` (URL directes, extrait, date) | 2 500 recherches offertes (1 crédit/recherche) |
| Recherche de secours 1 | Jina Search `s.jina.ai` | environ 10 M tokens offerts (≈ 1 000 recherches) |
| Recherche de secours 2 | ScraperAPI `structured/google/search` | 5 000 crédits/mois |
| Fact-checks existants | Google Fact Check Tools `claims:search` | gratuit |

Exclus : `openrouter/free` (il a inventé un fait pendant le benchmark) et le module web d'OpenRouter (payant).

**Conséquence de conception : exactement 2 appels LLM par vidéo.** Les recherches sont faites par le code, pas par le LLM.

## 3. Architecture

```
extension/
  manifest.json            MV3 : side_panel, storage, host_permissions des API
  src/content/             s'exécute sur youtube.com/watch
    button.ts              injecte le bouton « Vérifier » sous la vidéo
    transcript.ts          récupère la transcription horodatée + titre/description/chaîne
    seek.ts                saute à un horodatage (message venant du panneau)
  src/background/
    worker.ts              ouvre le side panel quand on clique le bouton de la page
  src/sidepanel/           exécute le pipeline core/ (page persistante, contrairement au service worker
                           que Chrome peut arrêter) et affiche le résultat (HTML/TS sans framework)
  src/options/             clés API (OpenRouter, Serper, Jina, Google Fact Check, ScraperAPI), choix du modèle, bouton « tester les clés »
core/                      TypeScript pur, aucune API Chrome : testable dans Node
  types.ts                 VideoInput, Claim, Evidence, Verdict, Report
  llm.ts                   client OpenRouter : chaîne de repli, reprise sur 429, sortie JSON validée
  extract.ts               appel LLM n°1
  evidence/
    serper.ts  jina.ts  scraperapi.ts  factcheck.ts
    gather.ts              orchestre les recherches pour chaque affirmation
  verify.ts                appel LLM n°2
  score.ts                 calcul déterministe des scores
  pipeline.ts              analyze(input, config, onProgress) → Report
scripts/try.ts             lance le pipeline en ligne de commande (lit .env) sur une transcription
```

Pile technique : TypeScript, Vite + `@crxjs/vite-plugin`, `zod` pour valider le JSON produit par le LLM, `vitest` pour les tests.

## 4. Flux de données

1. **Transcription** (content script, origine youtube.com) : appel `POST /youtubei/v1/player` avec le client `ANDROID`. Les sous-titres de la page web exigent un jeton anti-robot, ce qui n'est pas le cas de ce client (vérifié le 2026-10-11). On choisit la piste manuelle dans la langue parlée (déduite de la piste auto-générée), sinon la piste auto-générée, puis on la télécharge au format `fmt=json3`. On obtient des segments `{start_s, text}`, ainsi que le titre, la chaîne, la description et la durée. Si rien ne marche, afficher l'erreur « Pas de sous-titres disponibles ».
2. **Appel LLM n°1, extraction.** Entrée : titre, chaîne, description et transcription horodatée. Sortie validée par zod :
   - `summary` : 3 à 5 phrases ;
   - `claims[]` (au maximum 15, les plus importantes) : `id, timestamp_s, quote, claim` (reformulation autonome), `type` (fait | promesse_commerciale | opinion), `importance` (1 à 3), `queries[]` (1 ou 2 requêtes de recherche) ;
   - `rhetoric[]` : `timestamp_s, technique, quote, explanation`. Les techniques possibles sont : urgence, rareté, généralisation, témoignage_invérifiable, promesse_de_résultat, autorité_douteuse, conflit_intérêt, autre. Les liens affiliés ou les produits vendus présents dans la description sont signalés comme conflit d'intérêts.
3. **Collecte des preuves** (code, en parallèle, 3 à la fois). Uniquement pour les affirmations de type fait ou promesse_commerciale :
   - Google Fact Check sur `claim`, langue de la vidéo, 3 résultats au maximum ;
   - Serper sur `queries[0]` (et `queries[1]` si présente), 5 résultats, `gl`/`hl` selon la langue de la vidéo. En cas d'erreur ou de quota épuisé, on bascule sur Jina Search (extrait de 1 500 caractères au maximum par résultat), puis sur ScraperAPI (avec décodage des liens de redirection `google.fr/goto?url=`).
   - Chaque preuve reçoit un identifiant `E1…En` et garde son URL, son titre, sa date et son extrait.
4. **Appel LLM n°2, vérification.** Entrée : les affirmations et leurs preuves numérotées. Sortie, pour chaque affirmation :
   - `verdict` : vrai | plutôt_vrai | exagéré | trompeur | faux | invérifiable ;
   - `confidence` (0 à 1), `explanation`, `correction` (facultative) ;
   - `evidence_ids[]` : **uniquement des identifiants fournis**. Le code supprime tout identifiant inconnu, ce qui rend impossible l'invention d'URL.
   - Règle donnée au modèle : sans preuve pertinente, le verdict est « invérifiable » ; il ne juge jamais de mémoire. Un fact-check existant prime sur les autres sources.
5. **Score** (`score.ts`, sans LLM) :
   - **Exactitude des faits** = moyenne pondérée par `importance × confidence`, avec ces valeurs : vrai 1 · plutôt_vrai 0,8 · exagéré 0,5 · trompeur 0,25 · faux 0. Les affirmations invérifiables sont exclues du calcul. Si moins de 2 affirmations sont vérifiées, le score vaut « non calculable ».
   - **Honnêteté du discours** = 100 moins les pénalités suivantes : urgence 10 · rareté 10 · généralisation 8 · témoignage_invérifiable 8 · promesse_de_résultat 15 · autorité_douteuse 8 · conflit_intérêt 15 · autre 5. Chaque technique ne compte qu'une fois ; une répétition ajoute la moitié de la pénalité, dans la limite de 2 fois la pénalité. Le score est borné entre 0 et 100.
   - **Couverture** = nombre d'affirmations vérifiées / nombre d'affirmations vérifiables.
   - **Libellé global** : les deux scores ≥ 75 → « Fiable » ; faits ≥ 75 et discours < 60 → « Vrai sur le fond, mais discours très orienté » ; faits ≥ 75 et discours entre 60 et 74 → « Plutôt fiable » ; faits entre 50 et 74 → « À prendre avec recul » ; faits < 50 → « Peu fiable ».
6. **Cache** : le `Report` est enregistré dans `chrome.storage.local` sous la clé `videoId`. Un bouton « Ré-analyser » force une nouvelle analyse.

## 5. Interface (side panel)

- En haut : le libellé global, les deux scores sous forme de jauges, la couverture et le modèle utilisé.
- Le résumé de la vidéo.
- La liste des affirmations : pastille de couleur selon le verdict, horodatage **cliquable (la vidéo saute à ce moment)**, affirmation, explication, correction, puis les sources (titre, domaine, date). Les fact-checks existants sont signalés par un badge.
- La section « Discours » : chaque technique avec sa citation et son horodatage.
- Pendant l'analyse : la progression étape par étape (transcription → extraction → recherches x/n → vérification → score).

## 6. Erreurs

| Cas | Comportement |
|---|---|
| Pas de sous-titres | message clair ; la transcription audio est prévue en v2 |
| 429 / modèle gratuit saturé | 1 nouvel essai après 5 s, puis le modèle suivant de la chaîne |
| Quota journalier de 50 requêtes atteint | message « Quota gratuit du jour atteint » avec l'heure de remise à zéro |
| JSON du LLM invalide | 1 nouvel essai avec le message d'erreur de zod renvoyé au modèle, puis échec explicite |
| Clé absente ou refusée | renvoi vers la page d'options ; le bouton « tester les clés » appelle chaque API |
| Une recherche échoue | l'affirmation continue avec les preuves restantes (éventuellement « invérifiable ») |
| Vidéo de plus de 2 h | la transcription est tronquée et un avertissement est affiché |

## 7. Tests

- Tests unitaires (`vitest`) :
  - `score.ts` : formules, cas limites, libellés ;
  - analyse du format `json3` des sous-titres ;
  - validation zod et suppression des identifiants de preuve inventés ;
  - décodage des liens ScraperAPI ;
  - chaîne de repli de `llm.ts` (avec `fetch` simulé).
- Test de bout en bout : `scripts/try.ts` sur l'extrait de transcription du benchmark (dropshipping), puis sur 2 vraies vidéos. On vérifie que le piège de la TVA est classé « faux » avec une source officielle, et on compare le résultat à la vidéo évaluée à 42 % par VideoVFY.
- Test manuel : charger l'extension non empaquetée dans Chrome et analyser une vidéo de bout en bout.

## 8. Sécurité

- Les clés sont stockées dans `chrome.storage.local`, jamais dans le code. Le fichier `.env` sert uniquement aux scripts de développement et est exclu de Git.
- Aucune donnée n'est envoyée ailleurs qu'aux 5 API listées.
- Le contenu de la transcription et des pages web est passé au LLM comme **donnée**, avec la consigne d'ignorer toute instruction qu'il contiendrait (protection contre l'injection de prompt).
