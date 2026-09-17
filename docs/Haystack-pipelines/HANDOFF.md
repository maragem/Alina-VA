# ALINA - passation pour une session sans contexte

Lis ce fichier avant de toucher à quoi que ce soit. Il te donne l'état au 09/09/2026, après
le run de validation de la 9k, et ce qu'il reste à faire.

## 1. Le projet

ALINA est un RAG pour l'unité procurement DIGIT.R3 de la Commission européenne.
Pipeline Haystack déployée sur deepset, modèle `gpt-5.1` via la gateway ECGPT
(`/chat/completions`, PAS `/responses` qui ne fait pas de tool calling).
Architecture : un Agent avec 4 outils - `consult_reference_qa` (34 Q&A expertes
embarquées, jamais citables), `list_corpus_files`, `search_corpus`, `search_in_file`.
Corpus d'environ 491 fichiers indexés dans OpenSearch (`ALINA-V0.3`).

Fichiers, tous dans `docs/Haystack-pipelines/` :

- `v1-agent-9k.yaml` - version courante, déployée
- `v1-agent-9j.yaml`, `v1agent9i.yaml` - historiques, gardés pour les diffs
- `v1-agent-9j-patch.md` - le raisonnement derrière la 9j
- `checks/verify9k.py`, `checks/runtime9k.py` - vérif offline, sans deepset ni OpenSearch
- `indexing-v06.yaml` - pipeline d'indexation, PAS encore corrigée (voir §5)

L'en-tête de `v1-agent-9k.yaml` fait environ 200 lignes de commentaires numérotés
(notes 1 à 27). C'est le journal d'ingénierie du projet et il est fiable : chaque note
porte la mesure ou la trace qui la fonde. Lis-le, ne le réécris pas, ajoute à la suite.

## 2. Le dispositif d'évaluation, et son piège

30 questions "GoldenStandards" (GS-001 à GS-030), rejouées à chaque version, exportées
en xlsx avec les colonnes `Expected Answer`, `Actual Answer`, `Actual Sources`,
`Comment` (le commentaire humain d'origine, par Iván GUERRA de DIGIT.R3).

**Le scoring automatique du fichier est inutilisable. Ne t'en sers pas.** Preuve : les
trois plus bas `Answer Score` d'un run (0.337, 0.358, 0.364) étaient trois réponses qui
reproduisaient la réponse attendue mot pour mot. `Source Score` pénalise un `.docx`
retourné là où un `.pdf` était attendu (même document) et un refus correct sans source
attendue. Juge toi-même, en comparant `Actual Answer` à `Expected Answer` et au
`Comment` humain.

La colonne `Actual Answer` contient les traces d'outils en préfixe
(`**Tool Use:** {json}`). Elles viennent du harness d'export, pas de la pipeline.
Parse-les, elles sont la meilleure source d'information sur le comportement de l'agent.
Attention : les appels `list_corpus_files` n'y apparaissent pas toujours, donc "zéro
appel d'outil" dans l'export ne veut pas dire zéro appel. Demande la trace deepset.

Les traces deepset (JSON) sont ce qui a permis tous les vrais diagnostics. Demande-les
à l'utilisateur pour tout cas douteux. Structure : `haystack_trace.traces` est une liste
de spans plats, chacun avec `component`, `duration_ms`, et `tags['haystack.component.input'
/ 'output']` qui contient les documents et les messages complets.

## 3. La taxonomie des échecs, et où elle en est

Établie sur le premier jeu de 30 tests, 17 FAIL.

- **G1 citation/référence** (6 cas) - réponse correcte, citation fausse. Partiellement
  irréparable côté requête, voir §5.
- **G2 hiérarchie des sources** (4 cas) - répond depuis la guidance au lieu du texte
  primaire. **Périmètre réduit le 09/09** : DIGIT.R3 a tranché qu'un document qui en cite
  un autre est une réponse valide et correctement attribuée. GS-002 et GS-026 ne sont
  donc plus des échecs. Il ne reste que les cas où la substance diffère selon la source
  (GS-006 corrigé, GS-014, GS-016).
- **G3 retrieval** (3 cas) - résolu depuis la 9g/9i sauf GS-027.
- **G4 couverture partielle** (GS-001), **G5 réponse non ancrée** (GS-006, corrigé en
  9j/9k), **G6 sur-inférence de contexte** (GS-024, corrigé).

## 4. Les trois dernières versions, en une ligne chacune

**9i** - état de référence. 6 FAIL corrigés sur 17, 1 régression (GS-005).

**9j** - a ajouté une seconde couche d'autorité dans les deux outils de recherche, gatée
par un paramètre `question_shape` déclaré par le modèle. Résultat : 10 améliorés,
13 stables, **7 régressés**. Cause : les messages du formatter disaient au modèle
« no further search is needed » et « the provision above is the complete answer ».
Ce sont des signaux d'arrêt. Le modèle a arrêté de chercher, et le nombre de requêtes
distinctes est ce dont dépendait la qualité du retrieval.

**9k** - annule ça. Voir §6.

## 5. Ce qui NE PEUT PAS être corrigé dans cette pipeline

Deux points bloqués en amont. Ne perds pas de temps à les contourner côté requête,
c'est déjà fait et ça échoue.

**a) Le Financial Regulation n'a aucune métadonnée structurelle.** Mesuré sur les
113 chunks distincts vus dans les traces : `header` vaut le titre de l'acte, identique
octet pour octet partout, `parent_headers` vaut `[]`. Le découpage est fait à la taille,
à travers les frontières de dispositions - un chunk cité contenait les en-têtes des
Articles 173, 174 et 175. 42 % des chunks ne portent aucun marqueur, 9 % en portent
plusieurs. Conséquence : le modèle ne peut pas savoir si un passage relève de
l'Article N ou du point N de l'Annexe I, et les deux séries se recouvrent. C'est la
cause de #UX042 (GS-025). **Le correctif est dans `indexing-v06.yaml` + une
réindexation.** J'ai essayé une règle de prompt en 9j, elle a rendu GS-025 pire.

**b) Les doublons pdf/docx du corpus.** Certains documents sont indexés deux fois.
Ce ne sont pas deux conversions du même document : entre les chunks pdf et docx de
`Liquidated Damages Application Guidance`, zéro préfixe de 300 caractères commun,
similarité maximale 0,08, longueurs de chunks 1137-1715 contre 1913-3187. Les copies
`.docx` contiennent du HTML brut et du quoted-printable
(`</li> <li>fill in the excel tracker hosted <a href=3d"https://teams.microsoft.co= m/l/`)
là où les `.pdf` sont propres : 40 % de chunks contaminés dans ces fichiers contre 4 %
ailleurs, et ça suit l'extension `.docx`, pas le `+` du nom. **Aucune clé de
déduplication côté requête ne peut les rapprocher, j'ai essayé en 9j et ça a empiré.**
Le correctif est de retirer ou réingérer ces `.docx`. C'est probablement ce que visait
#UX039.

## 6. Ce que la 9k a changé, et ce qu'il faut vérifier au prochain run

1. **Suppression des signaux d'arrêt.** Chaque branche des deux formatters se termine
   en nommant la condition sous laquelle il faut relancer une recherche. Sur résultat
   vide : « That is a result about the QUERY, not about the document ». Le prompt gagne
   « No tool result is ever a licence to stop searching ».
2. **`guidance_gate` supprimé.** La couche BM25 tourne toujours (21 ms, contre 15 à 31 s
   pour les rerankers). `question_shape` arrive dans le formatter et ne décide plus que
   du nombre de passages affichés, 8 en practical, 4 en lookup. Le padding est un
   problème de génération, la 9j en avait fait un problème de retrieval.
3. **Couche RF de `search_corpus` retirée** - sa justification était GS-002/GS-026,
   désormais valides. Cet outil est identique à la 9i.
4. **`list_corpus_files`** : matching par tokens dans n'importe quel ordre
   (`"SIDE III MC1"` trouve `... - MC1 - SIDE III.pdf`), cap relevé de 400 à 600 pour
   couvrir les 491 fichiers, et un listing tronqué interdit désormais explicitement de
   conclure à l'absence d'un document.
5. **Retirés** : twin collapse, règle de label. **Gardé** : `[O2]`, la pipeline ne
   renvoie plus que la réponse réécrite.

**RÉSULTATS DU RUN 9k (fichier `alinauatfinalrun.xlsx`), déjà mesurés :**

- Source attendue citée : **20/27 en 9i, 24/27 en 9k**. Zéro erreur d'infra.
- Requêtes distinctes : 75 en 9i, 59 en 9j (les régressions), **70 en 9k**. L'indicateur
  est revenu.
- Latence moyenne : 83,5 s en 9i, 70,9 s en 9j, **37,5 s en 9k**, max 57,6 s contre 229 s
  en 9i.
- Les 4 régressions 9j : **GS-008 corrigé** (article verbatim, le fix du lister a marché),
  **GS-029 corrigé** (retour aux DPS Tender Specs), **GS-010 partiel** (identifie ENISA
  mais pas Heraklion ni Ares, la 9i faisait mieux), **GS-014 TOUJOURS FAUX**.
- Bonus : **GS-005 meilleur qu'en 9i** (nomme et définit le multiple sourcing depuis le
  Point 47 de l'Article 2, la source attendue), **GS-001 corrigé** (utilise enfin le DPS
  Launch checklist comme document directeur), **GS-027 corrigé** (répond aux deux moitiés
  de la question, ce que visait le check 5 « Coverage »), **GS-016 nettement amélioré**
  (cite l'Article 167, la domination des seuils action extérieure a disparu).

## 6bis. Ce qui reste ouvert - commence par là

1. **GS-014, le seul cas où la réponse est juridiquement FAUSSE.** ALINA répond « Yes,
   including EPSO as a contracting authority is consistent with the applicable rules ».
   La bonne réponse est l'inverse : EPSO, OLAF, OIB, PMO n'ont pas la personnalité
   juridique et ne peuvent pas rejoindre seuls un appel interinstitutionnel. C'est dans
   le Vademecum section 2.4, qui n'est toujours pas récupéré. Mesuré sur la trace
   11f1123c : le Vademecum ÉTAIT parmi les 48 candidats (4 chunks) mais aucun ne portait
   sur la participation interinstitutionnelle, et le reranker a gardé un top-10 composé
   uniquement des DPS Tender Specifications, qui disent l'inverse. C'est un problème de
   couverture de retrieval sur un document précis, pas de raisonnement. Priorité 1.
2. **GS-010** : la 9i récupérait `List of EUIs_04.2025.xlsx` et répondait Heraklion +
   Ares, la 9k ne fait qu'un appel `search_corpus` et s'arrête au Cybersecurity Act.
   Regarde pourquoi l'agent ne liste plus les fichiers sur cette question.
3. **GS-016** : plus de Vademecum section 3.1 ni de point 14 de l'Annexe I. Même famille
   que GS-014.
4. **GS-025** : « Point 174 » au lieu de « Article 174 ». Bloqué en amont, voir §5a.
5. **Les doublons pdf/docx** : 7 questions sur 30 en 9k. Inchangé et attendu, la 9k a
   retiré la tentative de correction côté requête. Voir §5b, c'est de l'ingestion.

## 7. Méthode - ce qui a coûté cher

- **Ne propose pas de correctif avant d'avoir la trace.** Deux de mes cinq correctifs
  9j étaient faux et les traces les ont invalidés en dix minutes.
- **Les fixtures d'un test doivent venir d'une trace, pas de toi.** Mon test unitaire
  de la déduplication utilisait des jumeaux que j'avais écrits quasi identiques : il a
  validé mon hypothèse au lieu de la contester, et le correctif est parti en production
  cassé.
- **Une règle de prompt répétée trois fois et ignorée trois fois ne se corrige pas en
  l'écrivant une quatrième.** C'était le constat qui a mené à la 9j. Il reste juste,
  mais la 9j montre l'erreur symétrique : un mécanisme mal formulé fait autant de dégâts
  qu'une règle ignorée.
- Fais tourner `checks/verify9k.py` et `checks/runtime9k.py` après toute modification.
