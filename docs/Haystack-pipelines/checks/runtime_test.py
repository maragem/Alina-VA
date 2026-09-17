"""Executes the NEW components straight out of 9j.yaml, against haystack stubs."""
import yaml, sys, types, re

# ---- minimal haystack stubs ----
hs=types.ModuleType("haystack")
def component_deco(cls): return cls
component_deco.output_types=lambda **k:(lambda f:f)
hs.component=component_deco
dc=types.ModuleType("haystack.dataclasses")
class Document:
    def __init__(s,id=None,content=None,meta=None): s.id=id; s.content=content; s.meta=meta or {}
class ChatMessage:
    def __init__(s,role,text,meta=None): s.role=role; s._t=text; s.meta=meta or {}
    @property
    def text(s): return s._t
    @staticmethod
    def from_assistant(text=None,meta=None): return ChatMessage('assistant',text,meta)
dc.Document=Document; dc.ChatMessage=ChatMessage
hs.dataclasses=dc
sys.modules['haystack']=hs; sys.modules['haystack.dataclasses']=dc

Y=yaml.safe_load(open('v1-agent-9j.yaml',encoding='utf-8'))
tools={t['data']['name']:t['data'] for t in Y['components']['agent']['init_parameters']['tools']}

def load(code, cls):
    ns={}; exec(code, ns); return ns[cls]()

ok=True
def chk(c,m):
    global ok
    print(("PASS " if c else "FAIL ")+m); ok = ok and c

print("=== gates ===")
for tool,comp,cls in [('search_in_file','guidance_gate','GuidanceGate'),('search_corpus','primary_gate','PrimaryGate')]:
    g=load(tools[tool]['pipeline']['components'][comp]['init_parameters']['code'], cls)
    chk(g.run(query="thresholds", question_shape="practical")['query']=="thresholds", f"{comp}: practical passes the query")
    chk(g.run(query="thresholds", question_shape="lookup")['query']=="", f"{comp}: lookup emits empty query (no second layer)")
    chk(g.run(query="x", question_shape="  PRACTICAL ")['query']=="x", f"{comp}: tolerant of case/whitespace")
    chk(g.run(query="x", question_shape=None)['query']=="x", f"{comp}: FAIL SAFE - null falls through to practical")
    chk(g.run(query="x", question_shape="nonsense")['query']=="x", f"{comp}: FAIL SAFE - unrecognised value falls through to practical")
    chk(g.run(query="x", question_shape="LOOKUP")['query']=="", f"{comp}: only an explicit lookup suppresses the layer")

print("\n=== filter builders (SECURITY) ===")
gf=load(tools['search_in_file']['pipeline']['components']['guidance_filter']['init_parameters']['code'],'GuidanceFilterBuilder')
FR="4abf8796-9157-4ceb-932e-74cb788e4f1b"
ent={"field":"alina_project_ids","operator":"in","value":["proj-a"]}
r=gf.run(excluded_file_ids=["abc"], base_filters=ent)
chk(r['filters']['operator']=="AND" and ent in r['filters']['conditions'], "guidance_filter: entitlement filters ANDed, never replaced")
excl=[c for c in r['filters']['conditions'] if c.get('field')=='file_id'][0]
chk(excl['operator']=="not in" and FR in excl['value'] and "abc" in excl['value'], "guidance_filter: excludes searched files AND the FR")
r2=gf.run(excluded_file_ids=["abc"], base_filters=None)
chk(r2['filters']['conditions']==[{"field":"file_id","operator":"not in","value":sorted({"abc",FR})}], "guidance_filter: empty-filters path is the whole corpus minus exclusions")
pf=load(tools['search_corpus']['pipeline']['components']['primary_filter']['init_parameters']['code'],'PrimaryFilterBuilder')
r3=pf.run(base_filters=ent)
chk(ent in r3['filters']['conditions'], "primary_filter: entitlement filters ANDed")
chk([c for c in r3['filters']['conditions'] if c.get('field')=='file_id'][0]=={"field":"file_id","operator":"in","value":[FR]}, "primary_filter: restricted to the FR")

print("\n=== result_formatter (two layers) ===")
RF=load(tools['search_in_file']['pipeline']['components']['result_formatter']['init_parameters']['code'],'ResultFormatter')
d=lambda i,fn,c: Document(id=i,content=c,meta={'file_name':fn,'header':'h','page_number':1})
prim=[d('p1','Financial Regulation (2024).pdf','Article 175 text')]
guid=[d('g1','vademecum-public-procurement-en (1).pdf','Section 2.2.3 text')]
r=RF.run(documents=prim, state_documents=None, guidance_documents=guid)
chk('IMPLEMENTING GUIDANCE' in r['result'], "practical: guidance block rendered")
chk(len(r['documents'])==2, "practical: both layers appended to state")
chk(r['result'].count('<documents>')==2, "practical: two document blocks")
r=RF.run(documents=prim, state_documents=None, guidance_documents=[])
chk('IMPLEMENTING GUIDANCE' not in r['result'] and 'No second-layer passages' in r['result'], "lookup: no guidance block, explicit note")
chk(len(r['documents'])==1, "lookup: only the primary layer appended")
r=RF.run(documents=[], state_documents=None, guidance_documents=[])
chk(r['documents']==[] and 'does not contain passages' in r['result'], "empty: unchanged not-found message")
dup=d('p1','Financial Regulation (2024).pdf','Article 175 text')
r=RF.run(documents=prim, state_documents=[dup], guidance_documents=[])
chk(len(r['documents'])==0, "within-call dedup on doc.id still works when state IS populated")
r=RF.run(documents=prim*40, state_documents=None, guidance_documents=guid*20)
chk(r['result'].count('<document ')<=38, "caps respected (30 primary + 8 second)")

print("\n=== citation_renumberer (twins + [O2]) ===")
CR=load(Y['components']['citation_renumberer']['init_parameters']['code'],'CitationRenumberer')
import hashlib
tok=lambda i: hashlib.sha1(str(i).encode()).hexdigest()[:6].lower()
A=d('a','Liquidated Damages Application Guidance.pdf','The AO may waive or reduce LDs.')
B=d('b','Liquidated+Damages+Application+Guidance.docx','The AO  may waive or reduce LDs.')
C=d('c','Financial Regulation (2024).pdf','Article 163 proportionality.')
docs=[B,A,C]
msgs=[ChatMessage('user','q'),ChatMessage('assistant',None),
      ChatMessage('assistant',f"x[{tok('a')}] y[{tok('b')}] z[{tok('c')}].")]
r=CR.run(messages=msgs, documents=docs)
chk(r['messages'][0].text=="x[1] y[1] z[2].", "twins collapse to one number")
chk(len(r['messages'])==1, "[O2]: only the answer leaves the pipeline")
chk(len(r['documents'])==2, "panel holds 2 entries, not 3")
chk(r['documents'][0].meta['file_name'].endswith('.pdf'), "clean copy is the representative")
chk([x.meta['citation_number'] for x in r['documents']]==[1,2], "citation_number matches panel order")
r=CR.run(messages=[ChatMessage('assistant',f"a[{tok('a')}][{tok('b')}] b[{tok('c')}]")], documents=docs)
chk(r['messages'][0].text=="a[1] b[2]", "adjacent twin groups render once")
r=CR.run(messages=[ChatMessage('assistant',f"r[{tok('c')}] bad[deadbe] r2[{tok('a')}]")], documents=docs)
chk(r['messages'][0].text=="r[1] bad r2[2]", "9d INVARIANT: invented token dropped without shifting")
r=CR.run(messages=[ChatMessage('assistant',"Hello.")], documents=docs)
chk(len(r['documents'])==2 and r['messages'][0].text=="Hello.", "no citations: twin-deduped fallback panel")
r=CR.run(messages=[ChatMessage('assistant',f"m[{tok('a')}, {tok('c')}]")], documents=docs)
chk(r['messages'][0].text=="m[1][2]", "comma-separated token group")
r=CR.run(messages=[], documents=[])
chk(r['messages']==[] and r['documents']==[], "empty input does not crash")
sys.exit(0 if ok else 1)
