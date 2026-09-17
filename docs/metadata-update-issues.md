# Authority Metadata Update — Manual Follow-up Required

Generated from the output of `scripts/update-authority-metadata.py` run against
the `DIGIT_R3_ALINA` workspace on 2026-07-28.

**Result of the run:** 468 files updated successfully, 0 API failures.
The three issues below were **not** updated and need manual attention.

---

## 1. Duplicate file names in the workspace (17 names, 34 files)

**Problem:** Each of these file names exists **twice** in the deepset
workspace, uploaded as two separate files with two different `file_id`s. The
script matches local files to deepset files **by file name**, so when a name
is ambiguous it cannot safely decide which of the two uploaded copies should
receive the `authority_rank` / `authority_category` metadata — tagging the
wrong one would misclassify a document. Both copies of every name below were
**skipped entirely**.

**Why it happened:** most likely the same source file was uploaded twice
(e.g. once during an earlier ingestion pass and once during this batch), or
two genuinely different documents in the source folder happen to share a
file name.

**Action needed:** for each name, open both files in deepset Cloud, determine
whether they are true duplicates (delete one) or different documents that
happen to share a name (rename one so future syncs are unambiguous), then
re-run the update script — or set the metadata by hand for the correct
`file_id`.

| File name | file_id #1 | file_id #2 |
| --- | --- | --- |
| C-6_15_2016 best value for money.docx | `2b96a553-630b-479a-a050-a582ddaadc10` | `94480971-0954-44c1-9e06-293df87cf60e` |
| T-589_08_ED_2011_statetement_reasons_award criteria.doc | `788c544e-fef2-491a-9989-21034bcfbbcc` | `3a9ceda0-7f27-44e4-b640-879738a506c3` |
| C-927_19_comments PPLR.docx | `2b6cf576-4b8c-410b-a798-84eaa0e92a5d` | `eb038ba2-d4b4-41bf-a59f-e6181a0d04fb` |
| T-439_17_statement of reasons_coherence between comments and the numerical score_EN.pdf | `c1fd7428-6667-43d3-98e8-753018f99145` | `1d32dc34-6991-4b4b-a418-efa7a5e19852` |
| T-661_18_Securitec_FR.pdf | `46756e7b-3c27-4191-88f1-3f505bf39802` | `c54aad44-4311-4cef-bcac-42916e01de28` |
| T‑661_18_2020_Securitec_abstract.docx | `db2df699-29e0-4cf8-b600-e45127ca958a` | `79583aae-a059-4231-990a-711bfc051516` |
| T‑661_18_2020_wrong formulation of selection criteria.docx | `60a3cf20-b267-4ebd-bb78-a5c6c62f41c5` | `ac4a1743-f7dc-4d95-b388-12f53ff972db` |
| T-367_21 Cervantes EC.docx | `4363dceb-8c73-446a-99d8-2bb05d0b2a8c` | `43f8b01e-d066-4101-a67a-090f32774fdc` |
| Meetings with economic operators (DIGIT 2024.05).pdf | `7eceaac6-9bb4-4e29-8bdb-3495c1e30f2a` | `0caf1b1c-0f7b-49ae-be77-33e7584f3391` |
| Signature requirements.pdf | `30cabf7c-20ef-4173-9b8e-56fde7ec2e0d` | `4c7fe9b7-8d78-4ac0-9a0b-0fcc465e9406` |
| Verification of non-exclusion.pdf | `3e317ea4-a00b-46ef-9eca-656f82bee759` | `bf8a0d3f-af02-4146-baba-72af44de447e` |
| DPS Tender Specifications v1.3 - ALINA.docx | `e28317b5-a467-43ec-a101-4febccd79027` | `cbe180ec-a306-40c3-a7eb-b31c47e1050d` |

> Note: `C-6_15_2016 best value for money.docx`, `T-589_08_ED_2011_statetement_reasons_award criteria.doc`,
> `C-927_19_comments PPLR.docx`, `T-439_17_statement of reasons_coherence between comments and the numerical score_EN.pdf`,
> and `T-367_21 Cervantes EC.docx` appeared twice in the script's warning output (12 unique names total, 5 of which
> were logged twice) — the table above already de-duplicates the log lines, so it lists all 12 distinct names found.

---

## 2. Local files not found in the workspace (15 files)

**Problem:** These 15 files exist in the local hierarchized source folder
(`~/Downloads/1.1 Data Hierarchized`) and are listed in
`docs/authority-metadata.json`, but **no file with a matching name exists in
the deepset workspace**. Nothing could be tagged because there is no
`file_id` to target.

**Likely causes:** the file was never uploaded to deepset, was uploaded under
a different/renamed file name, or was deleted from the workspace after
ingestion.

**Action needed:** confirm whether each file should be in the corpus. If yes,
upload it (the existing `/documents` upload UI or the Files API), then re-run
`scripts/update-authority-metadata.py` — the script will pick it up
automatically on the next pass since matching is done by file name.

- `Level 1/Treaties & Charter/Consolidated version of the Treaty of the European Union.pdf`
- `Level 2/CJEU Caselaw/Case-law Summaries/100862AF.tmp` *(a `.tmp` file — likely not meant to be ingested at all)*
- `Level 2/EU Regulations/Cybersecurity Act_1st MPLEMENTING_REGULATION.PDF`
- `Level 2/EU Regulations/Cybersecurity Act_1st MPLEMENTING_REGULATION_ANNEX.PDF`
- `Level 3/BUDG Guidance/Vademecum Public Procurement.pdf`
- `Level 3/Contractual documents/Software project/Annex I - List of EUIs - ALINA.pdf`
- `Level 3/Contractual documents/Software project/Annex II to PASS - Standard DPA template ALINA.docx`
- `Level 3/Contractual documents/Software project/Annex III to PASS Agreement - Data Protection Questionnaire - ALINA.docx`
- `Level 3/Contractual documents/Software project/Draft Contract SIDE III DPS - MC1 -ALINA.docx`
- `Level 3/Contractual documents/Software project/PASS Agreement - ALINA.docx`
- `Unranked/Procurement documents/Software Project/1.0 DPS Specs SIDE III ALINA.pdf`
- `Unranked/Procurement documents/Software Project/SIDE III DPS Published answers - ALINA.pdf`
- `Unranked/Templates/BUDG_declaration-honour-FR Recast-December-version-2025-en.docx`
- `Unranked/Templates/DPS Stage 1 Questionnaire v3.docx`
- `Unranked/Templates/DPS Stage 2 Questionnaire v4.docx`

---

## 3. Loose files with no authority category (5 files)

**Problem:** These files sit directly inside the `Unranked/` folder, not
inside `Unranked/Procurement documents/` or `Unranked/Templates/`. Since
there is no second-layer category folder to map, `build-authority-metadata.py`
recorded `authority_category: null` and `authority_rank: null` for them, and
`update-authority-metadata.py` **skipped them by default** (they were not
sent to the API at all, so their existing deepset metadata is untouched).

**Action needed:** decide the correct classification for each file (move it
into an appropriate category folder and re-run the build script), or
explicitly confirm they should stay Unranked. If they should stay Unranked,
re-run with `--include-unmapped` to push `null`/`null` explicitly:

```bash
python3 scripts/update-authority-metadata.py --metadata docs/authority-metadata.json --include-unmapped
```

- `Unranked/BELGIUM - Nouveau Code des Sociétés  - Summary .pdf`
- `Unranked/COM(2025)5_1st report on application of the IPI.pdf`
- `Unranked/Commission style guide (SG 2021.04).pdf`
- `Unranked/Privacy statement for procurement (F&T 2025.05).pdf`
- `Unranked/rdue2024_1p217.pdf`
