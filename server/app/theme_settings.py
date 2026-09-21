from sqlalchemy.orm import Session

from app.models import ThemeSettings

DEFAULT_PRIMARY = "#ed1f21"
DEFAULT_SECONDARY = "#5e6cb3"
DEFAULT_TERTIARY = "#cbe3f5"


def get_or_create_settings(db: Session) -> ThemeSettings:
    row = db.query(ThemeSettings).first()
    if row is None:
        row = ThemeSettings(
            primary_color=DEFAULT_PRIMARY,
            secondary_color=DEFAULT_SECONDARY,
            tertiary_color=DEFAULT_TERTIARY,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row
