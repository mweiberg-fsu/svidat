import json
import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app import storage
from app.database import get_db
from app.deps import require_role
from app.file_locks import file_write_lock
from app.models import Role, User
from app.oauth_settings import domains_list, get_or_create_settings
from app.app_config import config_to_dict, get_or_create_config
from app.schemas import (
    AppConfigOut,
    AppConfigUpdate,
    OAuthSettingsOut,
    OAuthSettingsUpdate,
    ThemeSettingsOut,
    ThemeSettingsUpdate,
)
from app.routers.users import ALLOWED_AVATAR_TYPES as ALLOWED_IMAGE_TYPES
from app.theme_settings import get_or_create_settings as get_or_create_theme_settings

MAX_LOGO_BYTES = 2 * 1024 * 1024

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/oauth-settings", response_model=OAuthSettingsOut)
def get_oauth_settings(
    db: Session = Depends(get_db), _: User = Depends(require_role(Role.admin))
):
    row = get_or_create_settings(db)
    return {"allowed_domains": domains_list(row)}


@router.put("/oauth-settings", response_model=OAuthSettingsOut)
def update_oauth_settings(
    payload: OAuthSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    row = get_or_create_settings(db)
    flattened = [
        part.strip().lower()
        for entry in payload.allowed_domains
        for part in entry.split(",")
        if part.strip()
    ]
    row.allowed_domains = ",".join(flattened)
    db.commit()
    db.refresh(row)
    return {"allowed_domains": domains_list(row)}


@router.put("/theme-settings", response_model=ThemeSettingsOut)
def update_theme_settings(
    payload: ThemeSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    row = get_or_create_theme_settings(db)
    row.primary_color = payload.primary_color
    row.secondary_color = payload.secondary_color
    row.tertiary_color = payload.tertiary_color
    if payload.site_name is not None:
        row.site_name = payload.site_name
    if payload.save_draft_label is not None:
        row.save_draft_label = payload.save_draft_label
    if payload.publish_label is not None:
        row.publish_label = payload.publish_label
    db.commit()
    db.refresh(row)
    return row


@router.put("/config", response_model=AppConfigOut)
def update_config(
    payload: AppConfigUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    row = get_or_create_config(db)
    row.keybindings = json.dumps(payload.keybindings.model_dump())
    row.documentation = json.dumps([tab.model_dump() for tab in payload.documentation])
    db.commit()
    db.refresh(row)
    return config_to_dict(row)


def _remove_logo_file(row) -> None:
    if row.logo_path:
        old_path = storage.base_dir() / row.logo_path
        if old_path.exists():
            old_path.unlink()


@router.post("/theme-logo", response_model=ThemeSettingsOut)
async def upload_theme_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    ext = ALLOWED_IMAGE_TYPES.get(file.content_type)
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"unsupported image type: {file.content_type}",
        )
    chunk_size = 64 * 1024
    contents = bytearray()
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        contents.extend(chunk)
        if len(contents) > MAX_LOGO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="image exceeds 2MB limit"
            )
    contents = bytes(contents)

    with file_write_lock("theme-logo"):
        row = get_or_create_theme_settings(db)
        _remove_logo_file(row)

        path = storage.logo_path(ext)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_bytes(contents)
        os.replace(tmp_path, path)

        row.logo_path = str(path.relative_to(storage.base_dir()))
        db.commit()
        db.refresh(row)
    return row


@router.delete("/theme-logo", response_model=ThemeSettingsOut)
def delete_theme_logo(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    with file_write_lock("theme-logo"):
        row = get_or_create_theme_settings(db)
        _remove_logo_file(row)
        row.logo_path = None
        db.commit()
        db.refresh(row)
    return row
