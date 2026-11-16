# Veracity v0.6 — Doublage vocal

Date : 2026-10-12 · Statut : validé par l'utilisateur (Gemini et Piper intégrés, choix dans les options)

## Moteurs (essais du 2026-10-12)
| Moteur | Mesure | Usage |
|---|---|---|
| Gemini TTS (`gemini-2.5-flash-preview-tts` par défaut, repli sur 3.1 et 3.8) | 4,5 à 7,5 s par requête ; le 2.5 a le débit le plus proche de l'original | groupes de phrases d'environ 20 s (économie de quota) ; 120 s d'avance |
| Piper (navigateur, `@mintplex-labs/piper-tts-web`) | multi-thread : 1,6 s pour 4,75 s d'audio ; mono-thread : 2,1 s pour 2,5 s | une phrase par passage ; 45 s d'avance |
| Navigateur (Web Speech) | instantané | voix lue directement dans la page |

- Kokoro est écarté : sa version JavaScript n'a pas de voix française.
- Le quota gratuit de synthèse vocale Gemini n'est pas publié. Un 429 fait passer au modèle suivant (quotas séparés) ; quand tous les modèles sont épuisés, le doublage bascule automatiquement sur Piper.

## Piper dans l'extension
- Les moteurs onnxruntime-web 1.18 (`ort-wasm*.wasm`) et le phonémiseur (`piper_phonemize.wasm/.data`) sont copiés dans `extension/public/piper` par `scripts/copy-piper-assets.mjs` (prebuild). Ils ne sont pas versionnés et aucun code n'est chargé depuis un CDN.
- Le modèle de voix (~60 Mo) est téléchargé depuis Hugging Face au premier usage, puis gardé dans le stockage local du navigateur (OPFS).
- Le calcul tourne dans un worker (`piper.worker.ts`). Chaque changement de voix réinitialise la session, car la bibliothèque ne recharge pas le modèle.
- Le manifest active l'isolation multi-origine (`cross_origin_embedder_policy: require-corp`, `cross_origin_opener_policy: same-origin`), ce qui rend Piper environ 3 fois plus rapide grâce aux threads. Vérifié : les 7 API utilisées restent joignables (toutes répondent en CORS).

## Synchronisation
- `planDubGroups` : une phrase par groupe (Piper, navigateur) ou des phrases regroupées jusqu'à 20 s sans enjamber un silence de plus de 1,5 s (Gemini). Chaque groupe porte une fenêtre de temps (jusqu'au groupe suivant).
- Lecteur injecté dans la page (`dubPlayerScript`, autonome) :
  - déclenche un passage quand la vidéo atteint son début, avec une tolérance de 1 s ;
  - vitesse = durée de l'audio / fenêtre, bornée entre ×1 et ×1,6 et multipliée par la vitesse de la vidéo ;
  - volume de la vidéo baissé (20 % par défaut) pendant la session ;
  - pause et reprise suivent la vidéo ; un saut coupe la voix et reprend au passage suivant ; arrêt automatique si l'utilisateur change de vidéo ;
  - un passage dont l'audio n'est pas prêt est sauté et compté.
- Pilotage (`DubController`, side panel) : toutes les secondes, il demande la position de lecture, génère le prochain passage manquant dans la fenêtre d'avance et l'envoie au lecteur (WAV en base64). Les passages générés sont gardés en cache pour la vidéo.
- Vérifié sur un vrai lecteur YouTube : déclenchement à l'heure (80 ms d'écart au maximum), vitesse ×1 puis ×1,6, passage manquant compté, volume 0,2 puis restauré, pause, reprise et saut corrects.

## Interface
- Options : moteur, voix et modèle Gemini, voix Piper (français ; une voix par défaut pour les autres langues), voix du navigateur, volume d'origine, bouton « Écouter un exemple ».
- Onglet Transcription : bouton « 🔊 Doublage » (lance la traduction d'abord si nécessaire) et ligne d'état (moteur, passages prêts, téléchargement de la voix, erreurs).

## Correctifs v0.6.1 (retour utilisateur du 2026-10-12)
- **« Phrase d'essai » entendue en cours de vidéo** : les publicités YouTube passent dans le même élément `<video>` (classes `ad-interrupting` ou `ad-showing` sur `#movie_player`), avec leur propre temps (0 à 202 s, observé sur une vraie pub). Le lecteur jouait donc le passage de 0:19 (« La plupart des explications sur les agents IA… »). Désormais, doublage et sous-titres se taisent pendant les pubs, puis se recalent à la reprise, et le pilotage ne génère rien pendant une pub.
- **Passages pas encore prêts** : avec l'option « attendre la voix » (activée par défaut), la vidéo se met en pause juste avant un passage sans audio, avec le badge « ⏳ Doublage en préparation… », et repart à l'arrivée de l'audio. Ce passage est généré en priorité. Vérifié avec une horloge simulée : pause 0,2 s avant le passage, reprise à l'arrivée de l'audio.
- **Voix qui change d'un passage à l'autre** : le repli automatique entre modèles Gemini (2.5, 3.1, 3.8, aux timbres différents) est supprimé pendant un doublage. Un seul modèle est utilisé pour toute la vidéo, avec 4 essais (attentes de 3, 6, puis 9 s) ; si son quota est épuisé, le doublage bascule sur Piper avec un message.

## v0.7 — Une voix par intervenant
- `detectSpeakers` : 1 requête Gemini par vidéo (gratuite), avec la vidéo (fps 0.1, basse résolution) et les sous-titres d'origine numérotés `[n] (m:ss) texte`. Réponse `S1 | homme | rôle` puis `[n] S1` ; un numéro manquant reprend l'intervenant précédent. Mise en cache `speakers:<id>`, valable tant que la liste de sous-titres ne change pas.
- Essai réel (BBC, 4:50, 60 sous-titres) : en 9 s, Hannah Fry (femme, 28 sous-titres), Jacob (homme, 28) et un extrait d'ouverture (homme, 4) ; les échanges rapides (« Come in, please » / « Hi » / « Hi, Hannah ») sont bien attribués ; la voix de synthèse « Iva » n'est pas séparée de Jacob.
- `assignVoices` : réserves de voix par genre (Gemini : Charon, Puck, Orus, Fenrir / Kore, Aoede, Leda, Zephyr ; Piper fr : Tom, Gilles / Siwis, UPMC). La voix choisie dans les options sert au premier intervenant de son genre ; s'il manque des voix, on recommence la liste. Le navigateur garde une seule voix.
- `planDubGroups` ne regroupe jamais deux intervenants. `buildCues` coupe à chaque « >> » (changement d'intervenant dans les sous-titres YouTube) et retire ce marqueur, qui aurait été lu à voix haute.
- Worker Piper : une session par voix ; on alterne sans rechargement (1,2 à 1,4 s par phrase après le premier chargement).
- Option « Une voix par intervenant », activée par défaut si une clé Gemini existe. En cas d'échec de l'identification, le doublage continue avec une seule voix.
