"""Executes the Code components of summa-agent-draft-1.yaml against the REAL haystack
classes (pip install haystack-ai pyyaml). No deepset, no OpenSearch, no model.
Run from docs/Haystack-pipelines/summa:  python checks/runtime_summa_draft1.py
"""
import sys

import yaml
from haystack.dataclasses import ChatMessage, Document

Y = yaml.safe_load(open("summa-agent-draft-1.yaml", encoding="utf-8"))
C = Y["components"]
T = {t["data"]["name"]: t["data"] for t in C["agent"]["init_parameters"]["tools"]}
ok = True


def chk(cond, msg):
    global ok
    print(("PASS " if cond else "FAIL ") + msg)
    ok = ok and bool(cond)


def load(code, cls):
    ns = {}
    exec(code, ns)
    return ns[cls]()


def doc(i, name, content, **meta):
    base = dict(file_name=name, file_id=f"fid-{name}", split_id=i, header=f"Section {i}", page_number=i + 1)
    base.update(meta)
    return Document(id=f"{name}-{i}", content=content, meta=base)


print("=== consult_reference_qa: ships empty, says so, and works once filled ===")
qa_code = T["consult_reference_qa"]["pipeline"]["components"]["qa_lookup"]["init_parameters"]["code"]
QA = load(qa_code, "ReferenceQALookup")
r = QA.run(query="how do I create a purchase order")["result"]
chk("No reference Q&A entries are configured" in r, "empty set: tells the agent to go to the search tools")
filled = qa_code.replace(
    "QA_ENTRIES = []",
    'QA_ENTRIES = [{"question": "How do I create a purchase order?", "answer": "Use the Create Purchase Order '
    'app, enter the business partner and the items, then submit for approval.", "sources": ["Procurement guide s.3"]},'
    '{"question": "How do I request a down payment?", "answer": "Open Manage Down Payment Requests and reference the '
    'purchase order.", "sources": ["Payments guide s.4.2"]}]',
)
QA2 = load(filled, "ReferenceQALookup")
r = QA2.run(query="create a PO purchase order")["result"]
chk("Reference entry 1: How do I create a purchase order?" in r, "filled set: best entry first")
chk("GUIDANCE ONLY" in r and "Never quote or cite them" in r, "filled set: guidance-only header")
r = QA2.run(query="down payment request")["result"]
chk("down payment" in r.split("Reference entry 1:")[1][:60], "filled set: second entry retrievable")
r = QA2.run(query="xyzzy frobnicate")["result"]
chk("No reference entry matches" in r and "search_corpus" in r, "filled set: no match points at search_corpus")

print("\n=== list_corpus_files lister ===")
L = load(T["list_corpus_files"]["pipeline"]["components"]["lister"]["init_parameters"]["code"], "CorpusFileLister")
scan = [
    doc(0, "SUMMA Payments User Guide v3.pdf", "x", doc_type="user guide", version="v3", document_date="2025-06-01"),
    doc(0, "Release notes 2025-Q3.pdf", "x", doc_type="release notes", document_date="2025-09-15"),
    doc(0, "VAT quick reference card.pdf", "x"),
]
r = L.run(documents=scan, name_matches=[], name_pattern="")["result"]
chk(r.startswith("3 document(s), alphabetical"), "empty pattern lists everything")
chk('"doc_type": "unknown"' in r and '"version": "v3"' in r, "metadata rendered with unknown fallback")
r = L.run(documents=scan, name_matches=[], name_pattern="payments guide")["result"]
chk("1 document(s)" in r and "Payments User Guide" in r, "token match in any order")
r = L.run(documents=scan, name_matches=[], name_pattern="guide payments")["result"]
chk("1 document(s)" in r, "reversed token order still matches")
r = L.run(documents=[], name_matches=[doc(0, "Hidden manual.pdf", "x")], name_pattern="hidden")["result"]
chk("Hidden manual" in r, "BM25 name hits add files the scan missed")
r = L.run(documents=scan, name_matches=[], name_pattern="nonexistent")["result"]
chk('No document matches "nonexistent"' in r and "answer from search_corpus" in r, "miss: retry advice, no absence verdict")
big = [doc(0, f"file-{i:04d}.pdf", "x") for i in range(700)]
r = L.run(documents=big, name_matches=[], name_pattern="")["result"]
chk("THIS LISTING IS INCOMPLETE" in r and "600 of 700" in r, "unfiltered cap says the listing is incomplete")
r = L.run(documents=big, name_matches=[], name_pattern="file-06")["result"]
expected = sum(1 for d in big if "file-06" in d.meta["file_name"] or "06" in d.meta["file_name"])
chk("INCOMPLETE" not in r and r.startswith(f"{expected} document(s)"), f"a filtered listing is never truncated ({expected} matches)")
display = doc(0, "SUMMA_PAY_v3.pdf", "x", display_name="Payments User Guide")
r = L.run(documents=[display], name_matches=[], name_pattern="payments")["result"]
chk('"file_name": "Payments User Guide"' in r, "display_name preferred as the shown name")

print("\n=== search_corpus formatter ===")
F = load(T["search_corpus"]["pipeline"]["components"]["result_formatter"]["init_parameters"]["code"], "ResultFormatter")
docs = [doc(i, "Payments guide.pdf", f"Step {i}", version="v3") for i in range(3)]
r = F.run(documents=docs)
chk(len(r["documents"]) == 3, "all new docs go to state")
chk(r["result"].count("<document ") == 3, "all rendered")
chk('version="v3"' in r["result"] and "doc_type=" not in r["result"], "optional attributes only when present")
chk("search again" in r["result"] and "not everything the corpus holds" in r["result"], "no stop signal")
r = F.run(documents=docs, state_documents=docs[:2])
chk(len(r["documents"]) == 1 and r["result"].count("<document ") == 3, "known docs re-rendered but not re-appended")
r = F.run(documents=[])
chk("about the QUERY, not about the corpus" in r["result"] and r["documents"] == [], "empty: reframed as a query problem")
long = [Document(id="L", content="a" * 13000, meta=dict(file_name="big.pdf", file_id="b", split_id=0))]
r = F.run(documents=long)
chk('truncated="true"' in r["result"] and "continues beyond" in r["result"], "per-doc budget marks truncation")

print("\n=== search_in_file formatter and file filter ===")
FF = load(T["search_in_file"]["pipeline"]["components"]["file_filter"]["init_parameters"]["code"], "FileFilter")
r = FF.run(file_ids=["a", "", "b"])["filters"]
chk(r == {"field": "file_id", "operator": "in", "value": ["a", "b"]}, "file filter drops empty ids")
F2 = load(T["search_in_file"]["pipeline"]["components"]["result_formatter"]["init_parameters"]["code"], "ResultFormatter")
r = F2.run(documents=[])
chk("Only after a second formulation has also failed" in r["result"], "in-file miss: no absence verdict after one try")
r = F2.run(documents=docs)
chk("requested document(s)" in r["result"] and "search again" in r["result"], "in-file hit: no stop signal")

print("\n=== attachments: stamper -> formatter ===")
S = load(C["attachment_metadata_stamper"]["init_parameters"]["code"], "AttachmentMetadataStamper")
A = load(C["attachment_formatter"]["init_parameters"]["code"], "AttachmentFormatter")
att = [Document(id=f"att{i}", content=f"attached text {i}", meta=dict(file_name="memo.docx")) for i in range(3)]
st = S.run(documents=att)["documents"]
chk(all(d.meta["doc_type"] == "attachment" and d.meta["split_id"] == i for i, d in enumerate(st)), "stamped")
chk(all(d.meta["file_id"] == d.id for d in st), "file_id falls back to document id")
r = A.run(documents=st)
chk(r["result"].count("<document ") == 3 and len(r["documents"]) == 3, "attachments rendered and seeded")
chk('source="memo.docx"' in r["result"] and 'section="Attached file: memo.docx"' in r["result"], "attachment header")
r = A.run(documents=[])
chk(r["result"] == "" and r["documents"] == [], "no attachments: empty block, so the user_prompt if-branch is skipped")
many = [Document(id=f"m{i}", content="x", meta=dict(file_name="big.pdf")) for i in range(50)]
r = A.run(documents=S.run(documents=many)["documents"])
chk(len(r["documents"]) == 40 and "first 40 are shown" in r["result"], "attachment cap")

print("\n=== history sanitizer, real ChatMessage ===")
H = load(C["history_sanitizer"]["init_parameters"]["code"], "HistorySanitizer")
hist = [
    ChatMessage.from_system("sys"),
    ChatMessage.from_user("How do I create a PO?"),
    ChatMessage.from_assistant("Use the Create Purchase Order app [1]."),
    ChatMessage.from_assistant(""),
    ChatMessage.from_user("   "),
]
r = H.run(messages=hist)["messages"]
chk(len(r) == 2 and r[0].is_from("user") and r[1].is_from("assistant"), "system, empty and blank turns dropped")
chk(r[0].text == "How do I create a PO?", "user text preserved")
r = H.run(messages=None)["messages"]
chk(r == [], "no history is fine")

print("\n=== citation renumberer, real ChatMessage, end to end with the formatter tokens ===")
R = load(C["citation_renumberer"]["init_parameters"]["code"], "CitationRenumberer")
import hashlib
tok = lambda d: hashlib.sha1(d.id.encode()).hexdigest()[:6]
d0, d1, d2 = docs
answer = ChatMessage.from_assistant(
    f"First do this [{tok(d2)}]. Then that [{tok(d0)}][{tok(d2)}]. Bogus [deadbe] and [{tok(d0).upper()}]."
)
msgs = [ChatMessage.from_user("q"), ChatMessage.from_assistant(text="", tool_calls=None), answer]
r = R.run(messages=msgs, documents=docs)
chk(len(r["messages"]) == 1, "only the answer leaves the pipeline")
chk(r["messages"][0].text == "First do this [1]. Then that [2][1]. Bogus  and [2].", f"renumbered: {r['messages'][0].text!r}")
chk([d.id for d in r["documents"]] == [d2.id, d0.id], "documents in first-appearance order")
chk([d.meta["citation_number"] for d in r["documents"]] == [1, 2], "citation_number set")
chk(all(d.meta["citation_token"] == tok(d) for d in r["documents"]), "citation_token set")
r = R.run(messages=[ChatMessage.from_user("hi"), ChatMessage.from_assistant("Hello! How can I help?")], documents=docs)
chk(r["messages"][0].text == "Hello! How can I help?" and len(r["documents"]) == 3, "no citations: consulted docs still returned")
sys.exit(0 if ok else 1)
