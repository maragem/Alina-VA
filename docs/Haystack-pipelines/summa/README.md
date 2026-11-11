# SUMMA / P.A.C.I.O.L.I. pipelines

Start with `PROPOSAL.md`: the main pipeline, the four tool sub-pipelines, the indexing
pipeline, what to fill in and the deployment order.

- `summa-agent-draft-1.yaml`: the first agent pipeline, written by hand before the kit
  existed, against the live index `pacioli-chat` (e5-base-v2, 768). Kept as shared with the
  SUMMA developer; `checks/` are its own offline checks. Frozen.
- `generated/summa-agent.yaml` and `generated/pacioli-indexing.yaml`: the maintained
  pipelines, generated from `../kit/configs/summa.yaml` (multilingual-e5-large, 1024, Docling
  indexing, vocabulary, system description, Q&A from `../kit/qa/summa.yaml`). Regenerate
  after any config change:

```
cd ../kit
python build_pipeline.py configs/summa.yaml -o ../summa/generated/summa-agent.yaml --tools-dir ../summa/generated/tools --check
python build_indexing.py configs/summa.yaml -o ../summa/generated/pacioli-indexing.yaml --check
```

Before deploying the generated agent: set `store.index` in the config to the real name of
the index the Docling indexer writes to, fill `../kit/qa/summa.yaml`, and follow the
verification order in the kit README.

## Files to prepare besides the pipelines

| File | Purpose | Format |
|---|---|---|
| `../kit/qa/summa.yaml` | curated Q&A the agent consults first (guidance, never cited) | YAML list of question / answer / sources, or a CSV with those columns |
| `eval/golden-questions.yaml` | the evaluation set every version is run against | see the template; 30 questions from real tickets |
| `files-metadata.template.csv` | optional: `doc_type`, `version`, `document_date` per file, attached as file metadata at upload | CSV; upload metadata always wins over the file-name rules in the config |

The vocabulary (synonyms, glossary) and the system description are text in
`../kit/configs/summa.yaml`, not separate files.
