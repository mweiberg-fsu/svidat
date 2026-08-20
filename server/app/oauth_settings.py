from typing import List

from sqlalchemy.orm import Session

from app.models import OAuthSettings


def get_or_create_settings(db: Session) -> OAuthSettings:
    row = db.query(OAuthSettings).first()
    if row is None:
        row = OAuthSettings(allowed_domains="")
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def domains_list(row: OAuthSettings) -> List[str]:
    if not row.allowed_domains:
        return []
    return [d for d in row.allowed_domains.split(",") if d]


def is_domain_allowed(db: Session, email: str) -> bool:
    row = get_or_create_settings(db)
    allowed = {d.lower() for d in domains_list(row)}
    if not allowed:
        return True
    domain = email.rsplit("@", 1)[-1].lower()
    return domain in allowed
