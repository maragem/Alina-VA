import re
from haystack import component
# Synonym groups from the use case's vocabulary: users write "PO", the documents say
# "Purchase Order". When any member of a group appears in the query as a whole word, the
# other members are appended, so BM25 and the dense retriever see both forms whatever the
# model wrote. Deterministic: the prompt asks the model to do the same, but a rule in the
# prompt is only followed most of the time, and retrieval depends on the words actually sent.
SYNONYMS = [["PO", "Purchase Order"]]  # KIT:synonyms
MAX_ADDED_TERMS = 12

def _present(term, text_lower):
    return re.search(r"(?<![a-z0-9])" + re.escape(term.lower()) + r"(?![a-z0-9])", text_lower) is not None

def expand(query):
    text = query or ""
    low = text.lower()
    added = []
    for group in SYNONYMS:
        if any(_present(t, low) for t in group):
            for t in group:
                if not _present(t, low) and t not in added:
                    added.append(t)
    added = added[:MAX_ADDED_TERMS]
    return (text + " " + " ".join(added)).strip() if added else text

@component
class QueryExpander:
    """Appends the other forms of any vocabulary term found in the query."""
    @component.output_types(query=str)
    def run(self, query: str):
        return {"query": expand(query)}
