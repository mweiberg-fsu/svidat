from app.models import OAuthSettings, User
from app.security import hash_password


def test_new_user_defaults_to_local_auth_provider(db_session):
    user = User(username="plain", password_hash=hash_password("x"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.auth_provider == "local"


def test_oauth_settings_round_trip(db_session):
    row = OAuthSettings(allowed_domains="fsu.edu,noaa.gov")
    db_session.add(row)
    db_session.commit()

    fetched = db_session.query(OAuthSettings).first()
    assert fetched.allowed_domains == "fsu.edu,noaa.gov"
