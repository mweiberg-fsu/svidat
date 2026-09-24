from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import storage
from app.database import get_db
from app.routers.users import ALLOWED_AVATAR_TYPES as ALLOWED_IMAGE_TYPES
from app.schemas import ThemeSettingsOut
from app.theme_settings import get_or_create_settings

router = APIRouter(prefix="/theme", tags=["theme"])


# Both endpoints are public so the login page can show the site's branding
# before anyone has a token. Nothing here is sensitive.
@router.get("", response_model=ThemeSettingsOut)
def get_theme(db: Session = Depends(get_db)):
    return get_or_create_settings(db)


@router.get("/logo")
def get_theme_logo(db: Session = Depends(get_db)):
    row = get_or_create_settings(db)
    path = storage.base_dir() / row.logo_path if row.logo_path else None
    if path is None or not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no logo set")
    content_type = next(
        (ct for ct, e in ALLOWED_IMAGE_TYPES.items() if row.logo_path.endswith(f".{e}")),
        "application/octet-stream",
    )
    return FileResponse(path, media_type=content_type)
