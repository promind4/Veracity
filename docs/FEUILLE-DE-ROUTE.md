# Veracity — refonte et préparation à la publication

## Objectif et décisions

Améliorer l'extension Chrome existante en reprenant la deuxième maquette validée : interface sombre anthracite, texte clair, turquoise et ambre, typographie sans empattement et présentation lisible des scores et des sources. La maquette est une référence visuelle, pas une spécification fonctionnelle : conserver les fonctionnalités existantes et adapter les éléments à la largeur réelle du panneau Chrome.

L'extension analyse des vidéos YouTube ; ses résultats peuvent être erronés. Présenter les scores et leur niveau de fiabilité avec nuance, et garder les sources accessibles. La mise en ligne sur le Chrome Web Store est l'objectif final ; préparer et vérifier le dossier avant toute soumission.

## Liste de tâches

### 1. État des lieux et préparation

- [ ] Inventorier les vues et états existants : rapport, discussion, transcription, lexique, historique, chaînes et options ; relever les fonctionnalités et les limites actuelles.
- [ ] Vérifier le rendu de départ dans Chrome et identifier les contraintes de largeur, de hauteur et d'accessibilité.
- [ ] Résoudre ou contourner proprement le refus d'accès Windows qui a empêché les tests et la compilation ; noter les preuves.

### 2. Fondations visuelles

- [ ] Définir les couleurs, la typographie, les espacements, les bordures, les icônes et les états interactifs à partir de la maquette sombre.
- [ ] Adapter l'en-tête, la navigation, les boutons, les champs et les composants partagés au panneau latéral, y compris aux petites largeurs.
- [ ] Vérifier contraste, lisibilité, navigation clavier et états de focus ; ne pas dépendre uniquement de la couleur pour transmettre une information.

### 3. Rapport et parcours principal

- [ ] Revoir l'identité de l'extension, le contexte de la vidéo et la navigation principale.
- [ ] Recomposer les scores des faits et du discours, la fiabilité, la synthèse et les affirmations avec leurs sources et horodatages.
- [ ] Soigner les états avant analyse, en cours, sans résultat et en erreur ; préserver les actions existantes.
- [ ] Vérifier le fonctionnement sur une vidéo réelle, les liens de sources et les horodatages.

### 4. Autres écrans

- [ ] Harmoniser discussion et saisie des questions, transcription et traduction, ainsi que les commandes de sous-titrage et de doublage.
- [ ] Harmoniser lexique, révisions, historique, analyse de chaînes et paramètres ; vérifier les formulaires et les états vides.
- [ ] Vérifier que la sélection de texte, la sauvegarde, la restauration et les données existantes continuent de fonctionner.

### 5. Vérification complète

- [ ] Exécuter compilation, vérification TypeScript et tests ; corriger les régressions et consigner les résultats.
- [ ] Tester dans Chrome l'installation non empaquetée, les parcours principaux, les erreurs et les différents formats de panneau.
- [ ] Faire une revue distincte de l'interface, de l'accessibilité, des permissions, du stockage et des services externes ; relever les limites non vérifiées.

### 6. Préparer la publication

- [ ] Examiner les exigences actuelles du Chrome Web Store et vérifier le manifeste, les permissions et leurs justifications.
- [ ] Documenter les données traitées et transmises, la gestion des clés API, les coûts éventuels et les limites de l'analyse ; préparer une politique de confidentialité adaptée.
- [ ] Préparer l'icône, les captures réelles, la description, la catégorie et les autres éléments exigés par le Store.
- [ ] Générer et vérifier le paquet final, mettre à jour la documentation, puis préparer la fiche pour revue avant soumission.

## État et preuves

- Référence visuelle : deuxième proposition sombre validée dans la conversation.
- Existant observé : panneau avec cinq onglets et styles clair/sombre ; fonctionnalités supplémentaires décrites dans le README.
- Blocage connu : les commandes de test et de compilation ont échoué précédemment avec une erreur d'accès Windows ; à réexaminer avant de conclure qu'elles fonctionnent.
- Première passe réalisée : palette sombre turquoise et ambre, en-tête, navigation et cartes de scores ; les autres écrans héritent des couleurs communes. Rendu et interactions restent à vérifier dans Chrome.
- Vérification TypeScript et compilation réussies en lançant Node directement ; `npm` était bloqué par les permissions du profil Windows. La compilation signale des modules Node externalisés dans Piper, dont le fonctionnement en navigateur reste à tester.
- Tests automatisés : 24 fichiers et 225 tests réussis. La validation fonctionnelle et visuelle dans Chrome reste à faire.
- Paramètres : première harmonisation avec le thème sombre et contrôle visuel statique dans Chrome ; compilation réussie. Les interactions et les données réelles n'ont pas été testées dans l'extension chargée.
- Le fichier de référence UI/UX fourni n'a pas pu être matérialisé : l'outil de transfert échoue sur Windows. Ses instructions n'ont donc pas été appliquées.

## Retours avant production — 18 novembre 2026

À traiter dans cet ordre :

1. Transcription d’origine : utiliser les métadonnées des pistes audio pour éviter de prendre le premier doublage ; retirer une éventuelle traduction `tlang` de l’URL. Correction locale et test automatisé ajoutés. Vérification réelle sur vidéos FR/EN et multilingues à faire ; sans métadonnées audio, le choix reste une estimation.
2. Dossier d’enregistrement : ajouter « Choisir le dossier » à côté de « Modifier » dans le panneau. Le nom affiché provient du dossier sélectionné par chaque utilisateur. Vérifier sélection, annulation, réautorisation et sauvegarde dans Chrome. Changer le dossier ne déplace pas les anciens documents.
3. Classement des vidéos : auditer réutilisation des catégories existantes, normalisation des synonymes et cohérence entre rapport, transcription et discussion. Préserver les choix manuels et les dossiers existants.
4. Lexique : contrôler domaines, sous-catégories, synonymes et doublons ; distinguer les concepts proches sans les fusionner automatiquement. Exemples à examiner : Informatique, Informatique créative, Intelligence artificielle, Infographie 3D. Conserver les statuts connus/à apprendre et les liens aux vidéos.
5. QCM : adaptation et progression à traiter ensuite.

Constat du classement actuel : les domaines du lexique sont rapprochés par leur écriture normalisée, mais les synonymes sémantiques ne sont pas rapprochés. Les domaines déjà utilisés sont proposés au modèle. Une revue dédiée reste nécessaire avant toute migration des données.

## Avancement — classement et sélection des modèles

- [x] Catégorisation vidéo : consulter début, milieu et fin plutôt que le seul début ; consignes sur le sujet principal et exclusion des sponsors passagers du classement.
- [x] Réutiliser les synonymes explicites de domaines (IA/intelligence artificielle, ML/apprentissage automatique), sans fusionner les spécialités ni déplacer les anciens dossiers.
- [x] Lexique : rattacher un nom développé à une fiche existante uniquement dans un domaine équivalent et si le rapprochement est unique ; conserver statut, révisions, définition et liens existants.
- [x] Ajouter aux paramètres une liste ordonnée de modèles Gemini pour l’analyse ; conserver les valeurs par défaut tant que les comparaisons ne démontrent pas un gain.
- [ ] Comparer en conditions réelles les modèles disponibles pour le compte. La génération récente d’un modèle ne garantit pas sa qualité de vérification ; aucun remplacement automatique par « 3.5 » n’a été effectué.
- [ ] Tester dans Chrome les classements et les rapprochements sur de nouvelles vidéos, ainsi que le choix du dossier.
- [ ] Auditer les anciennes catégories et proposer une migration explicite si nécessaire ; aucun déplacement de données existantes effectué.
- Alertes : le message de lecture impossible correspond à une requête échouée, pas à un score inférieur à 100 %. Conserver les alertes concrètes ; étudier leurs causes sur une vidéo réelle avant de les masquer.
- TypeScript et compilation réussis ; extension reconstruite dans dist.

## Paramètres avant production — 18 novembre 2026

- [x] Analyse : priorité Gemini/OpenRouter configurable ; ordre des modèles et repli explicites. La deuxième clé Gemini peut servir seule.
- [x] Séparer les clés de fournisseurs des identifiants de modèles. Préciser qu’une clé directe xAI/NVIDIA/OpenAI ne fonctionne pas dans le champ OpenRouter. Grok reste utilisable via un modèle disponible sur OpenRouter ; pas d’intégration de clé xAI directe.
- [x] Recherche : services désactivables sans effacer les clés, explication de la cascade habituelle et des recherches récentes en parallèle ; mode récent économique en cascade disponible.
- [x] Rapports nouveaux : détails des modèles d’extraction/vérification et des appels/échecs de Serper, Jina Search, ScraperAPI, Fact Check et Jina Reader. Ce suivi ne mesure ni les crédits ni les coûts et ne reconstruit pas l’utilisation passée.
- [x] Doublage : libellés indépendants de Windows, téléchargement/cache de Piper et repli Gemini vers Piper expliqués, suppression des promesses de gratuité et synchronisation garantie.
- [x] Tests : 234 tests réussis, dont ordre des fournisseurs, repli après clé refusée, clé Gemini secondaire seule, désactivation ScraperAPI et recherche récente économique.
- [ ] Validation visuelle et interactions réelles dans Chrome sur les paramètres rechargés.
- [ ] Unifier éventuellement discussion/lexique/traduction avec la priorité d’analyse ; le formulaire précise leur priorité Gemini actuelle. Pas de classement automatique des modèles par qualité sans comparatif.
- [ ] Tester les modèles sélectionnés avec des vidéos de référence et les clés du compte ; aucun appel facturé réel pendant cette modification.
