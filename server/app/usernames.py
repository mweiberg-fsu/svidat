"""Usernames for accounts created from an email address (OAuth sign-up).

The username is the address's local part ("ustropics@gmail.com" -> "ustropics")
and the full address goes in User.email. Usernames end up in storage paths
(temp/{username}/, drafts/{username}/), so the local part is reduced to a safe
character set that storage.validate_segment always accepts.
"""
import re
from typing import Iterable

_UNSAFE = re.compile(r"[^a-z0-9._-]")


def username_from_email(email: str, taken: Iterable[str]) -> str:
    """Local part of `email`, lowercased and made path-safe, with a number
    appended ("sam2", "sam3", ...) if it collides with a `taken` username
    (compared case-insensitively)."""
    local = email.strip().lower().split("@", 1)[0]
    base = _UNSAFE.sub("_", local).strip(".") or "user"
    taken_lower = {t.lower() for t in taken}
    candidate, n = base, 2
    while candidate in taken_lower:
        candidate, n = f"{base}{n}", n + 1
    return candidate
