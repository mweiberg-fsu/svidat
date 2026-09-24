import enum
from datetime import datetime
from typing import List

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
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
    # Deprecated: superseded by is_admin/is_qca below. Kept (rather than
    # dropped, which would need a SQLite table rebuild) so existing rows with
    # a legacy 'role' value keep deserializing correctly, and so plain
    # INSERTs that don't set it explicitly still satisfy NOT NULL via this
    # column's own default. Not read anywhere for authorization anymore.
    role = Column(Enum(Role), nullable=False, default=Role.user)
    avatar_path = Column(String, nullable=True)
    auth_provider = Column(String, nullable=False, default="local")
    is_admin = Column(Boolean, nullable=False, default=False)
    is_qca = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    audit_entries = relationship("AuditLog", back_populates="user")
    locks = relationship("Lock", back_populates="user")

    @property
    def roles(self) -> List[Role]:
        result = []
        if self.is_admin:
            result.append(Role.admin)
        if self.is_qca:
            result.append(Role.qca)
        return result


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


class TempSession(Base):
    __tablename__ = "temp_sessions"

    id = Column(Integer, primary_key=True)
    filename = Column(String, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    dirty = Column(Boolean, nullable=False, default=False)
    last_edited_at = Column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("filename", "user_id"),)


class OAuthSettings(Base):
    __tablename__ = "oauth_settings"

    id = Column(Integer, primary_key=True)
    allowed_domains = Column(String, nullable=True)


class ThemeSettings(Base):
    __tablename__ = "theme_settings"

    id = Column(Integer, primary_key=True)
    primary_color = Column(String, nullable=False, default="#ed1f21")
    secondary_color = Column(String, nullable=False, default="#5e6cb3")
    tertiary_color = Column(String, nullable=False, default="#cbe3f5")
    site_name = Column(String, nullable=False, default="SVIDAT")
    save_draft_label = Column(String, nullable=False, default="Save draft (v250)")
    publish_label = Column(String, nullable=False, default="Publish (v300)")
    logo_path = Column(String, nullable=True)

    @property
    def has_logo(self) -> bool:
        return bool(self.logo_path)


class AppConfig(Base):
    """Site-wide configuration edited from the admin panel's Configuration
    section. Single row; both columns hold JSON (see app/app_config.py for the
    shapes and defaults)."""

    __tablename__ = "app_config"

    id = Column(Integer, primary_key=True)
    keybindings = Column(Text, nullable=False)
    documentation = Column(Text, nullable=False)
