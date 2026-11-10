"""Builds every example config, verifies each result, and asserts that the SUMMA build
is structurally identical to the hand-written summa-agent-draft-1.yaml."""
import copy
from pathlib import Path

import pytest
import yaml
from haystack.components.builders import ChatPromptBuilder

from build_pipeline import build, load_config, to_yaml
from verify_pipeline import verify

KIT = Path(__file__).resolve().parent.parent
CONFIGS = sorted((KIT / "configs").glob("*.yaml"))
DRAFT1 = KIT.parent / "summa" / "summa-agent-draft-1.yaml"


@pytest.mark.parametrize("config_path", CONFIGS, ids=lambda p: p.stem)
def test_build_verifies_and_round_trips(config_path):
    cfg = load_config(config_path)
    pipeline = build(cfg)
    text = to_yaml(pipeline, cfg, config_path)
    reloaded = yaml.safe_load(text)
    assert reloaded == pipeline, "YAML emission must round-trip"
    assert verify(reloaded, text, cfg) == []


@pytest.mark.parametrize("config_path", CONFIGS, ids=lambda p: p.stem)
def test_prompts_render_with_haystack(config_path):
    cfg = load_config(config_path)
    a = build(cfg)["components"]["agent"]["init_parameters"]
    b = ChatPromptBuilder(template=a["system_prompt"] + "\n" + a["user_prompt"], required_variables=["query"])
    out = b.run(query="How do I do X?", attachments="")["prompt"]
    assert [m.role.value for m in out] == ["system", "user"]
    assert "<query>\nHow do I do X?\n</query>" in out[1].text
    if cfg["features"]["attachments"]:
        assert "attached the following" not in out[1].text
        out2 = b.run(query="q", attachments="<documents>X</documents>")["prompt"]
        assert "<documents>X</documents>" in out2[1].text


def test_feature_flags_shape_the_pipeline():
    cfg = load_config(KIT / "configs" / "minimal.yaml")
    p = build(cfg)
    assert list(p["components"]) == ["history_sanitizer", "citation_renumberer", "agent"]
    assert set(p["inputs"]) == {"query", "messages"}
    tools = [t["data"]["name"] for t in p["components"]["agent"]["init_parameters"]["tools"]]
    assert tools == ["search_corpus"]
    sp = p["components"]["agent"]["init_parameters"]["system_prompt"]
    assert "search_in_file" not in sp and "consult_reference_qa" not in sp

    cfg = load_config(KIT / "configs" / "procurement-authority.yaml")
    p = build(cfg)
    agent = p["components"]["agent"]["init_parameters"]
    assert "filters" in agent["state_schema"] and p["inputs"]["filters"] == ["agent.filters"]
    tools = {t["data"]["name"]: t["data"] for t in agent["tools"]}
    for name in ("list_corpus_files", "search_corpus", "search_in_file"):
        assert tools[name]["inputs_from_state"]["filters"] == "filters"
        assert "filters" not in tools[name]["parameters"]["properties"]
    assert "scan_filter" in tools["list_corpus_files"]["pipeline"]["components"]
    assert tools["search_in_file"]["input_mapping"]["filters"] == ["file_filter.base_filters"]
    assert agent["chat_generator"]["type"].endswith("OpenAIChatGenerator")
    assert agent["chat_generator"]["init_parameters"]["api_key"]["env_vars"] == ["GPTEC_API_KEY"]
    grp = tools["search_corpus"]["pipeline"]["components"]["meta_field_grouping_ranker"]["init_parameters"]
    assert grp == {"group_by": "authority_rank", "subgroup_by": "file_id", "sort_docs_by": "split_id"}
    assert "QA_ENTRIES = [{'question': 'Example entry" in tools["consult_reference_qa"]["pipeline"]["components"]["qa_lookup"]["init_parameters"]["code"]


def _strip(node, drop=("code", "system_prompt")):
    """Removes the free-text parts that are allowed to differ in wording."""
    if isinstance(node, dict):
        return {k: _strip(v, drop) for k, v in node.items() if k not in drop}
    if isinstance(node, list):
        return [_strip(v, drop) for v in node]
    return node


def test_summa_build_matches_hand_written_draft1():
    # The frozen fixture is the config as it was when draft 1 was written by hand; the live
    # configs/summa.yaml has since moved on (embedding model, vocabulary, system description).
    cfg = load_config(KIT / "tests" / "fixtures" / "summa-draft1.yaml")
    built = build(cfg)
    draft = yaml.safe_load(DRAFT1.read_text(encoding="utf-8"))
    assert _strip(built) == _strip(draft), "everything but code bodies and the system prompt must be identical"
    # The code bodies may differ in wording but must expose the same classes and constants.
    def classes(node, out):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "code":
                    out.append(sorted(l.split("class ", 1)[1].split("(")[0].split(":")[0] for l in v.splitlines() if l.startswith("class ")))
                else:
                    classes(v, out)
        elif isinstance(node, list):
            for v in node:
                classes(v, out)
        return out
    assert classes(built, []) == classes(draft, [])
    # Both prompts carry the same PACIOLI rules.
    sp_built = " ".join(built["components"]["agent"]["init_parameters"]["system_prompt"].split())
    sp_draft = " ".join(draft["components"]["agent"]["init_parameters"]["system_prompt"].split())
    for frag in ("You are P.A.C.I.O.L.I", "Local Authorisation Manager (LAM)", "For further help, you can contact:",
                 "EC-SUMMA-HELPDESK@ec.europa.eu", "PO and Purchase Order", "latest approved version",
                 "I'm sorry, I couldn't find any information related to your question in the current documentation."):
        assert frag in sp_built and frag in sp_draft, frag
