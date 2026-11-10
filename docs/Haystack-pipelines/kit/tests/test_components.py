"""Unit tests for kit/components/*.py against the real haystack classes.
Fixtures should come from traces when a real failure is being pinned down
(ALINA handoff, section 7); the ones here cover the contracts only."""
import hashlib

from haystack.dataclasses import ChatMessage, Document

from build_pipeline import component_code


def doc(i, name, content, **meta):
    base = dict(file_name=name, file_id=f"fid-{name}", split_id=i, header=f"Section {i}", page_number=i + 1)
    base.update(meta)
    return Document(id=f"{name}-{i}", content=content, meta=base)


def tok(d):
    return hashlib.sha1(d.id.encode()).hexdigest()[:6]


# ----------------------------------------------------------------- reference_qa
def test_reference_qa_empty_points_to_search(components):
    m = components("reference_qa")
    r = m.ReferenceQALookup().run(query="how do I create a purchase order")["result"]
    assert "No reference Q&A entries are configured" in r


def test_reference_qa_filled_ranks_and_never_cites(components):
    entries = [
        {"question": "How do I create a purchase order?", "answer": "Use the Create Purchase Order app.",
         "sources": ["Procurement guide s.3"]},
        {"question": "How do I request a down payment?", "answer": "Open Manage Down Payment Requests.",
         "sources": ["Payments guide s.4.2"]},
    ]
    m = components("reference_qa", component_code("reference_qa", {"qa_entries": entries, "domain_stopwords": {"summa"}}))
    r = m.ReferenceQALookup().run(query="create a PO purchase order in summa")["result"]
    assert "Reference entry 1: How do I create a purchase order?" in r
    assert "GUIDANCE ONLY" in r and "Never quote or cite them" in r
    r = m.ReferenceQALookup().run(query="down payment request")["result"]
    assert "down payment" in r.split("Reference entry 1:")[1][:60]
    r = m.ReferenceQALookup().run(query="xyzzy frobnicate")["result"]
    assert "No reference entry matches" in r and "search_corpus" in r


# ----------------------------------------------------------------- corpus lister
def test_lister_fields_sorting_and_matching(components):
    m = components("corpus_lister")
    L = m.CorpusFileLister()
    scan = [
        doc(0, "SUMMA Payments User Guide v3.pdf", "x", doc_type="user guide", version="v3", document_date="2025-06-01"),
        doc(0, "Release notes 2025-Q3.pdf", "x", doc_type="release notes", document_date="2025-09-15"),
        doc(0, "VAT quick reference card.pdf", "x"),
    ]
    r = L.run(documents=scan, name_matches=[], name_pattern="")["result"]
    assert r.startswith("3 document(s), alphabetical")
    assert '"doc_type": "unknown"' in r and '"version": "v3"' in r
    assert "1 document(s)" in L.run(documents=scan, name_matches=[], name_pattern="guide payments")["result"]
    r = L.run(documents=[], name_matches=[doc(0, "Hidden manual.pdf", "x")], name_pattern="hidden")["result"]
    assert "Hidden manual" in r
    r = L.run(documents=scan, name_matches=[], name_pattern="nonexistent")["result"]
    assert 'No document matches "nonexistent"' in r and "answer from search_corpus" in r
    display = doc(0, "SUMMA_PAY_v3.pdf", "x", display_name="Payments User Guide")
    r = L.run(documents=[display], name_matches=[], name_pattern="payments")["result"]
    assert '"file_name": "Payments User Guide"' in r


def test_lister_unfiltered_cap_forbids_absence_verdict(components):
    m = components("corpus_lister")
    big = [doc(0, f"file-{i:04d}.pdf", "x") for i in range(700)]
    r = m.CorpusFileLister().run(documents=big, name_matches=[], name_pattern="")["result"]
    assert "THIS LISTING IS INCOMPLETE" in r and "600 of 700" in r
    r = m.CorpusFileLister().run(documents=big, name_matches=[], name_pattern="file-06")["result"]
    assert "INCOMPLETE" not in r


def test_lister_authority_sort_unknown_last(components):
    code = component_code("corpus_lister", {"listing_fields": ["authority_rank"], "listing_sort": ["authority_rank"],
                                            "listing_order_label": "highest authority first",
                                            "listing_legend": "authority_rank: 1 = legal acts"})
    m = components("corpus_lister", code)
    scan = [doc(0, "guidance.pdf", "x", authority_rank=3), doc(0, "unknown.pdf", "x"),
            doc(0, "regulation.pdf", "x", authority_rank="1"), doc(0, "circular.pdf", "x", authority_rank=2)]
    r = m.CorpusFileLister().run(documents=scan, name_matches=[], name_pattern="")["result"]
    lines = r.split(":\n", 1)[1].splitlines()
    assert [l.split('"file_name": "')[1].split('"')[0] for l in lines] == ["regulation.pdf", "circular.pdf", "guidance.pdf", "unknown.pdf"]
    assert "highest authority first" in r and "authority_rank: 1 = legal acts" in r


# --------------------------------------------------------------- result formatter
def test_formatter_dedup_budget_and_no_stop_signal(components):
    m = components("result_formatter")
    F = m.ResultFormatter()
    docs = [doc(i, "Payments guide.pdf", f"Step {i}", version="v3") for i in range(3)]
    r = F.run(documents=docs)
    assert len(r["documents"]) == 3 and r["result"].count("<document ") == 3
    assert 'version="v3"' in r["result"] and "doc_type=" not in r["result"]
    assert "search again" in r["result"]
    r = F.run(documents=docs, state_documents=docs[:2])
    assert len(r["documents"]) == 1 and r["result"].count("<document ") == 3
    r = F.run(documents=[])
    assert "about the QUERY, not about the corpus" in r["result"] and r["documents"] == []
    long = [Document(id="L", content="a" * 13000, meta=dict(file_name="big.pdf", file_id="b", split_id=0))]
    assert 'truncated="true"' in F.run(documents=long)["result"]


def test_formatter_substitution(components):
    code = component_code("result_formatter", {"formatter_intro": "INTRO-X", "formatter_outro": "OUTRO-X search again",
                                               "formatter_empty": "EMPTY-X", "extra_attrs": ["authority_rank"]})
    m = components("result_formatter", code)
    r = m.ResultFormatter().run(documents=[doc(0, "a.pdf", "t", authority_rank=1)])["result"]
    assert r.startswith("INTRO-X") and r.rstrip().endswith("OUTRO-X search again") and 'authority_rank="1"' in r
    assert m.ResultFormatter().run(documents=[])["result"] == "EMPTY-X"


# -------------------------------------------------------------------- filters
def test_file_filter_with_and_without_base(components):
    m = components("file_filter")
    F = m.FileFilter()
    assert F.run(file_ids=["a", "", "b"])["filters"] == {"field": "file_id", "operator": "in", "value": ["a", "b"]}
    base = {"field": "alina_project_ids", "operator": "in", "value": ["p1"]}
    r = F.run(file_ids=["a"], base_filters=base)["filters"]
    assert r["operator"] == "AND" and r["conditions"][0] == base and r["conditions"][1]["value"] == ["a"]


def test_scan_filter_ands_entitlement(components):
    m = components("scan_filter")
    r = m.ScanFilterBuilder().run()["filters"]
    assert r == {"operator": "AND", "conditions": [{"field": "split_id", "operator": "==", "value": 0}]}
    base = {"field": "alina_project_ids", "operator": "in", "value": ["p1"]}
    r = m.ScanFilterBuilder().run(base_filters=base)["filters"]
    assert r["conditions"][0] == base and r["conditions"][1]["field"] == "split_id"


# ----------------------------------------------------------------- attachments
def test_attachments_stamp_budget_seed(components):
    S = components("attachment_stamper").AttachmentMetadataStamper()
    A = components("attachment_formatter").AttachmentFormatter()
    att = [Document(id=f"att{i}", content=f"attached text {i}", meta=dict(file_name="memo.docx")) for i in range(3)]
    st = S.run(documents=att)["documents"]
    assert all(d.meta["doc_type"] == "attachment" and d.meta["split_id"] == i and d.meta["file_id"] == d.id for i, d in enumerate(st))
    r = A.run(documents=st)
    assert r["result"].count("<document ") == 3 and len(r["documents"]) == 3
    assert 'section="Attached file: memo.docx"' in r["result"]
    assert A.run(documents=[]) == {"result": "", "documents": []}
    many = S.run(documents=[Document(id=f"m{i}", content="x", meta=dict(file_name="big.pdf")) for i in range(50)])["documents"]
    r = A.run(documents=many)
    assert len(r["documents"]) == 40 and "first 40 are shown" in r["result"]


def test_attachment_stamp_substitution(components):
    m = components("attachment_stamper", component_code("attachment_stamper", {"attachment_stamp": {"authority_rank": 0}}))
    d = m.AttachmentMetadataStamper().run(documents=[Document(id="x", content="c", meta={})])["documents"][0]
    assert d.meta["authority_rank"] == 0 and "doc_type" not in d.meta


# -------------------------------------------------------------------- history
def test_history_sanitizer(components):
    H = components("history_sanitizer").HistorySanitizer()
    hist = [ChatMessage.from_system("sys"), ChatMessage.from_user("How do I create a PO?"),
            ChatMessage.from_assistant("Use the Create Purchase Order app [1]."),
            ChatMessage.from_assistant(""), ChatMessage.from_user("   ")]
    r = H.run(messages=hist)["messages"]
    assert len(r) == 2 and r[0].is_from("user") and r[1].is_from("assistant")
    assert H.run(messages=None)["messages"] == []


# ------------------------------------------------------------------ renumberer
def test_citation_renumberer_end_to_end(components):
    R = components("citation_renumberer").CitationRenumberer()
    docs = [doc(i, "Payments guide.pdf", f"Step {i}") for i in range(3)]
    d0, d1, d2 = docs
    answer = ChatMessage.from_assistant(
        f"First do this [{tok(d2)}]. Then that [{tok(d0)}][{tok(d2)}]. Bogus [deadbe] and [{tok(d0).upper()}].")
    msgs = [ChatMessage.from_user("q"), ChatMessage.from_assistant(text="", tool_calls=None), answer]
    r = R.run(messages=msgs, documents=docs)
    assert len(r["messages"]) == 1
    assert r["messages"][0].text == "First do this [1]. Then that [2][1]. Bogus  and [2]."
    assert [d.id for d in r["documents"]] == [d2.id, d0.id]
    assert [d.meta["citation_number"] for d in r["documents"]] == [1, 2]
    assert all(d.meta["citation_token"] == tok(d) for d in r["documents"])
    r = R.run(messages=[ChatMessage.from_user("hi"), ChatMessage.from_assistant("Hello!")], documents=docs)
    assert r["messages"][0].text == "Hello!" and len(r["documents"]) == 3


def test_citation_token_identical_across_modules(components):
    d = Document(id="abc", content="x")
    tokens = {components(m).citation_token(d.id) for m in ("attachment_formatter", "result_formatter", "citation_renumberer")}
    assert len(tokens) == 1
