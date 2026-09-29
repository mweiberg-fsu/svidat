import pytest

from app.triggers import canonical, parse_trigger, trigger_kind


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


@pytest.mark.parametrize(
    "value,kind",
    [
        ("shift/left/drag", "drag"),
        ("none/middle/drag", "drag"),
        ("alt/right/click", "click"),
        ("ctrl+meta/left/dblclick", "click"),
    ],
)
def test_trigger_kind_from_action(value, kind):
    assert trigger_kind(value) == kind


@pytest.mark.parametrize("value", ["shift", "dblclick", "none", "shift/left", "a/b/c/d"])
def test_trigger_kind_rejects_non_canonical(value):
    with pytest.raises(ValueError):
        trigger_kind(value)
