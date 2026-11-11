# ALINA golden questions: what the repository knows

The golden set itself, `scripts/data/Golden_DataSet.xlsx` (30 questions, GS-001 to GS-030),
is **not in the repository**: `scripts/data/` is git-ignored and the file was never committed.
The application's UAT evaluation page (`src/lib/uatEvaluation.ts`) reads it with the columns
`Question ID`, `Question`, `Expected Answer`, `Expected Source (Document / Page / Section)`,
`Expected Citation`, and joins run exports on `Question ID` with a human `Comment` column.
To bring it into the repository as text, convert it with
`kit/tools/golden_from_xlsx.py Golden_DataSet.xlsx -o eval/alina-golden-questions.yaml`.

What the pipeline notes (9j patch, 9k header, handoff) record per question. Topics are
paraphrased from those notes, not the question wording; sources are those the notes name.

| ID | Topic as described in the notes | Expected / governing source named | Status after 9k |
|---|---|---|---|
| GS-001 | DPS launch: the DPS Launch checklist is the governing document; coverage of the whole question | DPS Launch checklist, point 6 | fixed in 9k |
| GS-002 | A Financial Regulation provision answered from the guidance that quotes it | FR provision via guidance | valid since 09/09 (quoting document accepted) |
| GS-003 | Same document expected as .pdf, cited as .docx | one document in two copies | scoring artefact, not a failure |
| GS-004 | Reached its expected source for the first time in 9j | not named | fixed |
| GS-005 | Definition of multiple sourcing | FR Article 2, point 47 | better than 9i in 9k |
| GS-006 | Answer built on ungrounded reasoning; FR searched directly | FR | fixed in 9j and 9k |
| GS-008 | Verbatim article from a draft contract template named by the user ("SIDE III MC1") | "2. Draft Contract template_v2 - MC1 - SIDE III.pdf" | fixed in 9k (lister) |
| GS-010 | ENISA as an EU body: seat (Heraklion) and Ares reference | List of EUIs_04.2025.xlsx; Cybersecurity Act | partial in 9k (9i did better) |
| GS-011 | A derogation sitting in a low-scoring neighbouring chunk | not named | addressed by the sentence window (v0.3) |
| GS-012 | Correct refusal, no expected source | none | passes; penalised only by the automatic score |
| GS-013 | Gained the vademecum as a source in 9j | Vademecum | improved |
| GS-014 | EPSO (and OLAF, OIB, PMO) as contracting authority in an interinstitutional procedure: they have no legal personality and cannot join alone | Vademecum section 2.4 (FR Article 168 context) | STILL WRONG: the only legally false answer; retrieval coverage problem, priority 1 |
| GS-015 | Infrastructure error in one run | | not a pipeline failure |
| GS-016 | Thresholds question; Article 167 and Annex I point 14, Vademecum 3.1 | FR Article 167; Annex I point 14; Vademecum 3.1 | clearly improved, same family as GS-014 |
| GS-018 | Reached its expected source for the first time in 9j | not named | fixed |
| GS-020 | Infrastructure error in one run | | not a pipeline failure |
| GS-021 | Infrastructure error in one run | | not a pipeline failure |
| GS-022 | Requesting clarifications from tenderers; pdf/docx twins in the sources panel | "Requesting clarifications" guidance | correct; twins are an ingestion problem |
| GS-024 | Liquidated damages; over-inference from context; ten parallel searches | Liquidated Damages Application Guidance | fixed |
| GS-025 | "Article 174" cited as "Point 174": Financial Regulation chunks carry no structural metadata | FR Article 174 | blocked upstream (indexing fix + re-index) |
| GS-026 | A named legal act ("under the AI Act") answered from the guidance quoting it | AI Act via guidance | valid since 09/09 |
| GS-027 | Two independent asks in one question; first half dropped by the first query | not named | fixed in 9k (coverage check) |
| GS-029 | Provisional admission to a DPS before evaluation of the request is complete | DPS tender specifications (SIDE III), section 3.4; FR Annex I point 9.2 | fixed in 9k |

Not mentioned anywhere in the notes: GS-007, GS-009, GS-017, GS-019, GS-023, GS-028, GS-030.
Results that were measured on the whole set: expected source cited on 24 of 27 scorable
questions in 9k (20 of 27 in 9i), 70 distinct queries, mean latency 37.5 seconds.
