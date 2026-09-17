from app import temp_sessions
from app.models import TempSession


def test_get_or_create_creates_row_once(db_session, make_user):
    user = make_user("tsuser1", is_qca=True)
    ts1 = temp_sessions.get_or_create(db_session, "shipx_ts_a", user.id)
    db_session.commit()
    ts2 = temp_sessions.get_or_create(db_session, "shipx_ts_a", user.id)
    db_session.commit()
    assert ts1.id == ts2.id
    assert (
        db_session.query(TempSession).filter(TempSession.filename == "shipx_ts_a").count()
        == 1
    )


def test_reset_generates_new_created_at_and_clears_dirty(db_session, make_user):
    user = make_user("tsuser2", is_qca=True)
    temp_sessions.get_or_create(db_session, "shipx_ts_b", user.id)
    db_session.commit()
    temp_sessions.mark_dirty(db_session, "shipx_ts_b", user.id)
    db_session.commit()
    ts = db_session.query(TempSession).filter(TempSession.filename == "shipx_ts_b").first()
    first_created_at = ts.created_at

    reset_ts = temp_sessions.reset(db_session, "shipx_ts_b", user.id)
    db_session.commit()
    assert reset_ts.dirty is False
    assert reset_ts.last_edited_at is None
    assert reset_ts.created_at >= first_created_at


def test_mark_dirty_and_mark_clean(db_session, make_user):
    user = make_user("tsuser3", is_qca=True)
    temp_sessions.get_or_create(db_session, "shipx_ts_c", user.id)
    db_session.commit()

    temp_sessions.mark_dirty(db_session, "shipx_ts_c", user.id)
    db_session.commit()
    ts = db_session.query(TempSession).filter(TempSession.filename == "shipx_ts_c").first()
    assert ts.dirty is True
    assert ts.last_edited_at is not None

    temp_sessions.mark_clean(db_session, "shipx_ts_c", user.id)
    db_session.commit()
    db_session.refresh(ts)
    assert ts.dirty is False


def test_mark_dirty_on_missing_row_is_a_no_op(db_session, make_user):
    user = make_user("tsuser4", is_qca=True)
    temp_sessions.mark_dirty(db_session, "shipx_ts_missing", user.id)
    db_session.commit()
    assert (
        db_session.query(TempSession).filter(TempSession.filename == "shipx_ts_missing").count()
        == 0
    )
