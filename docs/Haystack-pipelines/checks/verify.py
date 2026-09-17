import yaml, sys, re
ok=True
def chk(cond,msg):
    global ok
    print(("PASS " if cond else "FAIL ")+msg)
    if not cond: ok=False

new=yaml.safe_load(open('v1-agent-9j.yaml',encoding='utf-8'))
old=yaml.safe_load(open('v1-agent-9i.yaml',encoding='utf-8'))
print("=== 1. structure ===")
chk(list(new.keys())==list(old.keys()), "top-level keys unchanged")
chk(new['inputs']==old['inputs'], "pipeline inputs unchanged (app contract)")
chk(new['outputs']==old['outputs'], "pipeline outputs unchanged (app contract)")
chk(new['connections']==old['connections'], "top-level connections unchanged")
chk(new['pipeline_output_type']==old['pipeline_output_type'], "pipeline_output_type unchanged")
chk(list(new['components'])==list(old['components']), "component list unchanged")

na=new['components']['agent']['init_parameters']; oa=old['components']['agent']['init_parameters']
chk(na['state_schema']==oa['state_schema'], "agent state_schema unchanged")
chk(na['exit_conditions']==oa['exit_conditions'], "exit_conditions unchanged")
chk(na['max_agent_steps']==oa['max_agent_steps'], "max_agent_steps unchanged")
chk(na['chat_generator']==oa['chat_generator'], "chat_generator unchanged")
chk(na['user_prompt']==oa['user_prompt'], "user_prompt unchanged")
chk('streaming_callback' not in na, "streaming still off")

print("\n=== 2. every python code block compiles ===")
def walk(node,path=""):
    if isinstance(node,dict):
        for k,v in node.items():
            if k=='code' and isinstance(v,str):
                try:
                    compile(v,path,'exec'); print(f"PASS compiles: {path} ({len(v.splitlines())} lines)")
                except SyntaxError as e:
                    print(f"FAIL compiles: {path}: {e}"); globals().__setitem__('ok',False)
            else: walk(v,f"{path}/{k}")
    elif isinstance(node,list):
        for i,v in enumerate(node): walk(v,f"{path}[{i}]")
walk(new['components'],"components")

print("\n=== 3. tools ===")
tools={t['data']['name']:t['data'] for t in na['tools']}
chk(set(tools)== {'consult_reference_qa','list_corpus_files','search_corpus','search_in_file'}, "same 4 tools")
otools={t['data']['name']:t['data'] for t in oa['tools']}
chk(tools['consult_reference_qa']==otools['consult_reference_qa'], "consult_reference_qa untouched")
chk(tools['list_corpus_files']==otools['list_corpus_files'], "list_corpus_files untouched")

for name,gate,layer in [('search_corpus','primary_gate','primary_documents'),
                        ('search_in_file','guidance_gate','guidance_documents')]:
    d=tools[name]; p=d['parameters']
    chk('question_shape' in p['properties'], f"{name}: question_shape declared")
    chk(p['properties']['question_shape']['enum']==['lookup','practical'], f"{name}: enum lookup|practical")
    chk('question_shape' in p['required'], f"{name}: question_shape required")
    chk('filters' not in p['properties'] and 'state_documents' not in p['properties'],
        f"{name}: state-fed inputs still hidden from the LLM schema (draft-6 security rule)")
    im=d['input_mapping']
    chk(f'{gate}.question_shape' in im['question_shape'], f"{name}: question_shape -> {gate}")
    comps=d['pipeline']['components']
    chk(gate in comps, f"{name}: {gate} present")
    conns=[(c['sender'],c['receiver']) for c in d['pipeline']['connections']]
    chk((f'{gate}.query', f'{gate.split("_")[0]}_bm25.query') in conns, f"{name}: gate -> bm25 query")
    bm=f'{gate.split("_")[0]}_bm25'
    filt=f'{gate.split("_")[0]}_filter'
    chk((f'{filt}.filters', f'{bm}.filters') in conns, f"{name}: filter -> bm25 filters")
    chk((f'{bm}.documents', f'result_formatter.{layer}') in conns, f"{name}: bm25 -> formatter {layer}")
    chk(comps[bm]['init_parameters']['top_k']==12, f"{name}: {bm} top_k 12")
    # no reranker/embedder added to the second layer
    added=set(comps)-set(otools[name]['pipeline']['components'])
    chk(added=={gate,filt,bm}, f"{name}: exactly 3 new components ({sorted(added)})")
    # outputs/state contract unchanged
    chk(d['output_mapping']==otools[name]['output_mapping'], f"{name}: output_mapping unchanged")
    chk(d['outputs_to_state']==otools[name]['outputs_to_state'], f"{name}: outputs_to_state unchanged")
    chk(d['outputs_to_string']==otools[name]['outputs_to_string'], f"{name}: outputs_to_string unchanged")
    chk(d['inputs_from_state']==otools[name]['inputs_from_state'], f"{name}: inputs_from_state unchanged")
    # entitlement filters reach the new filter builder
    chk(f'{filt}.base_filters' in im['filters'], f"{name}: entitlement filters reach {filt}")
    # unchanged retrieval chain
    for c in ['bm25_retriever','embedding_retriever','ranker','ranker_scoring','sentence_window_retriever','meta_field_grouping_ranker','query_embedder','document_joiner','window_joiner','retrieval_query']:
        chk(comps[c]==otools[name]['pipeline']['components'][c], f"{name}: {c} untouched")

chk('guidance_filter.excluded_file_ids' in tools['search_in_file']['input_mapping']['file_ids'],
    "search_in_file: file_ids also excluded from the guidance layer")

print("\n=== 4. system prompt ===")
sp=na['system_prompt']
for frag,label in [("question_shape` parameter","mentions the parameter"),
                   ("IMPLEMENTING GUIDANCE block","points at the guidance block"),
                   ("5. Coverage","new pre-answer check 5"),
                   ("## Article 174 ##","label-fidelity rule"),
                   ("is NOT a structural label","warns section is not a label")]:
    chk(frag in sp, f"prompt: {label}")
chk("Stopping\nat the FR" not in sp and "Stopping at the FR" not in sp, "prompt: old 'stopping at the FR' rule removed")
chk(sp.startswith("{% message role=\"system\" %}") or sp.lstrip().startswith("{% message"), "prompt: still opens the system message")
chk(sp.rstrip().endswith("{% endmessage %}"), "prompt: still closes the system message")
for frag in ["4abf8796-9157-4ceb-932e-74cb788e4f1b","NEVER refuse on the topic","authority_rank","`list_corpus_files` matches on the file name"]:
    chk(frag in sp, f"prompt: preserved '{frag[:40]}'")

print("\n=== 5. formatting hygiene ===")
raw=open('v1-agent-9j.yaml',encoding='utf-8').read()
chk(raw.count('—')==0 and raw.count('–')==0, "no em/en dashes introduced")
chk('\t' not in raw, "no tabs")
chk(raw.count('citation_token(document_id)')>=1, "citation_token contract kept")
sys.exit(0 if ok else 1)
