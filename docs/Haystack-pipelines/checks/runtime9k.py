"""Executes the 9k components out of the YAML, against haystack stubs, using the
real failing inputs from the v40/v41 traces."""
import yaml,sys,types,re,hashlib
hs=types.ModuleType("haystack")
def cd(c): return c
cd.output_types=lambda **k:(lambda f:f)
hs.component=cd
dc=types.ModuleType("haystack.dataclasses")
class Document:
    def __init__(s,id=None,content=None,meta=None): s.id=id; s.content=content; s.meta=meta or {}
class ChatMessage:
    def __init__(s,role,text,meta=None): s.role=role; s._t=text; s.meta=meta or {}
    @property
    def text(s): return s._t
    @staticmethod
    def from_assistant(text=None,meta=None): return ChatMessage('assistant',text,meta)
dc.Document=Document; dc.ChatMessage=ChatMessage; hs.dataclasses=dc
sys.modules['haystack']=hs; sys.modules['haystack.dataclasses']=dc
Y=yaml.safe_load(open('v1-agent-9k.yaml',encoding='utf-8'))
T={t['data']['name']:t['data'] for t in Y['components']['agent']['init_parameters']['tools']}
def load(code,cls):
    ns={}; exec(code,ns); return ns[cls]()
ok=True
def chk(c,m):
    global ok; print(("PASS " if c else "FAIL ")+m); ok=ok and bool(c)
d=lambda i,fn,c,**kw: Document(id=i,content=c,meta=dict(file_name=fn,header='h',page_number=1,**kw))

print("=== search_in_file formatter: the layer runs on BOTH shapes now ===")
RF=load(T['search_in_file']['pipeline']['components']['result_formatter']['init_parameters']['code'],'ResultFormatter')
prim=[d('p%d'%i,'Financial Regulation (2024).pdf','FR text %d'%i) for i in range(3)]
guid=[d('g%d'%i,'vademecum-public-procurement-en (1).pdf','Vademecum %d'%i) for i in range(10)]
r=RF.run(documents=prim, guidance_documents=guid, question_shape="practical")
chk('IMPLEMENTING GUIDANCE' in r['result'], "practical: guidance block rendered")
chk(r['result'].count('<document ')==3+8, "practical: 8 guidance passages")
r=RF.run(documents=prim, guidance_documents=guid, question_shape="lookup")
chk('IMPLEMENTING GUIDANCE' in r['result'], "lookup: guidance STILL rendered (9j suppressed it)")
chk(r['result'].count('<document ')==3+4, "lookup: narrowed to 4 passages")
r=RF.run(documents=prim, guidance_documents=guid, question_shape=None)
chk(r['result'].count('<document ')==3+8, "null shape falls through to practical")
print("\n=== no stop signals anywhere ===")
for shape in ("practical","lookup"):
    for docs,g,lab in [(prim,guid,'both layers'),(prim,[],'primary only'),([],guid,'guidance only'),([],[],'empty')]:
        res=RF.run(documents=docs, guidance_documents=g, question_shape=shape)['result']
        bad=[p for p in ("no further search is needed","complete answer","you are done") if p in res]
        chk(not bad, f"{shape}/{lab}: no stop phrase {bad if bad else ''}")
res=RF.run(documents=[],guidance_documents=[],question_shape="lookup")['result']
chk("reformulate" in res and "search again" in res, "empty result tells it to reformulate (GS-010 case)")
chk("about the QUERY, not about the document" in res, "empty result reframed as a query problem")
res=RF.run(documents=prim,guidance_documents=guid,question_shape="practical")['result']
chk("search again with different terms" in res, "non-empty result still invites another query (GS-014 case)")
res=RF.run(documents=[],guidance_documents=guid,question_shape="practical")['result']
chk("do not answer a question scoped to the named one" in res or "do not answer a question scoped" in res,
    "named doc empty but guidance present: warns not to substitute")

print("\n=== search_corpus formatter: single layer, no stop signal ===")
SC=load(T['search_corpus']['pipeline']['components']['result_formatter']['init_parameters']['code'],'ResultFormatter')
r=SC.run(documents=prim)
chk('IMPLEMENTING GUIDANCE' not in r['result'], "no second layer")
chk("search again" in r['result'], "invites another query")
chk("not everything the corpus holds" in r['result'], "states it is not exhaustive")
r=SC.run(documents=[])
chk("reformulate" in r['result'] and "before concluding anything" in r['result'], "empty: reformulate, do not conclude")

print("\n=== lister: the GS-008 case ===")
L=load(T['list_corpus_files']['pipeline']['components']['lister']['init_parameters']['code'],'CorpusFileLister')
target=d('t1','2. Draft Contract template_v2 - MC1 - SIDE III.pdf','x',file_id='6d22df73',authority_rank=4)
out=L.run(documents=[target], name_matches=[target], name_pattern="SIDE III MC1")['result']
chk('MC1 - SIDE III' in out, "reordered pattern 'SIDE III MC1' now finds the file (9j returned no match)")
out=L.run(documents=[target], name_matches=[target], name_pattern="SIDE III")['result']
chk('MC1 - SIDE III' in out, "the pattern that worked in 9i still works")
out=L.run(documents=[target], name_matches=[target], name_pattern="vademecum")['result']
chk('No accessible document matches' in out, "an absent word still excludes (no over-matching)")
corpus=[d('f%d'%i,'File %03d.pdf'%i,'x',file_id='id%d'%i,authority_rank=3) for i in range(491)]
out=L.run(documents=corpus, name_matches=[], name_pattern="")['result']
chk('491 accessible document(s)' in out, "all 491 files listed (9j capped at 400 and hid GS-008's file)")
chk('THIS LISTING IS INCOMPLETE' not in out, "complete listing carries no truncation warning")
big=[d('b%d'%i,'File %04d.pdf'%i,'x',file_id='b%d'%i,authority_rank=3) for i in range(700)]
out=L.run(documents=big, name_matches=[], name_pattern="")['result']
chk('THIS LISTING IS INCOMPLETE' in out and 'may NOT conclude' in out, "over the cap: forbids concluding absence")

print("\n=== citation_renumberer: 9c/9d contracts, no twin logic ===")
CR=load(Y['components']['citation_renumberer']['init_parameters']['code'],'CitationRenumberer')
tok=lambda i: hashlib.sha1(str(i).encode()).hexdigest()[:6].lower()
A=d('a','Liquidated Damages Application Guidance.pdf','P1'); B=d('b','Liquidated+Damages+Application+Guidance.docx','P2'); C=d('c','FR.pdf','P3')
docs=[A,B,C]
r=CR.run(messages=[ChatMessage('assistant',f"x[{tok('a')}] y[{tok('b')}] z[{tok('c')}]")],documents=docs)
chk(r['messages'][0].text=="x[1] y[2] z[3]", "distinct documents keep distinct numbers")
chk(len(r['documents'])==3 and [x.meta['citation_number'] for x in r['documents']]==[1,2,3], "panel aligned with numbering")
chk(len(r['messages'])==1, "[O2] still returns only the answer")
r=CR.run(messages=[ChatMessage('assistant',f"a[{tok('c')}] bad[deadbe] b[{tok('a')}]")],documents=docs)
chk(r['messages'][0].text=="a[1] bad b[2]", "9d INVARIANT: invented token dropped without shifting")
r=CR.run(messages=[ChatMessage('assistant',"Hi.")],documents=docs)
chk(len(r['documents'])==3, "no citations: consulted docs passed through")
r=CR.run(messages=[],documents=[])
chk(r['messages']==[] and r['documents']==[], "empty input does not crash")

print("\n=== guidance_filter still ANDs entitlement (security) ===")
GF=load(T['search_in_file']['pipeline']['components']['guidance_filter']['init_parameters']['code'],'GuidanceFilterBuilder')
ent={"field":"alina_project_ids","operator":"in","value":["p1"]}
r=GF.run(excluded_file_ids=["abc"],base_filters=ent)
chk(ent in r['filters']['conditions'], "entitlement ANDed, never replaced")
ex=[c for c in r['filters']['conditions'] if c.get('field')=='file_id'][0]
chk(ex['operator']=="not in" and "4abf8796-9157-4ceb-932e-74cb788e4f1b" in ex['value'] and "abc" in ex['value'],
    "excludes searched files and the FR")
chk(GF.run(excluded_file_ids=[],base_filters=None)['filters']['conditions'][0]['operator']=="not in", "empty-filters path safe")
sys.exit(0 if ok else 1)
