import os
import importlib
import tempfile
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

test_dir = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite:///{test_dir.name}/test.db"
os.environ["SECRET_KEY"] = "test-key-not-for-production-at-least-32-characters"

from app.main import app
from app.database import SessionLocal, engine
from app.invitations import invitation_hash, issue_invitation
from app.login_throttle import MAX_ATTEMPTS, throttle_key
from app.models import Invitation, Item, LoginThrottle, Operation, now
from sqlalchemy import select


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    test_dir.cleanup()


def register(client, name):
    with SessionLocal() as db:
        invitation = issue_invitation(db)
    response = client.post("/auth/register", json={"username": name, "password": "a-very-long-password", "invitation": invitation})
    assert response.status_code == 201
    return {"Authorization": "Bearer " + response.json()["token"]}


def test_registration_requires_single_use_invitation(client):
    with SessionLocal() as db:
        invitation = issue_invitation(db)
    credentials = {"username": "invited", "password": "a-very-long-password", "invitation": invitation}
    assert client.post("/auth/register", json={**credentials, "invitation": "x" * 43}).status_code == 403
    assert client.post("/auth/register", json=credentials).status_code == 201
    assert client.post("/auth/register", json={**credentials, "username": "seconduser"}).status_code == 403


def test_invitation_survives_duplicate_username(client):
    register(client, "existing")
    with SessionLocal() as db:
        invitation = issue_invitation(db)
    credentials = {"username": "existing", "password": "a-very-long-password", "invitation": invitation}
    assert client.post("/auth/register", json=credentials).status_code == 409
    assert client.post("/auth/register", json={**credentials, "username": "newname"}).status_code == 201


def test_expired_invitation_is_rejected(client):
    with SessionLocal() as db:
        invitation = issue_invitation(db)
        record = db.get(Invitation, invitation_hash(invitation))
        record.expires_at = now() - timedelta(seconds=1)
        db.commit()
    response = client.post("/auth/register", json={"username": "lateuser", "password": "a-very-long-password", "invitation": invitation})
    assert response.status_code == 403


def test_logout_revokes_only_the_current_session(client):
    headers = register(client, "logoutuser")
    response = client.post("/auth/login", json={"username": "logoutuser", "password": "a-very-long-password"})
    assert response.status_code == 200
    other = {"Authorization": "Bearer " + response.json()["token"]}
    assert client.post("/auth/logout", headers=headers).status_code == 204
    assert client.get("/items", headers=headers).status_code == 401
    assert client.get("/items", headers=other).status_code == 200


def test_login_rate_limit_and_expiry(client):
    register(client, "limited")
    bad = {"username": "limited", "password": "a-wrong-long-password"}
    for _ in range(MAX_ATTEMPTS):
        assert client.post("/auth/login", json=bad).status_code == 401
    valid = {"username": "limited", "password": "a-very-long-password"}
    assert client.post("/auth/login", json=valid).status_code == 429
    with SessionLocal() as db:
        record = db.get(LoginThrottle, throttle_key("limited"))
        record.window_end = now() - timedelta(seconds=1)
        db.commit()
    assert client.post("/auth/login", json=valid).status_code == 200


def task_mutation(item_id=None):
    return {
        "operation_id": str(uuid4()),
        "id": item_id or str(uuid4()),
        "kind": "task",
        "base_revision": 0,
        "data": {"title": "En lille opgave"},
    }


def test_account_isolation_and_idempotent_mutations(client):
    alice = register(client, "alice")
    bob = register(client, "bob")
    operation = task_mutation()
    first = client.post("/items/mutate", json=operation, headers=alice)
    assert first.status_code == 200
    assert first.json()["revision"] == 1
    assert client.post("/items/mutate", json=operation, headers=alice).json() == first.json()
    assert client.get("/items", headers=bob).json() == []
    foreign = {**operation, "operation_id": str(uuid4()), "base_revision": 1}
    assert client.post("/items/mutate", json=foreign, headers=bob).status_code == 404


def test_revision_conflict_does_not_overwrite(client):
    headers = register(client, "charlie")
    operation = task_mutation()
    assert client.post("/items/mutate", json=operation, headers=headers).status_code == 200
    update = {**operation, "operation_id": str(uuid4()), "base_revision": 1, "data": {"title": "Ny"}}
    assert client.post("/items/mutate", json=update, headers=headers).json()["revision"] == 2
    stale = {**update, "operation_id": str(uuid4()), "data": {"title": "Gammel"}}
    assert client.post("/items/mutate", json=stale, headers=headers).status_code == 409
    assert client.get("/items", headers=headers).json()[0]["data"]["title"] == "Ny"


def test_deleted_item_does_not_retain_content_in_sync_receipts(client):
    headers = register(client, "deleteuser")
    operation = task_mutation()
    assert client.post("/items/mutate", json=operation, headers=headers).status_code == 200
    with SessionLocal() as db:
        receipt = db.scalar(select(Operation).where(Operation.operation_id == operation["operation_id"]))
        receipt.result = {**receipt.result, "data": operation["data"]}
        db.commit()
    deleted = {**operation, "operation_id": str(uuid4()), "base_revision": 1, "deleted": True}
    assert client.post("/items/mutate", json=deleted, headers=headers).status_code == 200
    with SessionLocal() as db:
        item = db.get(Item, operation["id"])
        assert item.deleted and item.data == {}
        receipts = db.scalars(select(Operation).where(Operation.result["id"].as_string() == operation["id"])).all()
        assert len(receipts) == 2
        assert all("data" not in receipt.result for receipt in receipts)


def test_authentication_validation_and_local_ai_failure(client):
    response = client.get("/items")
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    headers = register(client, "dana")
    invalid = {**task_mutation(), "data": {"title": "", "energy": 999}}
    assert client.post("/items/mutate", json=invalid, headers=headers).status_code == 422
    assert client.post("/suggestions", json={"title": "Vask op"}, headers=headers).status_code == 503


def test_local_ai_response_is_validated(client, monkeypatch):
    module = importlib.import_module("app.main")
    monkeypatch.setattr(module, "LOCAL_AI_MODEL", "local-test-model")

    class LocalClient:
        def __init__(self, **kwargs):
            assert kwargs["trust_env"] is False
            assert kwargs["follow_redirects"] is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json):
            assert url.startswith("http://127.0.0.1:")
            assert json["model"] == "local-test-model"
            import httpx
            return httpx.Response(200, request=httpx.Request("POST", url), json={
                "response": '{"steps":[{"title":"Ryd bordet","minutes":5,"energy":3}]}'
            })

    monkeypatch.setattr(module.httpx, "AsyncClient", LocalClient)
    headers = register(client, "ellen")
    response = client.post("/suggestions", json={"title": "Rengør køkken"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["steps"][0] == {"title": "Ryd bordet", "minutes": 5, "energy": 3}
