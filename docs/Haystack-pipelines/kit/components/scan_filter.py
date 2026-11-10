from typing import Any
from haystack import component
@component
class ScanFilterBuilder:
    """ANDs the entitlement filters with `split_id == 0` (first chunk of each
    source document), so the file scan enumerates files, not chunks, and stays
    inside the store's 10 000-hit cap. SECURITY-SENSITIVE: it must AND the
    entitlement filters, never replace them."""
    # dict[str, Any], not bare dict: FilterRetriever's filters input is
    # declared dict[str, Any] | None and haystack's connection type check
    # rejects an unparameterized dict as the sender.
    @component.output_types(filters=dict[str, Any])
    def run(self, base_filters: dict[str, Any] | None = None):
        first_chunk = {"field": "split_id", "operator": "==", "value": 0}
        if not base_filters:
            return {"filters": {"operator": "AND", "conditions": [first_chunk]}}
        return {"filters": {"operator": "AND", "conditions": [base_filters, first_chunk]}}
