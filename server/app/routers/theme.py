from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import ThemeSettingsOut
from app.theme_settings import get_or_create_settings

router = APIRouter(prefix="/theme", tags=["theme"])


@router.get("", response_model=ThemeSettingsOut)
def get_theme(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return get_or_create_settings(db)
