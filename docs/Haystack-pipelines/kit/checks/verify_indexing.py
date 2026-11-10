"""Structural checks for an indexing pipeline, and for its agreement with the agent
pipeline built from the same config.

    python checks/verify_indexing.py <indexing.yaml> <config.yaml>

As a module: verify_indexing(pipeline_dict, raw_text, cfg) -> list of failure messages.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

PAGE_SENTINEL = "␌"
# e5 models truncate at 512 tokens; 300 English words is already close to that once the
# header is prepended. Above it, the tail of every chunk is never embedded.
MAX_CHUNK_WORDS = 300


def verify_indexing(Y: dict, raw: str, cfg: dict | None = None, notes: list[str] | None = None) -> list[str]:
    fails: list[str] = []
    notes = notes if notes is not None else []

    def chk(cond, msg):
        if not cond:
            fails.append(msg)

    comps = Y.get("components", {})
    conns = Y.get("connections", [])
    senders = {c["sender"] for c in conns}
    receivers_of = {}
    for c in conns:
        receivers_of.setdefault(c["sender"].split(".", 1)[0], []).append(c["receiver"].split(".", 1)[0])

    # --- graph integrity
    chk(Y.get("inputs", {}).get("files") == ["file_classifier.sources"], "input files must feed file_classifier")
    for c in conns:
        chk(c["sender"].split(".", 1)[0] in comps, f"sender {c['sender']} undeclared")
        chk(c["receiver"].split(".", 1)[0] in comps, f"receiver {c['receiver']} undeclared")
    for name in ("file_classifier", "split_joiner", "metadata_finalizer", "document_embedder", "writer"):
        chk(name in comps, f"component {name} missing")

    # --- every mime type routed, every converter reaches a splitter before the embedder
    classifier = comps.get("file_classifier", {}).get("init_parameters", {})
    chk(classifier.get("raise_on_failure") is False, "file_classifier.raise_on_failure must be false")
    for mime in classifier.get("mime_types", []):
        chk(f"file_classifier.{mime}" in senders, f"mime type {mime} declared but not routed")
    splitters = {n for n, c in comps.items() if c["type"].endswith(("DocumentSplitter", "MarkdownHeaderSplitter"))}
    converters = {c["receiver"].split(".", 1)[0] for c in conns if c["sender"].startswith("file_classifier.")}

    def reaches_splitter(node, seen=frozenset()):
        if node in splitters:
            return True
        if node in seen or node == "document_embedder":
            return False
        return any(reaches_splitter(n, seen | {node}) for n in receivers_of.get(node, []))
    for conv in sorted(converters):
        chk(reaches_splitter(conv), f"{conv}: output reaches the embedder without a splitter (no split_id)")
    for c in conns:
        if c["receiver"] == "document_embedder.documents":
            chk(c["sender"] == "metadata_finalizer.documents", f"{c['sender']} bypasses metadata_finalizer")

    # --- cleaner / sentinel / page numbers
    if "document_cleaner" in comps:
        chk("structure_promoter" in comps, "document_cleaner without structure_promoter erases page breaks")
        chk("document_cleaner" in receivers_of.get("structure_promoter", []), "structure_promoter must run BEFORE document_cleaner")
    if "MarkdownHeaderSplitter" in comps:
        p = comps["MarkdownHeaderSplitter"]["init_parameters"]
        chk(p.get("page_break_character") == PAGE_SENTINEL, "header splitter must count the page sentinel, not \\f")
        chk(p.get("keep_headers") is True, "header splitter must keep headers (the header metadata comes from them)")
        chk((p.get("split_threshold") or 0) > 0, "header splitter split_threshold 0 emits header-only fragments")
        chk(p.get("split_length", 0) <= MAX_CHUNK_WORDS, f"header splitter chunks over {MAX_CHUNK_WORDS} words exceed the embedder's token limit")
    for name in splitters:
        p = comps[name]["init_parameters"]
        if p.get("split_by") == "word":
            chk(p.get("split_length", 0) <= MAX_CHUNK_WORDS, f"{name}: chunks over {MAX_CHUNK_WORDS} words exceed the embedder's token limit")
    codes = " ".join(c.get("init_parameters", {}).get("code", "") for c in comps.values())
    chk(codes.count(PAGE_SENTINEL) + codes.count("\\u240c") >= 2, "promoter and finalizer must share the page sentinel")

    # --- embedder and writer
    emb = comps.get("document_embedder", {}).get("init_parameters", {})
    model = emb.get("model", "")
    chk(bool(model), "document_embedder.model missing")
    if "e5" in model.lower():
        chk(emb.get("prefix") == "passage: ", "e5 models need the 'passage: ' prefix on documents")
    chk("header" in (emb.get("meta_fields_to_embed") or []), "document_embedder should embed the header with the chunk")
    ds = comps.get("writer", {}).get("init_parameters", {}).get("document_store", {}).get("init_parameters", {})
    chk(bool(ds.get("index")), "writer: index must be named explicitly (not the workspace default)")
    chk(comps.get("writer", {}).get("init_parameters", {}).get("policy") == "OVERWRITE", "writer policy should be OVERWRITE for re-indexing")

    # --- agreement with the config (and therefore with the agent pipeline)
    if cfg:
        chk(ds.get("index") == cfg["store"]["index"], f"writer index {ds.get('index')} != config {cfg['store']['index']}")
        chk(ds.get("embedding_dim") == cfg["store"]["embedding_dim"], "writer embedding_dim != config")
        chk(model == cfg["retrieval"]["embedder_model"], f"embedder {model} != config {cfg['retrieval']['embedder_model']}")
        want = {k for k in ("doc_type", "version", "document_date") if k in cfg["metadata"]["extra_attrs"]}
        rules = {r["field"] for r in cfg["indexing"]["filename_rules"]}
        for field in want - rules:
            notes.append(f"{field} is shown by the agent but no indexing.filename_rules derives it: it must "
                         "come from file-level metadata at upload or it will read 'unknown'")
        if cfg["retrieval"]["group_by"] not in ("file_id", None):
            chk(cfg["retrieval"]["group_by"] in cfg["indexing"]["meta_defaults"],
                f"the agent groups on {cfg['retrieval']['group_by']} but indexing.meta_defaults gives it no default: null groups sort unpredictably")

    # --- code compiles, no leftovers
    for name, c in comps.items():
        code = c.get("init_parameters", {}).get("code")
        if code:
            try:
                compile(code, name, "exec")
            except SyntaxError as e:
                fails.append(f"{name}: code does not compile: {e}")
            chk("# KIT:" not in code, f"{name}: leftover # KIT: tag")
    chk("—" not in raw and "–" not in raw, "no em/en dashes")
    return fails


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from build_pipeline import load_config
    raw = Path(argv[0]).read_text(encoding="utf-8")
    notes: list[str] = []
    fails = verify_indexing(yaml.safe_load(raw), raw, load_config(argv[1]), notes)
    for n in notes:
        print("NOTE " + n)
    for f in fails:
        print("FAIL " + f)
    print(f"{Path(argv[0]).name}: {'OK' if not fails else f'{len(fails)} failure(s)'}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
