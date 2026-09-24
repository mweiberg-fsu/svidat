import json
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.models import AppConfig

# Plot gesture -> trigger. Drag gestures (x_zoom, y_zoom) take a modifier held
# during the drag; click gestures (undo, redo) take a modifier held during a
# click, or "dblclick". Defaults match the original hardcoded bindings.
DRAG_TRIGGERS = ("shift", "ctrl", "alt", "meta")
CLICK_TRIGGERS = DRAG_TRIGGERS + ("dblclick",)
DEFAULT_KEYBINDINGS: Dict[str, str] = {
    "x_zoom": "shift",
    "y_zoom": "ctrl",
    "undo": "meta",
    "redo": "dblclick",
}

# Each tab body is Markdown. {{x_zoom}}, {{y_zoom}}, {{undo}}, {{redo}} are
# replaced client-side with the current binding's label (e.g. "Shift+drag"),
# so the Controls tab stays accurate when an admin rebinds a gesture.
DEFAULT_DOCUMENTATION: List[Dict[str, str]] = [
    {
        "title": "Overview",
        "body": (
            "svidat is a netCDF quality-control tool. It lets you browse, plot, and "
            "hand-edit variable flag information in netCDF files, with every change "
            "tracked in an audit log.\n"
            "\n"
            "## Roles\n"
            "\n"
            "- **admin** — full access, manages users.\n"
            "- **qca** — can edit, save, and publish files.\n"
            "- **user** — view only.\n"
        ),
    },
    {
        "title": "Workflow",
        "body": (
            "## File lifecycle\n"
            "\n"
            "1. A file is uploaded as **raw** — the original, read-only source.\n"
            "2. A qca/admin user opens an edit session, creating their own working copy.\n"
            "3. Flag edits write to that working copy.\n"
            "4. **Save** copies the working copy into a draft version (version 250).\n"
            "5. **Publish** copies the working copy into a draft version (version 250) "
            "AND copies the working copy into the published version (version 300).\n"
            "6. Every edit is recorded in the audit history and can be reverted.\n"
        ),
    },
    {
        "title": "Controls",
        "body": (
            "## Plot gestures\n"
            "\n"
            "- Click a row — set that row as the active variable.\n"
            "- Drag on a row (admin/qca only) — select a point range and open the flag toolbar.\n"
            "- {{x_zoom}} — zoom the X axis.\n"
            "- {{y_zoom}} — zoom the Y axis.\n"
            "- {{undo}} or right-click — undo the last zoom.\n"
            "- {{redo}} or Shift+right-click — redo zoom.\n"
            "- Escape — cancel an open flag-selection popover.\n"
            "\n"
            "## Sidebar\n"
            "\n"
            "- Drag the sidebar's right edge to resize it.\n"
        ),
    },
]


def get_or_create_config(db: Session) -> AppConfig:
    row = db.query(AppConfig).first()
    if row is None:
        row = AppConfig(
            keybindings=json.dumps(DEFAULT_KEYBINDINGS),
            documentation=json.dumps(DEFAULT_DOCUMENTATION),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def config_to_dict(row: AppConfig) -> Dict[str, Any]:
    # Fill in any binding added after this row was saved, so older rows keep
    # working when a new gesture becomes configurable.
    keybindings = {**DEFAULT_KEYBINDINGS, **json.loads(row.keybindings)}
    return {"keybindings": keybindings, "documentation": json.loads(row.documentation)}
