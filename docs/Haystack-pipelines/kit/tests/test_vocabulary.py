"""Vocabulary (query expander + prompt), system description, Q&A files, template config."""
from pathlib import Path

import yaml

from build_pipeline import build, component_code, load_config, load_qa_entries, to_yaml
from verify_pipeline import verify

KIT = Path(__file__).resolve().parent.parent


def test_query_expander_adds_other_forms(components):
    code = component_code("query_expander", {"synonyms": [["PO", "Purchase Order"], ["VAT", "TVA", "tax"],
                                                          ["down payment", "downpayment", "prefinancing"]]})
    m = components("query_expander", code)
    E = m.QueryExpander()
    assert E.run(query="create a PO for services")["query"] == "create a PO for services Purchase Order"
    assert E.run(query="purchase order approval")["query"] == "purchase order approval PO"
    assert E.run(query="VAT code on invoice")["query"] == "VAT code on invoice TVA tax"
    assert E.run(query="request a down payment")["query"] == "request a down payment downpayment prefinancing"
    assert E.run(query="position of the cursor")["query"] == "position of the cursor", "PO inside a word is not a match"
    assert E.run(query="")["query"] == ""


def test_expander_wired_only_when_synonyms_configured():
    cfg = load_config(KIT / "configs" / "summa.yaml")
    p = build(cfg)
    tools = {t["data"]["name"]: t["data"] for t in p["components"]["agent"]["init_parameters"]["tools"]}
    for name in ("search_corpus", "search_in_file"):
        pc = tools[name]["pipeline"]["components"]
        assert "query_expander" in pc
        code = pc["query_expander"]["init_parameters"]["code"]
        assert "['PO', 'Purchase Order']" in code and "['LAM', 'Local Authorisation Manager']" in code
        conns = {(c["sender"], c["receiver"]) for c in tools[name]["pipeline"]["connections"]}
        assert ("retrieval_query.output", "query_expander.query") in conns
        assert ("query_expander.query", "bm25_retriever.query") in conns
        assert ("query_expander.query", "query_embedder.text") in conns
        assert tools[name]["input_mapping"]["query"] == ["retrieval_query.query", "ranker.query", "ranker_scoring.query"]
    frozen = load_config(KIT / "tests" / "fixtures" / "summa-draft1.yaml")
    p2 = build(frozen)
    sc = [t for t in p2["components"]["agent"]["init_parameters"]["tools"] if t["data"]["name"] == "search_corpus"][0]
    assert "query_expander" not in sc["data"]["pipeline"]["components"]


def test_prompt_carries_system_description_and_glossary():
    cfg = load_config(KIT / "configs" / "summa.yaml")
    sp = " ".join(build(cfg)["components"]["agent"]["init_parameters"]["system_prompt"].split())
    assert "# The system and the corpus" in sp and "SUMMA is the European Commission's corporate financial system" in sp
    assert "LAM = the Local Authorisation Manager" in sp
    assert "PO and Purchase Order" in sp and "add the other forms of these terms automatically" in sp
    assert sp.index("# The system and the corpus") < sp.index("# Your tools")


def test_qa_entries_file_yaml_and_csv(tmp_path):
    csv_entries = load_qa_entries(KIT / "tests" / "fixtures" / "qa.csv")
    assert csv_entries[0]["sources"] == ["Procurement guide s.3", "Release notes 2025-Q1 item 2"]
    assert len(csv_entries) == 2
    yml = tmp_path / "qa.yaml"
    yml.write_text(yaml.safe_dump([{"question": "Q?", "answer": "A.", "sources": ["S"]}]), encoding="utf-8")
    assert load_qa_entries(yml) == [{"question": "Q?", "answer": "A.", "sources": ["S"]}]
    cfg_path = tmp_path / "c.yaml"
    cfg_path.write_text(yaml.safe_dump({"store": {"index": "i"}, "prompt": {"persona": "You are X."},
                                        "reference_qa": {"entries_file": "qa.yaml",
                                                         "entries": [{"question": "Inline?", "answer": "Yes."}]}}),
                        encoding="utf-8")
    cfg = load_config(cfg_path)
    assert [e["question"] for e in cfg["reference_qa"]["entries"]] == ["Inline?", "Q?"]
    p = build(cfg)
    code = [t for t in p["components"]["agent"]["init_parameters"]["tools"] if t["data"]["name"] == "consult_reference_qa"][0]
    assert "'question': 'Q?'" in code["data"]["pipeline"]["components"]["qa_lookup"]["init_parameters"]["code"]


def test_summa_qa_file_is_read_and_currently_empty():
    cfg = load_config(KIT / "configs" / "summa.yaml")
    assert cfg["reference_qa"]["entries"] == []


def test_template_config_builds_and_verifies():
    cfg = load_config(KIT / "configs" / "template.yaml")
    p = build(cfg)
    text = to_yaml(p, cfg, "template.yaml")
    assert verify(yaml.safe_load(text), text, cfg) == []
    assert cfg["store"]["embedding_dim"] == 1024 and cfg["retrieval"]["embedder_model"] == "intfloat/multilingual-e5-large"
    sp = p["components"]["agent"]["init_parameters"]["system_prompt"]
    assert "You are ASSISTANT-NAME" in sp and "# The system and the corpus" in sp and "ABBR = what users mean" in sp
    tools = {t["data"]["name"]: t["data"] for t in p["components"]["agent"]["init_parameters"]["tools"]}
    assert set(tools) == {"consult_reference_qa", "list_corpus_files", "search_corpus", "search_in_file"}
    assert "query_expander" in tools["search_corpus"]["pipeline"]["components"]
    emb = tools["search_corpus"]["pipeline"]["components"]["query_embedder"]["init_parameters"]
    assert emb == {"normalize_embeddings": True, "model": "intfloat/multilingual-e5-large", "prefix": "query: ", "suffix": ""}
