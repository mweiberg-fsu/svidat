from app.models import OAuthSettings
from app.oauth_settings import domains_list, get_or_create_settings, is_domain_allowed


def test_get_or_create_settings_creates_row_when_missing(db_session):
    assert db_session.query(OAuthSettings).first() is None
    row = get_or_create_settings(db_session)
    assert row.id is not None
    assert db_session.query(OAuthSettings).count() == 1


def test_get_or_create_settings_returns_existing_row(db_session):
    existing = OAuthSettings(allowed_domains="fsu.edu")
    db_session.add(existing)
    db_session.commit()

    row = get_or_create_settings(db_session)
    assert row.id == existing.id


def test_domains_list_empty_when_none():
    row = OAuthSettings(allowed_domains=None)
    assert domains_list(row) == []


def test_domains_list_splits_csv():
    row = OAuthSettings(allowed_domains="fsu.edu,noaa.gov")
    assert domains_list(row) == ["fsu.edu", "noaa.gov"]


def test_is_domain_allowed_true_when_list_empty(db_session):
    assert is_domain_allowed(db_session, "anyone@wherever.com") is True


def test_is_domain_allowed_checks_case_insensitively(db_session):
    db_session.add(OAuthSettings(allowed_domains="FSU.edu"))
    db_session.commit()
    assert is_domain_allowed(db_session, "person@fsu.EDU") is True
    assert is_domain_allowed(db_session, "person@gmail.com") is False
