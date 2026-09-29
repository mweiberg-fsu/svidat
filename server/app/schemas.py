import re
from typing import List, Optional

from pydantic import BaseModel, field_validator, model_validator

from app.models import Role
from app.triggers import canonical, parse_trigger

ALLOWED_ROLE_VALUES = {"admin", "qca"}
MAX_SITE_NAME_LENGTH = 64
MAX_BUTTON_LABEL_LENGTH = 32
MAX_DOC_TABS = 10
MAX_DOC_TAB_TITLE_LENGTH = 40
MAX_DOC_TAB_BODY_LENGTH = 20000


def _validate_role_values(v: List[str]) -> List[str]:
    invalid = set(v) - ALLOWED_ROLE_VALUES
    if invalid:
        raise ValueError(f"invalid role(s): {sorted(invalid)}")
    return v


class UserCreate(BaseModel):
    username: str
    password: str
    roles: List[str] = []

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v: List[str]) -> List[str]:
        return _validate_role_values(v)


class UserOut(BaseModel):
    id: int
    username: str
    roles: List[Role]

    class Config:
        from_attributes = True


class UserRolesUpdate(BaseModel):
    roles: List[str]

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v: List[str]) -> List[str]:
        return _validate_role_values(v)


class PointEditRequest(BaseModel):
    filename: str
    var_name: str
    indices: List[int]
    value: float


class BulkEditRequest(BaseModel):
    filename: str
    var_name: str
    slices: List[List[int]]
    op: str
    value: float


class FlagEditRequest(BaseModel):
    filename: str
    var_name: str
    start_time_idx: int
    end_time_idx: int
    flag_code: str


class SaveRequest(BaseModel):
    filename: str


class PublishRequest(BaseModel):
    filename: str


class OAuthLoginRequest(BaseModel):
    id_token: str


class OAuthSettingsOut(BaseModel):
    allowed_domains: List[str]


class OAuthSettingsUpdate(BaseModel):
    allowed_domains: List[str]


HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _validate_hex_color(v: str) -> str:
    if not HEX_COLOR_RE.match(v):
        raise ValueError(f"invalid hex color: {v!r}")
    return v


class ThemeSettingsOut(BaseModel):
    primary_color: str
    secondary_color: str
    tertiary_color: str
    site_name: str
    save_draft_label: str
    publish_label: str
    has_logo: bool

    class Config:
        from_attributes = True


class ThemeSettingsUpdate(BaseModel):
    primary_color: str
    secondary_color: str
    tertiary_color: str
    # Optional so color-only updates keep the current name.
    site_name: Optional[str] = None
    save_draft_label: Optional[str] = None
    publish_label: Optional[str] = None

    @field_validator("primary_color", "secondary_color", "tertiary_color")
    @classmethod
    def validate_hex(cls, v: str) -> str:
        return _validate_hex_color(v)

    @field_validator("site_name")
    @classmethod
    def validate_site_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("site name must not be empty")
        if len(v) > MAX_SITE_NAME_LENGTH:
            raise ValueError(f"site name exceeds {MAX_SITE_NAME_LENGTH} characters")
        return v

    @field_validator("save_draft_label", "publish_label")
    @classmethod
    def validate_button_label(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("button label must not be empty")
        if len(v) > MAX_BUTTON_LABEL_LENGTH:
            raise ValueError(f"button label exceeds {MAX_BUTTON_LABEL_LENGTH} characters")
        return v


class KeyBindings(BaseModel):
    x_zoom: str
    y_zoom: str
    box_zoom: str
    flag_select: str
    undo: str
    redo: str

    @field_validator("x_zoom", "y_zoom", "box_zoom", "flag_select")
    @classmethod
    def validate_drag(cls, v: str) -> str:
        try:
            parse_trigger(v, "drag")
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        return v

    @field_validator("undo", "redo")
    @classmethod
    def validate_click(cls, v: str) -> str:
        try:
            parse_trigger(v, "click")
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        return v

    @model_validator(mode="after")
    def validate_unique(self) -> "KeyBindings":
        # Sharing a trigger would make one gesture swallow the other (e.g. a
        # shift+click undo would also fire at the end of every shift+drag zoom).
        drag_fields = ["x_zoom", "y_zoom", "box_zoom", "flag_select"]
        click_fields = ["undo", "redo"]
        drag_canon = {name: canonical(getattr(self, name), "drag") for name in drag_fields}
        click_canon = {name: canonical(getattr(self, name), "click") for name in click_fields}
        all_canon = {**drag_canon, **click_canon}

        # Rule 4: the six normalized triggers are pairwise distinct.
        values = list(all_canon.values())
        if len(set(values)) != len(values):
            raise ValueError("each gesture needs a different binding")

        # Rule 5: a click gesture's (mods, button) must not match a drag
        # gesture's (mods, button) — a drag ends with a click.
        for click_name, click_value in click_canon.items():
            click_mods_button, click_action = click_value.rsplit("/", 1)
            if click_action != "click":
                continue
            for drag_name, drag_value in drag_canon.items():
                drag_mods_button, _ = drag_value.rsplit("/", 1)
                if click_mods_button == drag_mods_button:
                    raise ValueError(
                        "a click binding can't use the same keys and button as a drag binding"
                    )

        # Rule 6: undo and redo can't be the click and double-click of the
        # same keys and button — the first click of a double-click would
        # fire the single-click gesture.
        undo_mods_button, undo_action = click_canon["undo"].rsplit("/", 1)
        redo_mods_button, redo_action = click_canon["redo"].rsplit("/", 1)
        if undo_mods_button == redo_mods_button and {undo_action, redo_action} == {"click", "dblclick"}:
            raise ValueError(
                "undo and redo can't be the click and double-click of the same keys and button"
            )

        return self


class DocTab(BaseModel):
    title: str
    body: str

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("tab title must not be empty")
        if len(v) > MAX_DOC_TAB_TITLE_LENGTH:
            raise ValueError(f"tab title exceeds {MAX_DOC_TAB_TITLE_LENGTH} characters")
        return v

    @field_validator("body")
    @classmethod
    def validate_body(cls, v: str) -> str:
        if len(v) > MAX_DOC_TAB_BODY_LENGTH:
            raise ValueError(f"tab body exceeds {MAX_DOC_TAB_BODY_LENGTH} characters")
        return v


class AppConfigOut(BaseModel):
    keybindings: KeyBindings
    documentation: List[DocTab]
    user_keybindings: Optional[KeyBindings] = None


class AppConfigUpdate(BaseModel):
    keybindings: KeyBindings
    documentation: List[DocTab]

    @field_validator("documentation")
    @classmethod
    def validate_tab_count(cls, v: List[DocTab]) -> List[DocTab]:
        if not v:
            raise ValueError("documentation needs at least one tab")
        if len(v) > MAX_DOC_TABS:
            raise ValueError(f"documentation allows at most {MAX_DOC_TABS} tabs")
        return v
