import time
from datetime import datetime, timedelta

import pytest
from jose import jwt

from app.config import settings
from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hash_and_verify_password():
    hashed = hash_password("s3cret!")
    assert hashed != "s3cret!"
    assert verify_password("s3cret!", hashed)
    assert not verify_password("wrong", hashed)


def test_create_and_decode_token():
    token = create_access_token("alice", "qca")
    payload = decode_access_token(token)
    assert payload["sub"] == "alice"
    assert payload["role"] == "qca"


def test_decode_invalid_token_raises():
    with pytest.raises(ValueError):
        decode_access_token("not-a-real-token")


def test_decode_expired_token_raises():
    expired_payload = {
        "sub": "alice",
        "role": "qca",
        "exp": datetime.utcnow() - timedelta(minutes=1),
    }
    token = jwt.encode(expired_payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    with pytest.raises(ValueError):
        decode_access_token(token)


def test_decode_token_wrong_secret_raises():
    token = jwt.encode(
        {"sub": "bob", "role": "user"},
        "a-completely-different-secret",
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(ValueError):
        decode_access_token(token)
