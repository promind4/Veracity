# Moteur Gemini, fiabilité des notes, sauvegarde, lexique+, badges (v0.11)

## Moteur d'analyse
- `core/engine.ts` : `JsonEngine` (messages + schéma Zod → JSON validé). `geminiEngine` (température 0, `responseMimeType: application/json`), `openrouterEngine`, `analysisEngine` (Gemini d'abord, OpenRouter en secours). `answerText` pour les réponses libres (discussion, tuteur).
- Constat du 13/10/2026 : le quota gratuit Gemini est de **20 requêtes par jour et par modèle** (pas « plus large » qu'OpenRouter par modèle) ; les modèles preview sont souvent saturés (503). `geminiGenerate` mémorise un modèle dont le quota du jour est épuisé (délai « retry in … » ≥ 2 min) et passe directement au suivant.
- Comparatif sur les 5 vidéos de référence (`calibration/compare-models.ts`, résumé : `node calibration/summary.mjs`) : `gemini-3-flash-preview` retenu en tête ; `flash-lite` écarté (JSON souvent inexploitable) ; `gemini-flash-latest` lent.

## Fiabilité des notes
- Vérification en **2 passages** (si Gemini) : le second reçoit les affirmations dans l'ordre inverse et une température de 0,4, pour que l'accord ne soit pas trivial. `combineVerdicts` : vote majoritaire, à égalité un verdict tranché plutôt qu'« invérifiable » puis le plus prudent ; confiance × accord.
- `Scores.range` (écart entre passages), `Scores.reliability` (haute / moyenne / faible, `reliabilityOf`) : « haute » exige deux passages concordants, ≥ 8 affirmations vérifiées, couverture ≥ 65 %.
- Un passage qui échoue n'annule pas l'analyse (avertissement).

## Sauvegarde dans la base
- Chaque dossier de vidéo reçoit `veracity.json` (vidéo, rapport, discussion, traductions, intervenants, catégorie). `_Lexique/` : `lexique.json`, `LEXIQUE.md`, `Discussions/<terme>.md`. Les noms en `_` ne sont ni des catégories ni des vidéos (`listCategories`, `scanKb`).
- Sauvegarde du lexique automatique et groupée (1,5 s après la dernière modification) ; état affiché dans l'onglet (🔒 à réautoriser, ⚠️ pas de dossier).
- Restauration (`restoreFromKb`) : n'importe que ce qui manque ou ce qui est plus récent / plus complet ; le dossier fait foi pour la catégorie.

## Lexique
- Sélection d'un mot dans un texte de la vidéo → bouton flottant → `defineTerm` avec le passage comme contexte, vidéo rattachée.
- Répétition espacée (boîtes 0 à 5 : 0, 1, 3, 7, 14, 30 jours), QCM générés par l'IA (une requête par séance, gardés sur le terme).

## Badges YouTube
- (Voir aussi « Analyse d'une chaîne » en fin de document.)
- `scoreIndex` (clé de stockage) : index compact des scores, tenu à jour par `saveReport`, reconstruit si absent. Le script de la page pose « Faits xx % » sur les miniatures (taille minimale 100×50 px pour ignorer avatars et liens cachés) et affiche les scores sur le bouton de la page de la vidéo. Cliquer sur le bouton d'une vidéo déjà analysée ouvre le rapport sans relancer l'analyse.


## Analyse d'une chaîne
- `core/channel.ts` : flux Atom de la chaîne (15 dernières vidéos, avec les vues) ; `candidateOrder` alterne récentes et populaires ; `analyzeChannel` note l'échantillon (vidéos déjà analysées gratuites ; courtes ou sans sous-titres écartées et remplacées ; arrêt propre si le quota est atteint) ; `summarizeChannel` : moyenne des faits (vidéos évaluables) et du discours, écart, procédés fréquents, verdict (`verdictOf`) et confiance (6 vidéos et écart ≤ 30 pour « haute »).
- Un seul passage de vérification par vidéo (quota) ; pas de transcription audio de secours (une requête de plus par vidéo).
- Stockage `channel:<UC…>` et `channelIndex` (nom → verdict, lu par la page YouTube) ; base : `_Chaînes/<nom [id]>/chaine.md` et `chaine.json` ; restauration prise en charge.
- Panneau : Historique → bascule Vidéos / Chaînes ; raccourci « 📺 Évaluer toute la chaîne » dans l'onglet Rapport ; l'identifiant de chaîne vient de la vidéo ouverte (`VideoInput.channelId`) ou de la page de chaîne.
