# Veracity v0.4 — Transcription audio (vidéos sans sous-titres)

Date : 2026-10-12 · Statut : validé par l'utilisateur

## Constat (essais du 2026-10-12)
- Les flux audio YouTube (`googlevideo.com`) renvoient 403 au-delà des premiers 100 Ko avec les clients ANDROID et IOS : il faut un jeton anti-robot (PO token). Les clients ANDROID_VR et TVHTML5 répondent LOGIN_REQUIRED. Télécharger l'audio pour l'envoyer à Whisper (Groq) n'est donc pas fiable.
- Gemini accepte directement une URL YouTube publique (`fileData.fileUri`) : c'est Google qui récupère la vidéo.

## Solution
- `core/transcribe.ts` : `transcribeYouTube({videoId, durationS}, {key})` appelle `generateContent` avec `videoMetadata.fps = 0.1` et `MEDIA_RESOLUTION_LOW`, pour environ 25 000 tokens pour 13 min.
- Le prompt donne la durée exacte et impose le format `LANGUE: xx` puis des lignes `[m:ss] texte` d'environ 15 s.
- Chaîne de modèles : `gemini-flash-lite-latest`, puis `gemini-3-flash-preview`, puis `gemini-flash-latest`. On réessaie une fois sur 503/429 ; sur 403/404, on passe au modèle suivant.
- Erreurs : un 400 avec « api key » donne une erreur de configuration ; un autre 400 signifie une vidéo illisible (privée ou non répertoriée).
- Mesure : `gemini-flash-lite-latest` a mis 18 s et a donné des horodatages à ±5 s par rapport aux sous-titres.
- `fetchVideo(..., fallback?)` : la transcription de secours n'est utilisée que si la vidéo n'a ni sous-titres ni piste exploitable. `VideoInput.transcriptSource` vaut `captions` ou `gemini`.
- Extension : clé `geminiKey` dans les options (et `GEMINI_API_KEY` dans l'import .env), permission d'hôte `generativelanguage.googleapis.com`, origine de la transcription affichée dans l'onglet Transcription. Le rapport porte un avertissement quand la transcription vient de Gemini.
- CLI : `--audio` force la transcription Gemini.

## Limites
Vidéos publiques uniquement ; 8 h de vidéo YouTube par jour dans l'offre gratuite ; horodatages approximatifs.
