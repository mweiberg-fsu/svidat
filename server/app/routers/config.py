from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.app_config import config_to_dict, get_or_create_config
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import AppConfigOut

router = APIRouter(prefix="/config", tags=["config"])


@router.get("", response_model=AppConfigOut)
def get_config(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return config_to_dict(get_or_create_config(db))
