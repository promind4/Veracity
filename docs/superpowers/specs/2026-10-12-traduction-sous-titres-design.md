# Veracity v0.5 — Traduction et sous-titres synchronisés

Date : 2026-10-12 · Statut : validé par l'utilisateur (option A ; doublage vocal prévu en v0.6)

## Constat
La traduction automatique de YouTube (`&tlang=fr` sur les sous-titres) est bloquée par la protection anti-robot : la traduction passe par l'IA.

## Découpage
- `buildCues` regroupe les segments en sous-titres de 2 à 7 s : coupure en fin de phrase, sinon à 7 s ou 160 caractères. La fin d'un sous-titre est le début du suivant, limitée à 6 s après le dernier segment, pour ne pas rester affichée pendant un silence.
- Les sous-titres YouTube sont désormais lus au dixième de seconde.
- La transcription Gemini produit des lignes de 3 à 8 s (au lieu de 15 s).
- Ces sous-titres serviront aussi d'unité au doublage (v0.6).

## Traduction
- `translateCues` : lots de 150 sous-titres numérotés `[n]`. Les 5 dernières traductions sont fournies comme contexte. Un numéro manquant garde le texte d'origine et est compté.
- Moteur : Gemini s'il y a une clé (gratuit, quota séparé), sinon OpenRouter (`translationEngine`).
- Langues : français (par défaut), anglais, espagnol, allemand, italien, portugais (`Config.targetLang`).
- Essai réel : 10 min en anglais, 81 sous-titres, traduits en 8 s, aucun manquant.
- Cache `translation:<id>:<langue>` ; fichier `traduction.md` dans la base de connaissances.

## Interface
- Onglet Transcription : choix de la langue, bouton « Traduire », affichage Original / Traduction / Bilingue (la recherche porte aussi sur l'original).
- « Sous-titres sur la vidéo » : le code est injecté avec `chrome.scripting`, sans dépendre du content script.
  - Bande centrée sur le lecteur `#movie_player`, taille proportionnelle à sa hauteur (correcte en plein écran), sous-titres natifs masqués.
  - Mise à jour toutes les 150 ms ; arrêt automatique si l'utilisateur change de vidéo.
  - Les sous-titres utilisent la traduction si elle existe, sinon l'original.
- Vérifié sur un vrai lecteur YouTube : deux lignes centrées lisibles.
