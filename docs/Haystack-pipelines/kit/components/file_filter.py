from typing import Any
from haystack import component
@component
class FileFilter:
    """Turns a list of file_ids into a retriever filter, ANDed with the entitlement
    filters when the pipeline has them. SECURITY-SENSITIVE when it does: base
    filters must be ANDed, never replaced, so a hallucinated or non-entitled
    file_id yields zero documents, never a leak."""
    # dict[str, Any], not bare dict: the retrievers' filters input is
    # declared dict[str, Any] | None and haystack's connection type
    # check rejects an unparameterized dict as the sender.
    @component.output_types(filters=dict[str, Any])
    def run(self, file_ids: list[str], base_filters: dict[str, Any] | None = None):
        file_condition = {
            "field": "file_id",
            "operator": "in",
            "value": [str(f) for f in (file_ids or []) if f],
        }
        if not base_filters:
            return {"filters": file_condition}
        return {"filters": {"operator": "AND", "conditions": [base_filters, file_condition]}}
