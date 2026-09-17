import yaml,sys
ok=True
def chk(c,m):
    global ok; print(("PASS " if c else "FAIL ")+m); ok=ok and bool(c)
new=yaml.safe_load(open('v1-agent-9k.yaml',encoding='utf-8'))
j=yaml.safe_load(open('v1-agent-9j.yaml',encoding='utf-8'))
i9=yaml.safe_load(open('v1-agent-9i.yaml',encoding='utf-8'))

print("=== contract (must equal 9i) ===")
for k in ['inputs','outputs','connections','pipeline_output_type','max_runs_per_component']:
    chk(new[k]==i9[k], f"{k} unchanged since 9i")
chk(list(new['components'])==list(i9['components']), "component list unchanged")
na=new['components']['agent']['init_parameters']; oa=i9['components']['agent']['init_parameters']
for k in ['state_schema','exit_conditions','max_agent_steps','chat_generator','user_prompt','raise_on_tool_invocation_failure']:
    chk(na[k]==oa[k], f"agent.{k} unchanged since 9i")

print("\n=== all code compiles ===")
def walk(n,p=""):
    global ok
    if isinstance(n,dict):
        for k,v in n.items():
            if k=='code' and isinstance(v,str):
                try: compile(v,p,'exec'); print(f"PASS {p} ({len(v.splitlines())} lines)")
                except SyntaxError as e: print(f"FAIL {p}: {e}"); ok=False
            else: walk(v,f"{p}/{k}")
    elif isinstance(n,list):
        for x,v in enumerate(n): walk(v,f"{p}[{x}]")
walk(new['components'],"components")

print("\n=== 9j undone ===")
tools={t['data']['name']:t['data'] for t in na['tools']}
sc,sif=tools['search_corpus'],tools['search_in_file']
chk('question_shape' not in sc['parameters']['properties'], "search_corpus: question_shape removed")
chk(sc['parameters']==i9['components']['agent']['init_parameters']['tools'][2]['data']['parameters'], "search_corpus: parameters back to 9i")
chk(sc['input_mapping']==i9['components']['agent']['init_parameters']['tools'][2]['data']['input_mapping'], "search_corpus: input_mapping back to 9i")
chk(set(sc['pipeline']['components'])==set(i9['components']['agent']['init_parameters']['tools'][2]['data']['pipeline']['components']), "search_corpus: no extra components left")
chk(sc['pipeline']['connections']==i9['components']['agent']['init_parameters']['tools'][2]['data']['pipeline']['connections'], "search_corpus: connections back to 9i")
cr=new['components']['citation_renumberer']['init_parameters']['code']
chk('twin_key' not in cr and 'ADJACENT' not in cr and 'is_wiki_copy' not in cr, "citation_renumberer: twin collapse removed")
chk('return {"documents": cited or deduplicated(), "messages": [answer]}' in cr, "citation_renumberer: [O2] kept")
sp=na['system_prompt']
chk('Name the instrument by its document name' not in sp, "prompt: label rule removed")

print("\n=== 9k in place ===")
sifc=sif['pipeline']['components']
chk('guidance_gate' not in sifc, "search_in_file: guidance_gate removed")
chk({'guidance_filter','guidance_bm25'} <= set(sifc), "search_in_file: guidance layer kept")
chk('question_shape' in sif['parameters']['properties'] and 'question_shape' in sif['parameters']['required'], "search_in_file: question_shape still declared")
chk(sif['input_mapping']['question_shape']==['result_formatter.question_shape'], "question_shape -> formatter, not a gate")
chk('guidance_bm25.query' in sif['input_mapping']['query'], "query feeds guidance_bm25 directly (layer always runs)")
conns=[(c['sender'],c['receiver']) for c in sif['pipeline']['connections']]
chk(('guidance_bm25.documents','result_formatter.guidance_documents') in conns, "guidance_bm25 -> formatter")
chk(not any(s.startswith('guidance_gate') for s,_ in conns), "no dangling gate connection")
rf=sifc['result_formatter']['init_parameters']['code']
for frag,lab in [("no further search is needed","stop signal A"),("the provision above is the complete answer","stop signal B")]:
    chk(frag not in rf, f"search_in_file formatter: {lab} gone")
chk("search again" in rf and "never a guarantee of completeness" in rf, "search_in_file formatter: keep-searching instruction present")
chk("GUIDANCE_LOOKUP = 4" in rf and "GUIDANCE_PRACTICAL = 8" in rf, "guidance rendering caps 4/8")
scrf=sc['pipeline']['components']['result_formatter']['init_parameters']['code']
chk("search again" in scrf, "search_corpus formatter: keep-searching instruction present")
chk("primary_documents" not in scrf, "search_corpus formatter: second layer gone")
lister=tools['list_corpus_files']['pipeline']['components']['lister']['init_parameters']['code']
chk("MAX_FILES_UNFILTERED = 600" in lister, "lister: cap raised to 600")
chk("all(w in low for w in tokens)" in lister, "lister: token-level name matching")
chk("THIS LISTING IS INCOMPLETE" in lister, "lister: truncation forbids concluding absence")
for frag,lab in [("Word order does not matter","prompt: word-order note"),
                 ("only a\nlisting that does NOT announce itself as incomplete","prompt: conditional exhaustiveness"),
                 ("No tool result is ever a licence to stop searching","prompt: no-stop rule"),
                 ("reading more and writing less is always allowed","prompt: shape scope")]:
    chk(frag.replace("\n"," ") in " ".join(sp.split()), lab)
raw=open('v1-agent-9k.yaml',encoding='utf-8').read()
chk(raw.count('—')==0 and raw.count('–')==0, "no em/en dashes")
sys.exit(0 if ok else 1)
