from haystack import component
from haystack.dataclasses import Document
# Metadata stamped on every attachment chunk. A corpus ranked by authority sets
# e.g. {"authority_rank": 0} so attachments sort above every corpus source.
STAMP = {"doc_type": "attachment"}  # KIT:attachment_stamp
@component
class AttachmentMetadataStamper:
    """Stamps attachments with the metadata the grouping/formatting layer expects."""
    @component.output_types(documents=list[Document])
    def run(self, documents: list[Document]):
        for split_id, document in enumerate(documents):
            for key, value in STAMP.items():
                document.meta[key] = value
            document.meta.setdefault("file_id", document.id)
            document.meta["split_id"] = split_id
            file_name = document.meta.get("file_name", "attached file")
            document.meta["header"] = f"Attached file: {file_name}"
        return {"documents": documents}
