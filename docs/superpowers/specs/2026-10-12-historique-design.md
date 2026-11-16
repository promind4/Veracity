# Veracity v0.8 — Historique des vidéos et index de la base

Date : 2026-10-12 · Statut : demandé par l'utilisateur

## Historique (onglet du side panel)
- Reconstitué à partir du cache de l'extension (`buildHistory`) : clés `video:`, `report:`, `chat:`, `translation:<id>:<langue>`, `meta:`, `speakers:` et `visit:` (date de consultation, notée à chaque ouverture d'une vidéo dans le panneau). Une vidéo connue seulement par son rapport y figure aussi.
- Tri par dernière activité (visite, analyse, question, traduction).
- Chaque fiche affiche : la miniature (`i.ytimg.com`, compatible avec l'isolation multi-origine car le serveur répond avec CORP cross-origin), le titre, la chaîne, la durée, une date relative, et des pastilles « Faits x % » et « Discours y % » colorées (le libellé du verdict au survol). On y voit aussi la catégorie, le nombre de questions, les traductions, la transcription audio et le nombre d'intervenants.
- Recherche insensible aux accents (titre, chaîne, catégorie, mots-clés) ; filtres par catégorie et par type (analysées, avec discussion, traduites).
- Un clic ouvre la vidéo (dans l'onglet YouTube courant, sinon dans un nouvel onglet) sur l'onglet Rapport. 🗑 efface les données de la vidéo dans l'extension, pas les fichiers de la base.
- Sans vidéo ouverte, le panneau affiche l'historique ; dès qu'une vidéo s'ouvre, il revient sur le Rapport.

## INDEX.md de la base de connaissances
- `scanKb` parcourt `<base>/<catégorie>/<vidéo>/` et lit l'en-tête YAML (`parseFrontMatter`) de `rapport.md`, sinon de `transcription.md`.
- `buildKbIndex` produit une table des matières par catégorie (ordre alphabétique) : pour chaque vidéo (la plus récente d'abord), le titre avec un lien vers son premier fichier, la chaîne, la date, le verdict et les scores, puis les liens vers tous ses fichiers, les mots-clés et l'URL. Les liens utilisent la forme `<chemin avec espaces>`.
- Mise à jour après chaque enregistrement et chaque changement de catégorie, ainsi qu'à la demande (bouton de l'onglet Historique).
- Vérifié sur un système de fichiers réel (OPFS, même API que le dossier choisi) : écriture des fichiers, déplacement de catégorie avec suppression de la catégorie vide, contenu de l'index.
