#!/usr/bin/env python3
"""Push authority_rank / authority_category metadata to deepset Cloud files.

Reads the JSON array produced by build-authority-metadata.py (file_name,
authority_rank, authority_category), matches each entry to an uploaded
deepset file by exact file name, and calls the Update File Meta Bulk API to
set `meta.authority_rank` and `meta.authority_category` on each matching file:
https://docs.cloud.deepset.ai/docs/api/main/update-file-meta-bulk-api-v-1-workspaces-workspace-name-files-update-meta-post/

Auth/workspace are read from the same environment variables used by the
Next.js app (see README.md): HAYSTACK_API_KEY (or DEEPSET_API_KEY) and
HAYSTACK_WORKSPACE. Values are loaded from a local .env file if present and
not already set in the environment.

Usage:
    python3 scripts/update-authority-metadata.py \
        --metadata docs/authority-metadata.json \
        --dry-run

    python3 scripts/update-authority-metadata.py \
        --metadata docs/authority-metadata.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_API = "https://api.cloud.deepset.ai/api/v1"


def load_dotenv(path: str = ".env") -> None:
    """Populate os.environ from a simple KEY=VALUE .env file.

    Never overrides variables already present in the environment.
    """
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def request_json(
    url: str,
    api_key: str,
    method: str = "GET",
    payload: dict | None = None,
) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    req.add_header("Authorization", f"Bearer {api_key}")
    if data is not None:
        req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return exc.code, parsed


def list_all_files(workspace: str, api_key: str) -> list[dict]:
    """Paginate GET /files and return the raw file records (file_id, name, meta)."""
    files: list[dict] = []
    after_value: str | None = None
    after_file_id: str | None = None
    base = f"{BASE_API}/workspaces/{urllib.parse.quote(workspace, safe='')}/files"

    while True:
        params = {"limit": "100", "field": "created_at", "order": "ASC"}
        if after_value and after_file_id:
            params["after_value"] = after_value
            params["after_file_id"] = after_file_id
        url = f"{base}?{urllib.parse.urlencode(params)}"

        status, payload = request_json(url, api_key)
        if status >= 400:
            print(
                f"ERROR: failed to list files ({status}): {payload}", file=sys.stderr)
            sys.exit(1)

        data = payload.get("data", [])
        files.extend(data)

        if not payload.get("has_more"):
            break
        last = data[-1]
        after_value = last.get("created_at")
        after_file_id = last.get("file_id")
        if not after_value or not after_file_id:
            break

    return files


def chunked(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i: i + size]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--metadata", default="docs/authority-metadata.json",
                        help="Path to the authority metadata JSON array")
    parser.add_argument("--workspace", default=None,
                        help="Override HAYSTACK_WORKSPACE")
    parser.add_argument("--api-key", default=None,
                        help="Override HAYSTACK_API_KEY/DEEPSET_API_KEY")
    parser.add_argument("--batch-size", type=int, default=50,
                        help="Files per update-meta request (default: 50)")
    parser.add_argument("--include-unmapped", action="store_true",
                        help="Also push null authority_rank/authority_category for files with no matched category")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the planned updates without calling the API")
    args = parser.parse_args()

    load_dotenv()

    api_key = (args.api_key or os.environ.get("HAYSTACK_API_KEY")
               or os.environ.get("DEEPSET_API_KEY") or "").strip()
    workspace = (args.workspace or os.environ.get(
        "HAYSTACK_WORKSPACE") or "").strip()

    if not api_key:
        print("ERROR: missing HAYSTACK_API_KEY / DEEPSET_API_KEY (env or --api-key).", file=sys.stderr)
        return 1
    if not workspace:
        print("ERROR: missing HAYSTACK_WORKSPACE (env or --workspace).",
              file=sys.stderr)
        return 1

    if not os.path.isfile(args.metadata):
        print(
            f"ERROR: metadata file not found: {args.metadata}", file=sys.stderr)
        return 1
    with open(args.metadata, "r", encoding="utf-8") as f:
        entries = json.load(f)

    if not args.include_unmapped:
        skipped = [e for e in entries if e.get("authority_category") is None]
        entries = [e for e in entries if e.get(
            "authority_category") is not None]
        if skipped:
            print(
                f"Skipping {len(skipped)} entries with no authority_category (use --include-unmapped to push them anyway):")
            for e in skipped:
                print(f"  - {e.get('relative_path', e.get('file_name'))}")

    print(f"Fetching file list from workspace '{workspace}'...")
    remote_files = list_all_files(workspace, api_key)
    print(f"Found {len(remote_files)} files in workspace.")

    name_to_ids: dict[str, list[str]] = {}
    for file in remote_files:
        name = file.get("name")
        file_id = file.get("file_id")
        if name and file_id:
            name_to_ids.setdefault(name, []).append(file_id)

    payload: dict[str, dict] = {}
    not_found: list[str] = []
    ambiguous: list[str] = []

    for entry in entries:
        file_name = entry.get("file_name")
        ids = name_to_ids.get(file_name, [])
        if not ids:
            not_found.append(entry.get("relative_path", file_name))
            continue
        if len(ids) > 1:
            ambiguous.append(f"{file_name} -> {ids}")
            continue
        payload[ids[0]] = {
            "authority_rank": entry.get("authority_rank"),
            "authority_category": entry.get("authority_category"),
        }

    if not_found:
        print(
            f"\nWARNING: {len(not_found)} files from metadata were not found in the workspace (not uploaded yet?):", file=sys.stderr)
        for path in not_found:
            print(f"  - {path}", file=sys.stderr)
    if ambiguous:
        print(
            f"\nWARNING: {len(ambiguous)} file names matched multiple uploaded files, skipped (resolve manually):", file=sys.stderr)
        for line in ambiguous:
            print(f"  - {line}", file=sys.stderr)

    print(f"\nPrepared metadata updates for {len(payload)} files.")

    if args.dry_run:
        print("Dry run enabled, no requests sent. Sample payload (first 3):")
        for file_id, meta in list(payload.items())[:3]:
            print(f"  {file_id}: {meta}")
        return 0

    if not payload:
        print("Nothing to update.")
        return 0

    base = f"{BASE_API}/workspaces/{urllib.parse.quote(workspace, safe='')}/files/update-meta"
    file_ids = list(payload.keys())
    total_updated = 0
    total_failed = 0
    all_failures: list[dict] = []

    for batch_num, batch_ids in enumerate(chunked(file_ids, args.batch_size), start=1):
        batch_payload = {file_id: payload[file_id] for file_id in batch_ids}
        status, result = request_json(
            base, api_key, method="POST", payload=batch_payload)

        if status >= 400:
            print(f"Batch {batch_num}: ERROR {status}: {result}",
                  file=sys.stderr)
            total_failed += len(batch_ids)
            continue

        updated = result.get("updated_count", 0)
        failed = result.get("failed_count", 0)
        failures = result.get("failed_files", [])
        total_updated += updated
        total_failed += failed
        all_failures.extend(failures)
        print(f"Batch {batch_num}: updated={updated} failed={failed}")
        time.sleep(0.2)

    print(
        f"\nDone. Total updated={total_updated}, total failed={total_failed}")
    if all_failures:
        print("Failed files:", file=sys.stderr)
        for failure in all_failures:
            print(f"  - {failure}", file=sys.stderr)

    return 1 if total_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
