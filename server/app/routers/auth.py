import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Role, User
from app.oauth_providers import verify_google_id_token, verify_microsoft_id_token
from app.oauth_settings import is_domain_allowed
from app.schemas import OAuthLoginRequest
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.username == form_data.username).first()
    if user is None or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid username or password",
        )
    token = create_access_token(user.username, user.role.value)
    return {"access_token": token, "token_type": "bearer", "role": user.role.value}


def _oauth_login(db: Session, email: str, provider: str) -> dict:
    user = db.query(User).filter(User.username == email).first()
    if user is None:
        if not is_domain_allowed(db, email):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="this email domain isn't authorized to sign in",
            )
        user = User(
            username=email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            role=Role.user,
            auth_provider=provider,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    token = create_access_token(user.username, user.role.value)
    return {"access_token": token, "token_type": "bearer", "role": user.role.value}


@router.post("/oauth/google")
def oauth_google(payload: OAuthLoginRequest, db: Session = Depends(get_db)):
    try:
        email = verify_google_id_token(payload.id_token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid google id token"
        )
    return _oauth_login(db, email, "google")


@router.post("/oauth/microsoft")
def oauth_microsoft(payload: OAuthLoginRequest, db: Session = Depends(get_db)):
    try:
        email = verify_microsoft_id_token(payload.id_token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid microsoft id token"
        )
    return _oauth_login(db, email, "microsoft")
