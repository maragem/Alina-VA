# Test B - is tool calling available on the EC gpt-5.1 endpoint?

## RESULT OF TEST B1 (/responses): FAILED - the endpoint is the problem

The minimal pipeline - one `CodeTool` with a two-string schema, no `PipelineTool`, no
retrieval, no state, no streaming - reproduced the **identical** empty-ChatMessage error.
That is outcome 3 in the table below, and it exonerates every line of ALINA's own YAML.
Four earlier hypotheses (replayed history, reasoning round-trip, derived tool schemas,
streaming assembly) are all dead with it; none of them was ever the cause.

**Next step: test B2.** `test-b-agent-toolcall.yaml` now uses `OpenAIChatGenerator`
(`/chat/completions`) instead of `OpenAIResponsesChatGenerator` (`/responses`). One line,
one deployment, same question. Enterprise gateways generally implement Chat Completions
fully - function calling there is long-standing and universal - and the Responses API later
and only partially. If tool calling works anywhere on this endpoint, it works there.

- **Tool call happens** -> apply the same swap in `v1-agent.yaml` (already prepared) and the
  agent design survives intact.
- **Same failure** -> this endpoint does not do tool calling. Stop debugging the pipeline,
  raise it with the ECGPT team, and build Plan B.

The `curl` probes below are still worth running if you have `GPTEC_API_KEY` to hand: they
answer the same question in seconds and give you the raw payload to show the ECGPT team.


Purpose: stop paying a deployment per hypothesis. Two probes, ten minutes, and the
remaining hypothesis space collapses to one branch.

## What the last logs established

- A single **non-streamed** `POST https://api.tech.ec.europa.eu/ecgpt/v1/responses`,
  `200 OK` in 424 ms, followed by an empty assistant message. The streaming assembler is
  therefore exonerated - the non-streaming conversion path produces the same empty message.
- **No tool component appears anywhere in the logs** (no `corpus_scan`, no `lister`, no
  retriever). `tool_invoker` runs in 6-7 ms as a pure no-op. No tool has ever executed in
  any run we have looked at.
- Three serialization warnings, two of them fired in the failing call:
  ```
  Failed to serialize value: haystack.core.super_component.utils._delegate_default
  Unsupported primitive type 'getset_descriptor', falling back to 'string'   (x2)
  ```
  `_delegate_default` is `SuperComponent`'s sentinel for an input with no default, and
  `PipelineTool` is built on `SuperComponent`. The tool schemas we ship are being degraded
  on their way to the API - some part of them silently becomes `"string"`.

So the two live hypotheses are: **(H1)** our `PipelineTool`-based tool definitions reach the
model broken, or **(H2)** the endpoint does not do function calling in the shape Haystack
sends. Both probes below separate them.

## Probe 1 - minimal deepset pipeline (`test-b-agent-toolcall.yaml`)

Deploy as e.g. `alina-testb-toolcall`, open the Playground, ask **"What is the weather in
Brussels?"**.

The pipeline is the ALINA agent stripped to nothing: same generator, same proxy, no
streaming, no retrieval, no state, no `PipelineTool` - one `CodeTool` whose whole schema is
two plain strings.

| Outcome | Reading | Next step |
|---|---|---|
| Answers "20 degrees Celsius", tool span visible | H1: tool calling works; **our** tool definitions are the problem | Rebuild the three ALINA tools as `CodeTool`s (plain `@tool` functions that call retrieval directly) instead of `PipelineTool`s wrapping nested pipelines |
| Answers from its own knowledge / says it cannot check, no tool span | H2: the endpoint ignores our tools | Probe 2, then ECGPT team, then Plan B |
| Same `A ChatMessage must contain at least one TextContent...` error | H2, conclusively - a two-string schema cannot be blamed on us | Probe 2, then ECGPT team, then Plan B |

Then run it once more with `streaming_callback` uncommented, to know whether streaming can
be kept later. One extra run, one more variable eliminated.

## Probe 2 - raw HTTP, no Haystack at all

This is the ground truth: it asks the endpoint directly whether it can emit a function call.
Run it wherever `GPTEC_API_KEY` is available.

**Responses-API tool shape** (flat `name`/`parameters` - what Haystack sends):

```bash
curl -sS https://api.tech.ec.europa.eu/ecgpt/v1/responses \
  -H "Authorization: Bearer $GPTEC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.1",
    "input": [{"role": "user", "content": "What is the weather in Brussels? Use your tool."}],
    "tools": [{
      "type": "function",
      "name": "get_weather",
      "description": "Get the current weather for a city",
      "parameters": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
        "additionalProperties": false
      }
    }]
  }' | jq '.status, .output'
```

Read `.output`: an item with `"type": "function_call"` means function calling works and H2
is dead. An output with only a `message` item, or an empty `output`, means the endpoint
ignored the tools - which is exactly what would leave Haystack building an empty
`ChatMessage`.

**Chat-Completions tool shape** (nested under `function`), to test whether the gateway is a
Chat-Completions service behind a `/responses` path - if this one works and the first does
not, that mismatch is the whole bug:

```bash
curl -sS https://api.tech.ec.europa.eu/ecgpt/v1/chat/completions \
  -H "Authorization: Bearer $GPTEC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.1",
    "messages": [{"role": "user", "content": "What is the weather in Brussels? Use your tool."}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city",
        "parameters": {
          "type": "object",
          "properties": {"city": {"type": "string"}},
          "required": ["city"]
        }
      }
    }]
  }' | jq '.choices[0].message'
```

If **only** this second call produces a tool call, the fix is to swap the generator for
`OpenAIChatGenerator` (Chat Completions) instead of `OpenAIResponsesChatGenerator` in the
agent - a one-line change to `type:` plus dropping the Responses-only parameters. Worth
trying in the ALINA pipeline directly, since it costs one deployment.

## Plan B, if tool calling is genuinely unavailable

Solve the named-document problem without an agent, keeping the v0.x chain intact: a
`ConditionalRouter` in front of retrieval, fed by a small extraction step that spots a
document reference in the query and resolves it against the file listing, then routes to a
`file_id`-filtered branch or the normal one. Less flexible than an agent, no tool calling
required, and it reuses every retrieval component already validated in v1.
