from sqlalchemy.orm import Session

from app.models import ThemeSettings

DEFAULT_PRIMARY = "#ed1f21"
DEFAULT_SECONDARY = "#5e6cb3"
DEFAULT_TERTIARY = "#cbe3f5"
DEFAULT_SITE_NAME = "SVIDAT"
DEFAULT_SAVE_DRAFT_LABEL = "Save draft (v250)"
DEFAULT_PUBLISH_LABEL = "Publish (v300)"


def get_or_create_settings(db: Session) -> ThemeSettings:
    row = db.query(ThemeSettings).first()
    if row is None:
        row = ThemeSettings(
            primary_color=DEFAULT_PRIMARY,
            secondary_color=DEFAULT_SECONDARY,
            tertiary_color=DEFAULT_TERTIARY,
            site_name=DEFAULT_SITE_NAME,
            save_draft_label=DEFAULT_SAVE_DRAFT_LABEL,
            publish_label=DEFAULT_PUBLISH_LABEL,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row
