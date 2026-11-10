"""Indexing side: components against real haystack classes, builds for every config,
verifier, and agreement between the indexing and agent pipelines built from one config."""
from pathlib import Path

import pytest
import yaml
from haystack.dataclasses import Document

from build_indexing import FORMATS, build_indexing
from build_pipeline import build, component_code, embedder_prefixes, load_config, to_yaml
from verify_indexing import verify_indexing

KIT = Path(__file__).resolve().parent.parent
CONFIGS = sorted((KIT / "configs").glob("*.yaml"))


# ------------------------------------------------------------ structure promoter
MANUAL = """SUMMA Payments User Guide
1. Introduction
This guide explains payments.
2. Create a payment request
2.1 Prerequisites
You need a purchase order.
2.1.1 Business partner
The BP must be active.
12 September 2024
This is a sentence that ends with a number 3.
"""


def test_promoter_numbered_profile(components):
    m = components("structure_promoter")
    docs = [Document(id="d", content=MANUAL.replace("\n2. Create", "\n\f\n2. Create"))]
    out = m.StructurePromoter().run(documents=docs)["documents"][0]
    text = out.content
    assert "## 1. Introduction" in text and "## 2. Create a payment request" in text
    assert "### 2.1 Prerequisites" in text and "#### 2.1.1 Business partner" in text
    assert "12 September 2024" in text and "# 12 September 2024" not in text, "a date is not a heading"
    assert "\f" not in text and m.PAGE_SENTINEL in text, "form feed swapped for the sentinel"
    assert out.meta["structure_profile"] == "generic" and out.meta["structure_headings_added"] == 4


def test_promoter_paragraph_numbered_guard(components):
    m = components("structure_promoter")
    paras = "\n".join(f"{i}. Paragraph {i} of a judgment says something" for i in range(1, 15))
    out = m.StructurePromoter().run(documents=[Document(id="j", content=paras)])["documents"][0]
    assert out.meta["structure_profile"] == "paragraph_numbered"
    assert "#" not in out.content, "paragraph numbers must never become headings"


def test_promoter_legal_profile_only_when_enabled(components):
    act = "TITLE II\nCHAPTER 1\nArticle 11\nCommitment of appropriations\nSome rule applies."
    m = components("structure_promoter")  # numbered only
    out = m.StructurePromoter().run(documents=[Document(id="a", content=act)])["documents"][0]
    assert "#" not in out.content
    m = components("structure_promoter", component_code("structure_promoter", {"structure_profiles": {"legal", "numbered"}}))
    out = m.StructurePromoter().run(documents=[Document(id="a", content=act)])["documents"][0]
    assert "# TITLE II" in out.content and "## CHAPTER 1" in out.content
    assert "#### Article 11 - Commitment of appropriations" in out.content


# ------------------------------------------------------------ metadata finalizer
def test_finalizer_header_and_structure(components):
    m = components("metadata_finalizer")
    d = Document(id="x", content=f"text{m.PAGE_SENTINEL} more",
                 meta={"file_name": "Payments guide.pdf", "header": "## 2.1 Prerequisites",
                       "parent_headers": ["# 2. Create a payment request"], "split_id": 3})
    out = m.MetadataFinalizer().run(documents=[d])["documents"][0]
    assert out.content == "text more"
    assert out.meta["header"] == "Payments guide.pdf | 2.1 Prerequisites"
    assert out.meta["section_title"] == "2.1 Prerequisites"
    assert out.meta["section_path"] == "2. Create a payment request > 2.1 Prerequisites"
    assert out.meta["provision_ref"] is None and out.meta["paragraph_range"] is None
    assert out.meta["split_id"] == 3 and out.meta["page_number"] is None
    bare = m.MetadataFinalizer().run(documents=[Document(id="y", content="t", meta={"file_name": "flat.txt"})])["documents"][0]
    assert bare.meta["header"] == "flat.txt" and bare.meta["split_id"] == 0


def test_finalizer_filename_rules_and_defaults(components):
    cfg = load_config(KIT / "configs" / "summa.yaml")
    code = component_code("metadata_finalizer", {"filename_rules": cfg["indexing"]["filename_rules"],
                                                 "meta_defaults": {"authority_rank": 5}})
    m = components("metadata_finalizer", code)
    F = m.MetadataFinalizer()
    out = F.run(documents=[Document(id="1", content="t", meta={"file_name": "SUMMA Payments User Guide_v3.2.pdf"})])["documents"][0]
    assert out.meta["version"] == "3.2" and out.meta["doc_type"] == "user guide" and out.meta["authority_rank"] == 5
    out = F.run(documents=[Document(id="2", content="t", meta={"file_name": "Release Notes 2025-Q3.docx"})])["documents"][0]
    assert out.meta["doc_type"] == "release notes" and out.meta["document_date"] == "2025-Q3"
    uploaded = Document(id="3", content="t", meta={"file_name": "Release notes 2025-Q3.docx", "doc_type": "FAQ", "authority_rank": 2})
    out = F.run(documents=[uploaded])["documents"][0]
    assert out.meta["doc_type"] == "FAQ" and out.meta["authority_rank"] == 2, "upload metadata wins over file-name rules and defaults"


def test_provision_and_paragraph_range(components):
    m = components("metadata_finalizer")
    d = Document(id="p", content="41. First.\n42. Second.\n43. Third.",
                 meta={"file_name": "C-1.pdf", "header": "#### Article 11 - Scope", "structure_profile": "judgment"})
    out = m.MetadataFinalizer().run(documents=[d])["documents"][0]
    assert out.meta["provision_ref"] == "11" and out.meta["paragraph_range"] == "41-43"


# ------------------------------------------------------------ builds
@pytest.mark.parametrize("config_path", CONFIGS, ids=lambda p: p.stem)
def test_indexing_builds_and_verifies(config_path):
    cfg = load_config(config_path)
    pipeline = build_indexing(cfg)
    text = to_yaml(pipeline, cfg, config_path)
    reloaded = yaml.safe_load(text)
    assert reloaded == pipeline
    notes: list[str] = []
    assert verify_indexing(reloaded, text, cfg, notes) == []
    # every configured format is routed to a converter and ends up split
    mimes = reloaded["components"]["file_classifier"]["init_parameters"]["mime_types"]
    assert mimes == [FORMATS[f][0] for f in cfg["indexing"]["formats"]]


@pytest.mark.parametrize("config_path", CONFIGS, ids=lambda p: p.stem)
def test_indexing_and_agent_agree(config_path):
    cfg = load_config(config_path)
    ix = build_indexing(cfg)
    ag = build(cfg)
    writer_store = ix["components"]["writer"]["init_parameters"]["document_store"]["init_parameters"]
    doc_emb = ix["components"]["document_embedder"]["init_parameters"]
    tools = {t["data"]["name"]: t["data"] for t in ag["components"]["agent"]["init_parameters"]["tools"]}
    sc = tools["search_corpus"]["pipeline"]["components"]
    query_store = sc["embedding_retriever"]["init_parameters"]["document_store"]["init_parameters"]
    query_emb = sc["query_embedder"]["init_parameters"]
    assert writer_store["index"] == query_store["index"]
    assert writer_store["embedding_dim"] == query_store["embedding_dim"]
    assert doc_emb["model"] == query_emb["model"]
    assert {doc_emb["prefix"], query_emb["prefix"]} == set(embedder_prefixes(doc_emb["model"]).values())


def test_switching_embedder_changes_both_sides(tmp_path):
    cfg = load_config(KIT / "configs" / "summa.yaml")
    cfg["retrieval"]["embedder_model"] = "intfloat/multilingual-e5-large"
    cfg["store"]["embedding_dim"] = 1024
    cfg["store"]["index"] = "pacioli-index-v2"
    ix = build_indexing(cfg)
    ag = build(cfg)
    assert ix["components"]["document_embedder"]["init_parameters"]["model"] == "intfloat/multilingual-e5-large"
    assert ix["components"]["document_embedder"]["init_parameters"]["prefix"] == "passage: "
    assert ix["components"]["writer"]["init_parameters"]["document_store"]["init_parameters"] == {"embedding_dim": 1024, "index": "pacioli-index-v2"}
    dump = yaml.safe_dump(ag)
    assert "index: pacioli-index-v2" in dump and "intfloat/e5-base-v2" not in dump and "embedding_dim: 768" not in dump


def test_every_format_route_is_split():
    cfg = load_config(KIT / "configs" / "minimal.yaml")
    cfg["indexing"]["formats"] = list(FORMATS)
    ix = build_indexing(cfg)
    text = yaml.safe_dump(ix)
    assert verify_indexing(ix, text, cfg) == []
    assert "kreuzberg_doc" in ix["components"] and "docling_jpeg" in ix["components"]
    assert ix["components"]["docling_jpeg"]["init_parameters"]["do_picture_description"] is True
