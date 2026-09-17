#!/usr/bin/env python3
"""Walk the hierarchized document folder and emit a JSON array mapping each
file to its authority_rank and authority_category, using the same
categories/ranks defined in src/lib/documentMetadata.ts.

Usage:
    python3 scripts/build-authority-metadata.py \
        --source "/Users/maxime.zamani/Downloads/1.1 Data Hierarchized" \
        --output docs/authority-metadata.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

# Mirrors AUTHORITY_CATEGORIES in src/lib/documentMetadata.ts.
# Keyed by the exact second-layer folder name found on disk.
CATEGORY_BY_FOLDER: dict[str, tuple[str, int | None]] = {
    "Treaties & Charter": ("treaties_and_charter", 1),
    "CJEU Caselaw": ("cjeu_caselaw", 2),
    "Council Directives": ("council_directives", 2),
    "EC Decisions": ("ec_decisions", 2),
    "EC Directives": ("ec_directives", 2),
    "EU Regulations": ("eu_regulations", 2),
    "International agreements": ("international_agreements", 2),
    "National Law": ("national_law", 2),
    "BUDG Guidance": ("budg_vademecum", 3),
    "Contractual documents": ("contractual_documents", 3),
    "EC Communications": ("ec_communications", 3),
    "EC Recommendations": ("ec_recommendations", 3),
    "General Guidance": ("general_guidance", 3),
    "Internal Guidance": ("internal_guidance", 4),
    "Q&A": ("questions_and_answers", 4),
    # Procurement documents and Templates are always Unranked (rank None),
    # regardless of whether they physically sit under Level 4 or Unranked.
    "Procurement documents": ("procurement_documents", None),
    "Templates": ("templates", None),
}

IGNORED_FILENAMES = {".DS_Store"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True,
                        help="Path to the '1.1 Data Hierarchized' folder")
    parser.add_argument("--output", required=True,
                        help="Path to write the output JSON file")
    args = parser.parse_args()

    source_root = os.path.abspath(args.source)
    if not os.path.isdir(source_root):
        print(f"Source folder not found: {source_root}", file=sys.stderr)
        return 1

    entries = []
    unmapped_folders: set[str] = set()

    for dirpath, dirnames, filenames in os.walk(source_root):
        dirnames.sort()
        for filename in sorted(filenames):
            if filename in IGNORED_FILENAMES:
                continue

            abs_path = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(abs_path, source_root)
            parts = rel_path.split(os.sep)

            top_level = parts[0]  # "Level 1", "Level 2", ..., "Unranked"
            category_folder = parts[1] if len(parts) > 2 else None

            category_value = None
            rank = None
            if category_folder is not None:
                mapping = CATEGORY_BY_FOLDER.get(category_folder)
                if mapping is not None:
                    category_value, rank = mapping
                else:
                    unmapped_folders.add(f"{top_level}/{category_folder}")

            entries.append(
                {
                    "file_name": filename,
                    "relative_path": rel_path,
                    "authority_rank": rank,
                    "authority_category": category_value,
                }
            )

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Wrote {len(entries)} entries to {args.output}")
    if unmapped_folders:
        print("WARNING: unmapped category folders encountered:", file=sys.stderr)
        for folder in sorted(unmapped_folders):
            print(f"  - {folder}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
