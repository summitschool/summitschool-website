#!/usr/bin/env python3
"""Push Summit Family Hub auth email templates to Supabase."""

from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "tajyrmydwqsijstyzsjr")
ROOT = pathlib.Path(__file__).resolve().parent


def main() -> int:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        print(
            "SUPABASE_ACCESS_TOKEN is not set.\n"
            "Create a token at https://supabase.com/dashboard/account/tokens and rerun:\n"
            "  SUPABASE_ACCESS_TOKEN=... python3 supabase/push-auth-email-templates.py",
            file=sys.stderr,
        )
        return 1

    recovery = (ROOT / "templates" / "recovery.html").read_text(encoding="utf-8")
    confirmation = (ROOT / "templates" / "confirmation.html").read_text(encoding="utf-8")

    payload = {
        "mailer_subjects_recovery": "Reset your Summit Family Hub password",
        "mailer_templates_recovery_content": recovery,
        "mailer_subjects_confirmation": "Confirm your Summit Family Hub email",
        "mailer_templates_confirmation_content": confirmation,
    }

    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/config/auth",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "supabase-cli/2.108.0",
        },
        method="PATCH",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            print(f"Pushed auth email templates (HTTP {resp.status}).")
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        print(f"Failed to push templates (HTTP {err.code}): {body}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())