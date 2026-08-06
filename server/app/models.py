import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from app.database import Base


class Role(str, enum.Enum):
    admin = "admin"
    qca = "qca"
    user = "user"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(Role), nullable=False, default=Role.user)
    avatar_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    audit_entries = relationship("AuditLog", back_populates="user")
    locks = relationship("Lock", back_populates="user")


class Lock(Base):
    __tablename__ = "locks"

    id = Column(Integer, primary_key=True)
    filename = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    acquired_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="locks")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    filename = Column(String, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String, nullable=False)  # point_edit | bulk_edit | revert | save | publish
    var_name = Column(String, nullable=True)
    indices_json = Column(String, nullable=True)
    old_value_scalar = Column(Float, nullable=True)
    new_value_scalar = Column(Float, nullable=True)
    new_value_str = Column(String, nullable=True)
    old_value_ref = Column(String, nullable=True)
    new_value_ref = Column(String, nullable=True)
    reverted = Column(Boolean, default=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="audit_entries")
