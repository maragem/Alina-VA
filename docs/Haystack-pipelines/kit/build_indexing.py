"""Builds the INDEXING pipeline YAML from the same config as the agent pipeline, so the
index name, the embedding model and the embedding dimension agree by construction.

    python build_indexing.py configs/summa.yaml -o ../summa/pacioli-indexing.generated.yaml --check

Shape (ALINA indexing-v06, generalised):

  files -> file_classifier -> one converter per format
     markdown-structured formats (md, html, pdf, docx, doc, odt, png, jpeg)
        -> structure_promoter -> document_cleaner -> MarkdownHeaderSplitter ─┐
     plain formats (txt, pptx) -> splitter ──────────────────────────────────┤
     tabular formats (xlsx, csv) -> table_splitter ──────────────────────────┤
                                        split_joiner <─────────────────────┘
                                        -> metadata_finalizer -> document_embedder -> writer

Every format goes through a splitter, so every chunk carries split_id (the file listing
and the sentence window depend on it). The promoter swaps form feeds for a printable
sentinel BEFORE the cleaner, the header splitter counts the sentinel for page numbers,
and the finalizer strips it: without that, the cleaner's whitespace collapsing erases
every page number (ALINA v0.4 regression).
"""
from __future__ import annotations

import argparse
import sys
import textwrap
from pathlib import Path
from typing import Any

import yaml

from build_pipeline import (KIT_DIR, STORE_TYPE, code_component, embedder_prefixes, load_config, store,
                            to_yaml)

PAGE_SENTINEL = "␌"
DOCLING_TYPE = "dc_custom_component.components.converters.docling_converter.ECDoclingConverter"
KREUZBERG_TYPE = "haystack_integrations.components.converters.kreuzberg.converter.KreuzbergConverter"
DOC_EMBEDDER_TYPE = "deepset_cloud_custom_nodes.embedders.nvidia.document_embedder.DeepsetNvidiaDocumentEmbedder"

# format -> (mime type, converter name, path)
FORMATS: dict[str, tuple[str, str, str]] = {
    "txt": ("text/plain", "text_converter", "plain"),
    "md": ("text/markdown", "markdown_converter", "markdown"),
    "html": ("text/html", "html_converter", "markdown"),
    "pdf": ("application/pdf", "docling_pdf", "markdown"),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docling_docx", "markdown"),
    "pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx_converter", "plain"),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx_converter", "tabular"),
    "csv": ("text/csv", "csv_converter", "tabular"),
    "png": ("image/png", "docling_png", "markdown"),
    "jpeg": ("image/jpeg", "docling_jpeg", "markdown"),
    "doc": ("application/msword", "kreuzberg_doc", "markdown"),
    "odt": ("application/vnd.oasis.opendocument.text", "kreuzberg_odt", "markdown"),
}


def docling(ocr: bool, pictures: bool, enrich: bool = False) -> dict:
    return {"type": DOCLING_TYPE, "init_parameters": {
        "do_ocr": ocr, "do_table_structure": True, "do_code_enrichment": enrich,
        "do_formula_enrichment": enrich, "do_picture_classification": pictures,
        "do_picture_description": pictures, "page_break_placeholder": "\f",
        "filter_binary_hash": True, "pipeline_options": None, "convert_kwargs": None,
        "md_export_kwargs": None}}


def kreuzberg() -> dict:
    # `config` MUST be a JSON string: KreuzbergConverter.from_dict writes it to a temp
    # file and calls ExtractionConfig.from_file(). A YAML mapping is silently ignored and
    # you fall back to plain text, which collapses each file into one unsplit chunk.
    return {"type": KREUZBERG_TYPE, "init_parameters": {
        "config": '{"output_format": "markdown"}', "config_path": None, "store_full_path": False,
        "batch": True, "easyocr_kwargs": None}}


def converter(fmt: str, ix: dict) -> dict:
    return {
        "txt": {"type": "haystack.components.converters.txt.TextFileToDocument", "init_parameters": {"encoding": "utf-8"}},
        "md": {"type": "haystack.components.converters.txt.TextFileToDocument", "init_parameters": {"encoding": "utf-8"}},
        "html": {"type": "haystack.components.converters.html.HTMLToDocument", "init_parameters": {
            "extraction_kwargs": {"output_format": "markdown", "target_language": None,
                                  "include_tables": True, "include_links": True}}},
        "pdf": docling(ix["pdf_ocr"], ix["picture_description"]),
        "docx": docling(ix["docx_ocr"], ix["picture_description"]),
        "pptx": {"type": "haystack.components.converters.pptx.PPTXToDocument", "init_parameters": {}},
        "xlsx": {"type": "haystack.components.converters.xlsx.XLSXToDocument",
                 "init_parameters": {"sheet_name": None} if not ix.get("xlsx_document_per")
                 else {"sheet_name": None, "document_per": ix["xlsx_document_per"]}},
        "csv": {"type": "haystack.components.converters.csv.CSVToDocument", "init_parameters": {"encoding": "utf-8"}},
        # An image carries nothing but its pixels: OCR and picture description always on.
        "png": docling(True, True, enrich=True),
        "jpeg": docling(True, True, enrich=True),
        "doc": kreuzberg(),
        "odt": kreuzberg(),
    }[fmt]


def build_indexing(cfg: dict) -> dict:
    ix = cfg["indexing"]
    formats = list(ix["formats"])
    unknown = [f for f in formats if f not in FORMATS]
    if unknown:
        raise SystemExit(f"config: unknown indexing.formats {unknown}; known: {sorted(FORMATS)}")
    components: dict[str, Any] = {
        "file_classifier": {"type": "haystack.components.routers.file_type_router.FileTypeRouter",
                            "init_parameters": {"mime_types": [FORMATS[f][0] for f in formats],
                                                # One unsupported file no longer aborts the whole run.
                                                "raise_on_failure": False}},
    }
    paths_used = set()
    for fmt in formats:
        _, name, path = FORMATS[fmt]
        components[name] = converter(fmt, ix)
        paths_used.add(path)
    if "markdown" in paths_used:
        components["structure_promoter"] = code_component(
            "structure_promoter", {"structure_profiles": set(ix["structure_profiles"])})
        components["document_cleaner"] = {
            "type": "haystack.components.preprocessors.document_cleaner.DocumentCleaner",
            "init_parameters": {"remove_empty_lines": True, "remove_extra_whitespaces": True,
                                "remove_repeated_substrings": True, "keep_id": False}}
        components["MarkdownHeaderSplitter"] = {
            "type": "haystack.components.preprocessors.markdown_header_splitter.MarkdownHeaderSplitter",
            "init_parameters": {"page_break_character": PAGE_SENTINEL, "keep_headers": True,
                                "header_split_levels": list(ix["header_split_levels"]),
                                "secondary_split": "word", "split_length": ix["chunk_words"],
                                "split_overlap": ix["chunk_overlap"], "split_threshold": ix["chunk_threshold"],
                                "skip_empty_documents": True}}
    if "plain" in paths_used:
        components["splitter"] = {
            "type": "haystack.components.preprocessors.document_splitter.DocumentSplitter",
            "init_parameters": {"split_by": "word", "split_length": ix["chunk_words"],
                                "split_overlap": ix["chunk_overlap"], "split_threshold": ix["chunk_threshold"],
                                "respect_sentence_boundary": True, "language": "en"}}
    if "tabular" in paths_used:
        components["table_splitter"] = {
            "type": "haystack.components.preprocessors.document_splitter.DocumentSplitter",
            "init_parameters": {"split_by": "line", "split_length": ix["table_lines"],
                                "split_overlap": ix["table_overlap"], "split_threshold": ix["table_threshold"]}}
    components["split_joiner"] = {"type": "haystack.components.joiners.document_joiner.DocumentJoiner",
                                  "init_parameters": {"join_mode": "concatenate"}}
    components["metadata_finalizer"] = code_component("metadata_finalizer", {
        "filename_rules": list(ix["filename_rules"]), "meta_defaults": dict(ix["meta_defaults"])})
    prefixes = embedder_prefixes(cfg["retrieval"]["embedder_model"])
    components["document_embedder"] = {"type": DOC_EMBEDDER_TYPE, "init_parameters": {
        "normalize_embeddings": True, "model": cfg["retrieval"]["embedder_model"],
        "prefix": prefixes["passage"], "suffix": "",
        # Prepends the section label to the embedded text, so a mid-section chunk carries
        # its section identity in its own vector. Index-side counterpart of the rerankers'
        # meta_fields_to_embed.
        "meta_fields_to_embed": ["header"], "embedding_separator": "\n"}}
    components["writer"] = {"type": "haystack.components.writers.document_writer.DocumentWriter",
                            "init_parameters": {"document_store": store(cfg), "policy": ix["write_policy"]}}

    connections: list[dict] = []
    for fmt in formats:
        mime, name, _ = FORMATS[fmt]
        connections.append({"sender": f"file_classifier.{mime}", "receiver": f"{name}.sources"})
    for fmt in formats:
        _, name, path = FORMATS[fmt]
        target = {"markdown": "structure_promoter", "plain": "splitter", "tabular": "table_splitter"}[path]
        connections.append({"sender": f"{name}.documents", "receiver": f"{target}.documents"})
    if "markdown" in paths_used:
        connections += [{"sender": "structure_promoter.documents", "receiver": "document_cleaner.documents"},
                        {"sender": "document_cleaner.documents", "receiver": "MarkdownHeaderSplitter.documents"},
                        {"sender": "MarkdownHeaderSplitter.documents", "receiver": "split_joiner.documents"}]
    if "plain" in paths_used:
        connections.append({"sender": "splitter.documents", "receiver": "split_joiner.documents"})
    if "tabular" in paths_used:
        connections.append({"sender": "table_splitter.documents", "receiver": "split_joiner.documents"})
    connections += [{"sender": "split_joiner.documents", "receiver": "metadata_finalizer.documents"},
                    {"sender": "metadata_finalizer.documents", "receiver": "document_embedder.documents"},
                    {"sender": "document_embedder.documents", "receiver": "writer.documents"}]
    return {"components": components, "connections": connections,
            "inputs": {"files": ["file_classifier.sources"]},
            "max_runs_per_component": 100, "metadata": {}}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("config")
    ap.add_argument("-o", "--output")
    ap.add_argument("--check", action="store_true", help="run checks/verify_indexing on the result")
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    pipeline = build_indexing(cfg)
    notes = cfg.get("indexing_header_notes") or "\n".join(textwrap.wrap(
        f"INDEXING pipeline for {cfg['name']}: writes {cfg['store']['index']} with "
        f"{cfg['retrieval']['embedder_model']} ({cfg['store']['embedding_dim']} dims), the same values the agent "
        "pipeline built from this config reads. RE-INDEX after any change here: index-time metadata never "
        "applies retroactively. Give a changed index a new name and bump the config, so the old index stays "
        "queryable until the new one is validated.", width=88))
    text = to_yaml(pipeline, {**cfg, "header_notes": notes}, args.config,
                   builder="build_indexing.py", checker="verify_indexing.py")
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print(f"wrote {args.output} ({len(text.splitlines())} lines)")
    else:
        sys.stdout.write(text)
    if args.check:
        sys.path.insert(0, str(KIT_DIR / "checks"))
        from verify_indexing import verify_indexing  # noqa: E402
        failures = verify_indexing(yaml.safe_load(text), text, cfg)
        for msg in failures:
            print("FAIL " + msg)
        print(f"verify: {'OK' if not failures else f'{len(failures)} failure(s)'}")
        return 1 if failures else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
