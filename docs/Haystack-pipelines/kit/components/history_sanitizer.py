from haystack import component
from haystack.dataclasses import ChatMessage
MAX_HISTORY_MESSAGES = 20  # KIT:max_history_messages
@component
class HistorySanitizer:
    """Rebuilds replayed history as plain user/assistant text turns.
    Guarantees every message handed to the generator carries a TextContent:
    anything content-less, any tool-call / tool-result / reasoning residue, and
    any role other than user/assistant is dropped rather than passed through.
    History is context for resolving follow-ups, never the agent's own tool trace.
    """
    @component.output_types(messages=list[ChatMessage])
    def run(self, messages: list[ChatMessage] | None = None):
        clean: list[ChatMessage] = []
        for message in messages or []:
            role = getattr(message.role, "value", message.role)
            if role not in ("user", "assistant"):
                continue
            try:
                text = (message.text or "").strip()
            except Exception:
                text = ""
            if not text:
                continue
            clean.append(
                ChatMessage.from_user(text)
                if role == "user"
                else ChatMessage.from_assistant(text)
            )
        return {"messages": clean[-MAX_HISTORY_MESSAGES:]}
