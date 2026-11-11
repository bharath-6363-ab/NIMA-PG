from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.main import app as fastapi_app
import app.models as _models  # noqa: F401
from app.seed import seed_database


@pytest.fixture(autouse=True)
def _fast_test_hashing(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "BCRYPT_ROUNDS", 4)
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    """Create a fresh isolated in-memory SQLite database with FK enforcement per test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_pragma(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=Session)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """Provide a FastAPI TestClient wired to the isolated test DB."""
    def _override_get_db() -> Generator[Session, None, None]:
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    with TestClient(fastapi_app) as test_client:
        yield test_client
    fastapi_app.dependency_overrides.clear()


@pytest.fixture()
def seeded_client(client: TestClient, db_session: Session) -> TestClient:
    """Provide a TestClient populated with realistic Owner, Manager, and Tenant seed records."""
    seed_database(db_session)
    return client


def login_token(client: TestClient, mobile: str, password: str, portal_role: str | None = None) -> str:
    payload: dict[str, str] = {"mobile": mobile, "password": password}
    if portal_role is not None:
        payload["portal_role"] = portal_role
    resp = client.post("/api/v1/auth/login", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
