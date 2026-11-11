import base64
import json
import math
import re
import zlib
from haystack import component

# Curated expert Q&A entries, one dict per entry:
#   {"question": "...", "answer": "...", "sources": ["Document, section"]}
# Static reference material embedded in the tool on purpose: no document store,
# no ingestion, and the entries never enter agent state, so they can never be
# cited as a source. The builder fills this from the config.
QA_ENTRIES = []  # KIT:qa_entries

STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "by",
    "is", "are", "be", "was", "were", "it", "this", "that", "these", "those",
    "i", "we", "you", "my", "our", "your", "do", "does", "did", "can", "could",
    "should", "would", "how", "what", "which", "when", "where", "who", "why",
    "please", "need", "want", "there", "from", "as", "at", "if", "not", "no",
    "me", "us", "about", "into", "via", "also", "any",
}
# Domain words so common they carry no signal (e.g. the system's own name).
DOMAIN_STOPWORDS = set()  # KIT:domain_stopwords
TOP_K = 3  # KIT:qa_top_k
MAX_ANSWER_CHARS = 6000
EMPTY_MESSAGE = (
    "No reference Q&A entries are configured in this deployment. "
    "Proceed directly to search_corpus or search_in_file."
)
NO_MATCH_MESSAGE = (
    "No reference entry matches this question. That says nothing "
    "about the corpus: search it with search_corpus."
)

def _tokens(text):
    out = []
    for tok in re.findall(r"[a-z0-9]+", (text or "").lower()):
        if tok in STOPWORDS or tok in DOMAIN_STOPWORDS or len(tok) < 2:
            continue
        # crude stemming: plural / verbal endings
        for suffix in ("ations", "ation", "ings", "ing", "ies", "ly", "es", "s", "ed"):
            if tok.endswith(suffix) and len(tok) - len(suffix) >= 4:
                tok = tok[: -len(suffix)]
                break
        out.append(tok)
    return out

# Pre-tokenize once at import.
_INDEX = []
for _e in QA_ENTRIES:
    q_toks = _tokens(_e["question"])
    a_toks = _tokens(_e["answer"] + " " + " ".join(_e.get("sources", [])))
    a_tf = {}
    for t in a_toks:
        a_tf[t] = a_tf.get(t, 0) + 1
    _INDEX.append({"q": set(q_toks), "q_list": q_toks, "a_tf": a_tf, "a_len": max(len(a_toks), 1)})

# Document frequency over answers, so generic domain vocabulary weighs less.
_DF = {}
for _ix in _INDEX:
    for t in _ix["a_tf"]:
        _DF[t] = _DF.get(t, 0) + 1
_N = len(_INDEX)

def _idf(tok):
    return math.log(1 + _N / (1 + _DF.get(tok, 0)))

def _score(query_tokens, ix):
    if not query_tokens:
        return 0.0
    qset = set(query_tokens)
    # Title match dominates: the entries are keyed by their question.
    title_hits = sum(_idf(t) for t in qset if t in ix["q"])
    title_cov = len(qset & ix["q"]) / max(len(ix["q"]), 1)
    # Body match, tf-idf-ish and length-normalized.
    body = 0.0
    for t in qset:
        tf = ix["a_tf"].get(t, 0)
        if tf:
            body += (1 + math.log(tf)) * _idf(t)
    body /= math.sqrt(ix["a_len"] / 200.0)
    # Consecutive-bigram bonus on the title.
    bigram = 0
    ql = ix["q_list"]
    for i in range(len(query_tokens) - 1):
        pair = (query_tokens[i], query_tokens[i + 1])
        for j in range(len(ql) - 1):
            if (ql[j], ql[j + 1]) == pair:
                bigram += 1
                break
    return 3.0 * title_hits + 4.0 * title_cov + 1.2 * body + 1.5 * bigram

@component
class ReferenceQALookup:
    @component.output_types(result=str)
    def run(self, query: str):
        if not _INDEX:
            return {"result": EMPTY_MESSAGE}
        query_tokens = _tokens(query)
        scored = sorted(
            ((_score(query_tokens, ix), i) for i, ix in enumerate(_INDEX)),
            key=lambda p: p[0],
            reverse=True,
        )
        best = scored[0][0] if scored else 0.0
        # Keep the top entries that are at least reasonably close to the best one.
        picked = [i for s, i in scored[:TOP_K] if s > 0 and s >= 0.35 * best]
        if not picked:
            return {"result": NO_MATCH_MESSAGE}
        blocks = []
        for rank, i in enumerate(picked, start=1):
            e = QA_ENTRIES[i]
            answer = e["answer"]
            if len(answer) > MAX_ANSWER_CHARS:
                answer = answer[:MAX_ANSWER_CHARS] + "\n[... entry truncated ...]"
            sources = "\n".join(f"- {s}" for s in e.get("sources", [])) or "- (none listed)"
            blocks.append(
                f"### Reference entry {rank}: {e['question']}\n{answer}\nSources:\n{sources}"
            )
        header = (
            f"{len(picked)} reference Q&A entr{'y' if len(picked) == 1 else 'ies'} matching the "
            "question. GUIDANCE ONLY: use them to choose what to search and what the "
            "answer must cover. Never quote or cite them; retrieve and cite the "
            "documents they point to.\n\n"
        )
        return {"result": header + "\n\n".join(blocks)}
