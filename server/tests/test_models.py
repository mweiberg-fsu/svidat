import pytest
from sqlalchemy.exc import IntegrityError

from app.database import Base, engine, SessionLocal
from app.models import User, Role, Lock, AuditLog


def setup_module(_module):
    Base.metadata.create_all(bind=engine)


def test_create_user_and_query():
    db = SessionLocal()
    try:
        user = User(username="alice", password_hash="hashed", role=Role.qca)
        db.add(user)
        db.commit()
        db.refresh(user)

        found = db.query(User).filter(User.username == "alice").first()
        assert found is not None
        assert found.role == Role.qca
    finally:
        db.query(User).filter(User.username == "alice").delete()
        db.commit()
        db.close()


def test_lock_and_audit_log_relate_to_user():
    db = SessionLocal()
    try:
        user = User(username="bob", password_hash="hashed", role=Role.admin)
        db.add(user)
        db.commit()
        db.refresh(user)

        lock = Lock(filename="shipx_2026-07-30", user_id=user.id)
        log = AuditLog(filename="shipx_2026-07-30", user_id=user.id, action="point_edit")
        db.add_all([lock, log])
        db.commit()

        assert db.query(Lock).filter(Lock.user_id == user.id).count() == 1
        assert db.query(AuditLog).filter(AuditLog.user_id == user.id).count() == 1
    finally:
        db.query(Lock).filter(Lock.user_id == user.id).delete()
        db.query(AuditLog).filter(AuditLog.user_id == user.id).delete()
        db.query(User).filter(User.id == user.id).delete()
        db.commit()
        db.close()


def test_lock_filename_unique_constraint():
    db = SessionLocal()
    try:
        user1 = User(username="modelslock1", password_hash="hashed", role=Role.user)
        user2 = User(username="modelslock2", password_hash="hashed", role=Role.user)
        db.add_all([user1, user2])
        db.commit()
        db.refresh(user1)
        db.refresh(user2)

        lock1 = Lock(filename="shipx_2026-07-30", user_id=user1.id)
        db.add(lock1)
        db.commit()

        lock2 = Lock(filename="shipx_2026-07-30", user_id=user2.id)
        db.add(lock2)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.query(Lock).filter(Lock.user_id.in_([user1.id, user2.id])).delete(
            synchronize_session=False
        )
        db.query(User).filter(User.id.in_([user1.id, user2.id])).delete(
            synchronize_session=False
        )
        db.commit()
        db.close()


def test_user_avatar_path_column_defaults_to_none():
    db = SessionLocal()
    try:
        user = User(username="avatarcol1", password_hash="hashed", role=Role.user)
        db.add(user)
        db.commit()
        db.refresh(user)
        assert user.avatar_path is None
    finally:
        db.query(User).filter(User.username == "avatarcol1").delete()
        db.commit()
        db.close()


def test_audit_log_new_value_str(db_session, make_user):
    from datetime import datetime
    from app.models import AuditLog

    user = make_user("flagger1", is_qca=True)
    log = AuditLog(
        filename="shipx_2026-07-30",
        user_id=user.id,
        action="flag_edit",
        var_name="temperature",
        new_value_str="K",
        timestamp=datetime.utcnow(),
    )
    db_session.add(log)
    db_session.commit()
    db_session.refresh(log)
    assert log.new_value_str == "K"


def test_user_roles_property_empty_by_default(db_session):
    user = User(username="rolesnone", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.roles == []


def test_user_roles_property_admin_only():
    user = User(username="rolesadmin", password_hash="hashed", is_admin=True, is_qca=False)
    assert user.roles == [Role.admin]


def test_user_roles_property_qca_only():
    user = User(username="rolesqca", password_hash="hashed", is_admin=False, is_qca=True)
    assert user.roles == [Role.qca]


def test_user_roles_property_both():
    user = User(username="rolesboth", password_hash="hashed", is_admin=True, is_qca=True)
    assert user.roles == [Role.admin, Role.qca]
