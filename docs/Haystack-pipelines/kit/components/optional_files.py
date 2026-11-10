from haystack import component
from haystack.dataclasses import ByteStream
from pathlib import Path

@component
class OptionalFilesPassthrough:
    """Passes files through unchanged, defaulting to an empty list when none are provided."""

    @component.output_types(sources=list[str | Path | ByteStream])
    def run(self, sources: list[str | Path | ByteStream] | None = None):
        return {"sources": sources if sources is not None else []}
