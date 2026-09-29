import pytest
from pydantic import ValidationError

from app.schemas import CustomTrigger, CustomTriggerList


def test_custom_trigger_strips_name_and_keeps_canonical():
    t = CustomTrigger(name="  Pan  ", trigger="shift+alt/right/drag")
    assert t.name == "Pan"
    assert t.trigger == "shift+alt/right/drag"


@pytest.mark.parametrize(
    "trigger",
    [
        "shift",  # legacy token: ambiguous kind
        "none/left/click",  # reserved for row selection
        "alt+shift/left/drag",  # non-canonical modifier order
        "none/left/hover",  # bad action
        "none/side/drag",  # bad button
    ],
)
def test_custom_trigger_rejects_bad_trigger(trigger):
    with pytest.raises(ValidationError):
        CustomTrigger(name="x", trigger=trigger)


@pytest.mark.parametrize("name", ["", "   ", "x" * 41])
def test_custom_trigger_rejects_bad_name(name):
    with pytest.raises(ValidationError):
        CustomTrigger(name=name, trigger="none/middle/drag")


def test_list_rejects_duplicate_names_case_insensitive():
    with pytest.raises(ValidationError):
        CustomTriggerList(
            custom_triggers=[
                {"name": "Pan", "trigger": "none/middle/drag"},
                {"name": "pan", "trigger": "none/right/drag"},
            ]
        )


def test_list_rejects_duplicate_triggers():
    with pytest.raises(ValidationError):
        CustomTriggerList(
            custom_triggers=[
                {"name": "A", "trigger": "none/middle/drag"},
                {"name": "B", "trigger": "none/middle/drag"},
            ]
        )


def test_list_rejects_more_than_50():
    items = [{"name": f"t{i}", "trigger": "none/middle/drag"} for i in range(51)]
    with pytest.raises(ValidationError):
        CustomTriggerList(custom_triggers=items)


def test_list_accepts_empty():
    assert CustomTriggerList(custom_triggers=[]).custom_triggers == []
