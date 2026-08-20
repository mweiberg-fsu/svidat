import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import jwt as jose_jwt

from app.config import settings

MICROSOFT_JWKS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys"
MICROSOFT_ISSUER_PREFIX = "https://login.microsoftonline.com/"


def verify_google_id_token(token: str) -> str:
    try:
        payload = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), settings.google_client_id
        )
    except Exception as exc:
        raise ValueError(f"invalid google id token: {exc}") from exc
    email = payload.get("email")
    if not email:
        raise ValueError("google id token missing email claim")
    return email


def _get_microsoft_jwks() -> dict:
    response = httpx.get(MICROSOFT_JWKS_URL, timeout=5.0)
    response.raise_for_status()
    return response.json()


def verify_microsoft_id_token(token: str) -> str:
    try:
        header = jose_jwt.get_unverified_header(token)
        jwks = _get_microsoft_jwks()
        key = next((k for k in jwks["keys"] if k.get("kid") == header.get("kid")), None)
        if key is None:
            raise ValueError("invalid microsoft id token: unknown signing key")
        payload = jose_jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.microsoft_client_id,
            options={"verify_iss": False},
        )
    except Exception as exc:
        raise ValueError(f"invalid microsoft id token: {exc}") from exc

    issuer = payload.get("iss", "")
    if not issuer.startswith(MICROSOFT_ISSUER_PREFIX):
        raise ValueError("invalid microsoft id token issuer")

    email = payload.get("email") or payload.get("preferred_username")
    if not email:
        raise ValueError("microsoft id token missing email claim")
    return email
