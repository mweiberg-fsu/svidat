from typing import List

from pydantic import BaseModel

from app.models import Role


class UserCreate(BaseModel):
    username: str
    password: str
    role: Role


class UserOut(BaseModel):
    id: int
    username: str
    role: Role

    class Config:
        from_attributes = True


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
