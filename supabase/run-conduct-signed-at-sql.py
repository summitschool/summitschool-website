#!/usr/bin/env python3
"""Run supabase/conduct-signed-at.sql against the linked Supabase project."""

from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "tajyrmydwqsijstyzsjr")
ROOT = pathlib.Path(__file__).resolve().parent
SQL_PATH = ROOT / "conduct-signed-at.sql"


def load_access_token() -> str:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if token:
        return token

    for candidate in (
        pathlib.Path.home() / ".config" / "supabase" / "access-token",
        pathlib.Path.home() / ".supabase" / "access-token",
    ):
        if candidate.exists():
            token = candidate.read_text(encoding="utf-8").strip()
            if token:
                return token

    print(
        "SUPABASE_ACCESS_TOKEN is not set.\n"
        "Create a token at https://supabase.com/dashboard/account/tokens and rerun:\n"
        f"  SUPABASE_ACCESS_TOKEN=... python3 {pathlib.Path(__file__).name}",
        file=sys.stderr,
    )
    sys.exit(1)


def run_query(token: str, query: str) -> dict:
    payload = json.dumps({"query": query}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


def main() -> int:
    token = load_access_token()
    sql = SQL_PATH.read_text(encoding="utf-8")

    statements = [stmt.strip() for stmt in sql.split(";") if stmt.strip()]
    print(f"Running {len(statements)} SQL statements against project {PROJECT_REF}...")

    for index, statement in enumerate(statements, start=1):
        preview = " ".join(statement.split())[:100]
        print(f"[{index}/{len(statements)}] {preview}...")
        try:
            result = run_query(token, statement)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            print(f"Failed on statement {index}: HTTP {error.code}\n{detail}", file=sys.stderr)
            return 1

        if result:
            print(json.dumps(result, indent=2)[:2000])

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())