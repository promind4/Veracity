# Veracity v0.3 — Base de connaissances (D:\BDD YOUTUBE)

Date : 2026-10-12 · Statut : validé par l'utilisateur

## Objectif
Ranger automatiquement rapports, discussions et transcriptions (Markdown) par catégorie dans un dossier local, pour les réutiliser ensuite : synthèses, amélioration de process, import dans Obsidian ou NotebookLM.

## Contrainte Chrome
Une extension ne peut pas écrire en dehors du dossier Téléchargements avec `chrome.downloads`. On utilise l'API File System Access :
- l'utilisateur choisit le dossier une fois, dans les options (`showDirectoryPicker`) ;
- le handle est mémorisé dans IndexedDB, partagé par les options et le side panel ;
- si Chrome retire l'autorisation (après un redémarrage), le panneau affiche un bouton « Autoriser », car un geste utilisateur est requis.

## Arborescence
`<base>/<Catégorie>/<Titre nettoyé> [<videoId>]/{rapport,discussion,transcription}.md`

Chaque fichier commence par un en-tête YAML : type, titre, chaîne, url, video_id, durée, catégorie, tags, date d'enregistrement, verdict et scores.

## Catégorisation
- **Pendant l'analyse** : les champs `category` et `tags` sont ajoutés au premier appel LLM (aucune requête supplémentaire). Le modèle reçoit les catégories existantes (sous-dossiers de la base) et doit en réutiliser une si elle convient.
- **Sans analyse** (discussion ou transcription seule) : `categorizeVideo`, 1 requête au premier enregistrement.
- `normalizeCategory` rattache la proposition à une catégorie existante en ignorant la casse, les accents et la ponctuation, et retire les caractères interdits sous Windows.
- La catégorie retenue est mémorisée par vidéo (`meta:<id>`). Le bouton « Modifier » la change et déplace le dossier déjà écrit ; l'ancienne catégorie est supprimée si elle devient vide.

## Enregistrement
- **Automatique** (option, activée par défaut) : le rapport à la fin de l'analyse, la discussion après chaque réponse. La transcription est écrite à chaque enregistrement.
- **Manuel** : « Exporter (.md) » du rapport et de la discussion, « Télécharger .md » de la transcription, et « 💾 Enregistrer » dans la barre de catégorie. Sans dossier configuré, les exports sont téléchargés comme avant.

## Hors périmètre
Index global de la base, synthèses multi-vidéos, transcription audio.
