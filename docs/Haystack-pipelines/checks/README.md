# Pipeline verification scripts

Offline, no deepset and no OpenSearch. They read the YAML directly, so they check
the file that gets deployed and not a copy of it. Put the YAMLs next to the scripts.

    python3 verify9k.py    # contract vs 9i, wiring, prompt, every code block compiles
    python3 runtime9k.py   # executes the components against haystack stubs

`verify9k.py` needs v1-agent-9k.yaml, v1-agent-9j.yaml and v1-agent-9i.yaml (it
asserts what 9k undoes and what it keeps). `runtime9k.py` needs only 9k.

The older 9j pair (verify.py / runtime_test.py) is kept for reference.

## What these caught

- 9j build: with `question_shape` absent or null both gates emitted an empty query
  and silently dropped the second layer - the exact regression the draft existed to
  prevent, invisible in a trace. Gates were changed to fail safe.
- 9j production: the runtime test used fixtures where pdf/docx twins were nearly
  identical, so it validated the twin-key assumption instead of challenging it. The
  real chunks share no content prefix at all. Lesson kept in 9k: fixtures for a
  dedup or matching rule must come from a trace, not from the author.
- 9k build: `runtime9k.py` replays the actual failing inputs - the reordered
  "SIDE III MC1" pattern, a 491-file listing, an empty search result - rather than
  synthetic ones.
