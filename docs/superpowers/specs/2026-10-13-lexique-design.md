# Lexique d'apprentissage (v0.10)

**But** : comprendre le vocabulaire des vidéos (ex. MQTT, Zigbee, FFI/unsafe) et le retenir, avec une bibliothèque commune à toutes les vidéos.

## Choix
- **À la demande** : aucun appel IA tant que l'utilisateur ne clique pas (latence et quota OpenRouter : 50 requêtes/jour).
- **Moteur** : Gemini d'abord (rapide, quota séparé, JSON), OpenRouter en secours ; le tuteur répond de même.
- **Profil** : champ libre dans les options (`userProfile`), rempli par l'utilisateur, jamais pré-rempli ; il part vers les modèles, donc pas de donnée personnelle.
- **Bibliothèque** : clé `lexicon` (un objet par terme, clé normalisée par `termKey`) ; un terme déjà connu garde sa définition et son statut, on lui rattache seulement la nouvelle vidéo.
- **Statuts** : new → learning → known. Deux bonnes réponses de suite en révision = connu. Un terme « connu » n'est plus redemandé au modèle.
- **Tuteur** : une discussion par terme (`lexchat:<terme>`), avec la fiche du terme, les vidéos où il apparaît et les termes déjà connus.
- **Export** : `LEXIQUE.md` à la racine de la base de connaissances, regénéré après chaque extraction si l'enregistrement automatique est actif.

## Fichiers
`core/lexicon.ts` (logique, prompts, tests dans `tests/lexicon.test.ts`) · `extension/src/sidepanel/lexicon.ts` (contrôleur) · `lexiconView.ts` (rendu) · options : « Mon profil ».
