from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_role
from app.models import Role, User
from app.oauth_settings import domains_list, get_or_create_settings
from app.schemas import (
    OAuthSettingsOut,
    OAuthSettingsUpdate,
    ThemeSettingsOut,
    ThemeSettingsUpdate,
)
from app.theme_settings import get_or_create_settings as get_or_create_theme_settings

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
    db.commit()
    db.refresh(row)
    return row
