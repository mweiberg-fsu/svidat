import httpx
import pytest
from google.auth.exceptions import TransportError

from app.oauth_providers import verify_google_id_token, verify_microsoft_id_token


def test_verify_google_id_token_returns_email(monkeypatch):
    def fake_verify(token, request, client_id):
        assert token == "good-token"
        return {"email": "person@example.com"}

    monkeypatch.setattr("app.oauth_providers.google_id_token.verify_oauth2_token", fake_verify)
    assert verify_google_id_token("good-token") == "person@example.com"


def test_verify_google_id_token_raises_on_invalid(monkeypatch):
    def fake_verify(token, request, client_id):
        raise ValueError("bad signature")

    monkeypatch.setattr("app.oauth_providers.google_id_token.verify_oauth2_token", fake_verify)
    with pytest.raises(ValueError):
        verify_google_id_token("bad-token")


def test_verify_google_id_token_raises_when_no_email(monkeypatch):
    monkeypatch.setattr(
        "app.oauth_providers.google_id_token.verify_oauth2_token",
        lambda token, request, client_id: {"sub": "123"},
    )
    with pytest.raises(ValueError):
        verify_google_id_token("token-without-email")


def test_verify_google_id_token_raises_on_transport_error(monkeypatch):
    def fake_verify(token, request, client_id):
        raise TransportError("could not reach Google certs endpoint")

    monkeypatch.setattr("app.oauth_providers.google_id_token.verify_oauth2_token", fake_verify)
    with pytest.raises(ValueError):
        verify_google_id_token("any-token")


def test_verify_microsoft_id_token_returns_email(monkeypatch):
    monkeypatch.setattr(
        "app.oauth_providers._get_microsoft_jwks",
        lambda: {"keys": [{"kid": "key-1", "kty": "RSA"}]},
    )
    monkeypatch.setattr(
        "app.oauth_providers.jose_jwt.get_unverified_header", lambda token: {"kid": "key-1"}
    )
    monkeypatch.setattr(
        "app.oauth_providers.jose_jwt.decode",
        lambda token, key, algorithms, audience, options: {
            "email": "person@example.com",
            "iss": "https://login.microsoftonline.com/abc-tenant/v2.0",
        },
    )
    assert verify_microsoft_id_token("good-token") == "person@example.com"


def test_verify_microsoft_id_token_raises_on_unknown_kid(monkeypatch):
    monkeypatch.setattr(
        "app.oauth_providers._get_microsoft_jwks", lambda: {"keys": [{"kid": "other-key"}]}
    )
    monkeypatch.setattr(
        "app.oauth_providers.jose_jwt.get_unverified_header", lambda token: {"kid": "key-1"}
    )
    with pytest.raises(ValueError):
        verify_microsoft_id_token("bad-token")


def test_verify_microsoft_id_token_raises_on_bad_issuer(monkeypatch):
    monkeypatch.setattr(
        "app.oauth_providers._get_microsoft_jwks",
        lambda: {"keys": [{"kid": "key-1"}]},
    )
    monkeypatch.setattr(
        "app.oauth_providers.jose_jwt.get_unverified_header", lambda token: {"kid": "key-1"}
    )
    monkeypatch.setattr(
        "app.oauth_providers.jose_jwt.decode",
        lambda token, key, algorithms, audience, options: {
            "email": "person@example.com",
            "iss": "https://evil.example.com/abc-tenant/v2.0",
        },
    )
    with pytest.raises(ValueError):
        verify_microsoft_id_token("bad-issuer-token")


def test_verify_microsoft_id_token_raises_on_jwks_fetch_error(monkeypatch):
    def fake_get_jwks():
        raise httpx.ConnectError("could not reach Microsoft JWKS endpoint")

    monkeypatch.setattr("app.oauth_providers._get_microsoft_jwks", fake_get_jwks)
    monkeypatch.setattr(
        "app.oauth_providers.jose_jwt.get_unverified_header", lambda token: {"kid": "key-1"}
    )
    with pytest.raises(ValueError):
        verify_microsoft_id_token("any-token")
