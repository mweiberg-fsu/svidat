"""Gesture trigger grammar shared by keybinding validation.

A trigger is either a legacy token (kept valid for existing configs) or a
canonical "<mods>/<button>/<action>" string; see the Phase A design spec
(docs/superpowers/specs/2026-09-29-canonical-triggers-phase-a-design.md).
All comparisons use canonical(), so a legacy token and its canonical form
are the same trigger.
"""
from typing import Tuple

from app.app_config import CLICK_TRIGGERS, DRAG_TRIGGERS, MODIFIERS

BUTTONS = ("left", "middle", "right")
DRAG_ACTIONS = ("drag",)
CLICK_ACTIONS = ("click", "dblclick")


def _parse_mods(text: str) -> Tuple[str, ...]:
    if text == "none":
        return ()
    parts = tuple(text.split("+"))
    if not parts or any(p not in MODIFIERS for p in parts) or len(set(parts)) != len(parts):
        raise ValueError(f"invalid modifiers {text!r}")
    if list(parts) != sorted(parts, key=MODIFIERS.index):
        raise ValueError(f"modifiers must be in order {'+'.join(MODIFIERS)}")
    return parts


def parse_trigger(value: str, kind: str) -> Tuple[Tuple[str, ...], str, str]:
    """(mods, button, action) for `value` as a `kind` ("drag"/"click") trigger."""
    if "/" not in value:
        allowed = DRAG_TRIGGERS if kind == "drag" else CLICK_TRIGGERS
        if value not in allowed:
            raise ValueError(f"must be one of {list(allowed)} or <mods>/<button>/<action>")
        if value == "dblclick":
            return (), "left", "dblclick"
        return _parse_mods(value), "left", "drag" if kind == "drag" else "click"
    pieces = value.split("/")
    if len(pieces) != 3:
        raise ValueError("expected <mods>/<button>/<action>")
    mods_text, button, action = pieces
    mods = _parse_mods(mods_text)
    if button not in BUTTONS:
        raise ValueError(f"button must be one of {list(BUTTONS)}")
    actions = DRAG_ACTIONS if kind == "drag" else CLICK_ACTIONS
    if action not in actions:
        raise ValueError(f"action must be one of {list(actions)} for this gesture")
    if kind == "click" and not mods and button == "left" and action == "click":
        raise ValueError("a plain left click is reserved for selecting a row")
    return mods, button, action


def canonical(value: str, kind: str) -> str:
    mods, button, action = parse_trigger(value, kind)
    return f"{'+'.join(mods) or 'none'}/{button}/{action}"


def trigger_kind(value: str) -> str:
    """"drag" or "click" for a canonical "<mods>/<button>/<action>" string,
    read from its action. Legacy tokens are rejected: "shift" is valid for
    both kinds, so it has no single kind."""
    pieces = value.split("/")
    if len(pieces) != 3:
        raise ValueError("expected <mods>/<button>/<action>")
    action = pieces[2]
    if action in DRAG_ACTIONS:
        return "drag"
    if action in CLICK_ACTIONS:
        return "click"
    raise ValueError(f"action must be one of {list(DRAG_ACTIONS + CLICK_ACTIONS)}")
