import pytest

from app.triggers import canonical, parse_trigger


@pytest.mark.parametrize("value,kind,expected", [
    ("shift", "drag", "shift/left/drag"),
    ("none", "drag", "none/left/drag"),
    ("shift+ctrl", "drag", "shift+ctrl/left/drag"),
    ("meta", "click", "meta/left/click"),
    ("dblclick", "click", "none/left/dblclick"),
    ("shift+alt/right/drag", "drag", "shift+alt/right/drag"),
    ("ctrl+alt+meta/left/dblclick", "click", "ctrl+alt+meta/left/dblclick"),
    ("none/middle/click", "click", "none/middle/click"),
])
def test_canonical(value, kind, expected):
    assert canonical(value, kind) == expected


@pytest.mark.parametrize("value,kind", [
    ("ctrl+shift", "drag"),            # non-canonical order
    ("alt+shift/left/drag", "drag"),   # non-canonical order
    ("shift/top/drag", "drag"),        # bad button
    ("shift/left/hold", "drag"),       # bad action
    ("shift/left/click", "drag"),      # kind mismatch
    ("shift/left/drag", "click"),      # kind mismatch
    ("dblclick", "drag"),
    ("none", "click"),                 # legacy none is drag-only
    ("none/left/click", "click"),      # plain left click reserved for row selection
    ("shift+shift/left/drag", "drag"),
    ("", "drag"),
])
def test_rejects(value, kind):
    with pytest.raises(ValueError):
        parse_trigger(value, kind)
