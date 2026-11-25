"""add_saved_route_details

Revision ID: c4fd812aa314
Revises: b3fc647bb893
Create Date: 2026-11-24 17:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4fd812aa314'
down_revision: Union[str, Sequence[str], None] = 'b3fc647bb893'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('saved_routes', schema=None) as batch_op:
        batch_op.add_column(sa.Column('distance_km', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('estimated_duration_min', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('route_score', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('route_geometry', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('recommendation_reason', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('saved_routes', schema=None) as batch_op:
        batch_op.drop_column('recommendation_reason')
        batch_op.drop_column('route_geometry')
        batch_op.drop_column('route_score')
        batch_op.drop_column('estimated_duration_min')
        batch_op.drop_column('distance_km')
