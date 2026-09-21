import re
from typing import List

from pydantic import BaseModel, field_validator

from app.models import Role

ALLOWED_ROLE_VALUES = {"admin", "qca"}


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

    class Config:
        from_attributes = True


class ThemeSettingsUpdate(BaseModel):
    primary_color: str
    secondary_color: str
    tertiary_color: str

    @field_validator("primary_color", "secondary_color", "tertiary_color")
    @classmethod
    def validate_hex(cls, v: str) -> str:
        return _validate_hex_color(v)
