"""add_otp_session_purpose

Revision ID: 9c4e1b2f3a10
Revises: 20037cae7c08
Create Date: 2026-11-11 11:14:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9c4e1b2f3a10"
down_revision: Union[str, None] = "20037cae7c08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {col["name"] for col in inspector.get_columns("otp_sessions")}
    indexes = {idx["name"] for idx in inspector.get_indexes("otp_sessions")}

    if "purpose" not in cols:
        with op.batch_alter_table("otp_sessions", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("purpose", sa.String(length=32), server_default="login", nullable=False)
            )
    if "ix_otp_sessions_purpose" not in indexes:
        with op.batch_alter_table("otp_sessions", schema=None) as batch_op:
            batch_op.create_index("ix_otp_sessions_purpose", ["purpose"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {col["name"] for col in inspector.get_columns("otp_sessions")}
    indexes = {idx["name"] for idx in inspector.get_indexes("otp_sessions")}

    if "ix_otp_sessions_purpose" in indexes:
        with op.batch_alter_table("otp_sessions", schema=None) as batch_op:
            batch_op.drop_index("ix_otp_sessions_purpose")
    if "purpose" in cols:
        with op.batch_alter_table("otp_sessions", schema=None) as batch_op:
            batch_op.drop_column("purpose")
