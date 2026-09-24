import re
from typing import List, Optional

from pydantic import BaseModel, field_validator, model_validator

from app.app_config import CLICK_TRIGGERS, DRAG_TRIGGERS
from app.models import Role

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
    undo: str
    redo: str

    @field_validator("x_zoom", "y_zoom")
    @classmethod
    def validate_drag(cls, v: str) -> str:
        if v not in DRAG_TRIGGERS:
            raise ValueError(f"must be one of {list(DRAG_TRIGGERS)}")
        return v

    @field_validator("undo", "redo")
    @classmethod
    def validate_click(cls, v: str) -> str:
        if v not in CLICK_TRIGGERS:
            raise ValueError(f"must be one of {list(CLICK_TRIGGERS)}")
        return v

    @model_validator(mode="after")
    def validate_unique(self) -> "KeyBindings":
        # Sharing a trigger would make one gesture swallow the other (e.g. a
        # shift+click undo would also fire at the end of every shift+drag zoom).
        values = [self.x_zoom, self.y_zoom, self.undo, self.redo]
        if len(set(values)) != len(values):
            raise ValueError("each gesture needs a different binding")
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
