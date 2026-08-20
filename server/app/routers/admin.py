from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_role
from app.models import Role, User
from app.oauth_settings import domains_list, get_or_create_settings
from app.schemas import OAuthSettingsOut, OAuthSettingsUpdate

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
    row.allowed_domains = ",".join(d.strip().lower() for d in payload.allowed_domains if d.strip())
    db.commit()
    db.refresh(row)
    return {"allowed_domains": domains_list(row)}
