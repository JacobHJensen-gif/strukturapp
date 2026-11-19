import json
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models
from .config import LOCAL_AI_MODEL, LOCAL_AI_URL, secret_key
from .database import Base, engine, get_db
from .invitations import invitation_hash
from .login_throttle import clear_attempts, reserve_attempt
from .schemas import CalendarEvent, Credentials, Day, Mutation, Registration, Routine, SuggestionRequest, Suggestions, Task
from .security import DUMMY_PASSWORD_HASH, create_token, current_auth, current_user, passwords


@asynccontextmanager
async def lifespan(_: FastAPI):
    secret_key()
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Hverdagsro API", lifespan=lifespan)
ITEM_SCHEMAS = {"task": Task, "routine": Routine, "event": CalendarEvent, "day": Day}


@app.middleware("http")
async def protect_api_responses(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def item_result(item: models.Item) -> dict:
    return {
        "id": item.id,
        "kind": item.kind,
        "data": item.data,
        "revision": item.revision,
        "deleted": item.deleted,
        "updated_at": item.updated_at.isoformat(),
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/register", status_code=201)
def register(body: Registration, db: Session = Depends(get_db)):
    username = body.username.strip().casefold()
    if len(username) < 3:
        raise HTTPException(422, "Brugernavnet skal have mindst 3 tegn")
    current_time = models.now()
    result = db.execute(
        update(models.Invitation)
        .where(
            models.Invitation.code_hash == invitation_hash(body.invitation),
            models.Invitation.used_at.is_(None),
            models.Invitation.expires_at > current_time,
        )
        .values(used_at=current_time)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(403, "Invitationen er ugyldig eller udløbet")
    user = models.User(username=username, password_hash=passwords.hash(body.password))
    db.add(user)
    try:
        db.flush()
        token = create_token(user, db)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Brugernavnet er allerede i brug") from None
    return {"token": token, "user_id": user.id, "username": user.username}


@app.post("/auth/login")
def login(body: Credentials, db: Session = Depends(get_db)):
    username = body.username.strip().casefold()
    limit_key = reserve_attempt(db, username)
    user = db.scalar(select(models.User).where(models.User.username == username))
    verified = passwords.verify(body.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if user is None or not verified:
        raise HTTPException(401, "Forkert brugernavn eller adgangskode")
    token = create_token(user, db)
    clear_attempts(db, limit_key)
    db.commit()
    return {"token": token, "user_id": user.id, "username": user.username}


@app.post("/auth/logout", status_code=204)
def logout(auth: tuple[models.User, models.AuthSession] = Depends(current_auth), db: Session = Depends(get_db)):
    user, auth_session = auth
    auth_session.revoked_at = models.now()
    db.add(models.AuditLog(user_id=user.id, action="auth.logout"))
    db.commit()
    return Response(status_code=204)


@app.get("/items")
def get_items(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(select(models.Item).where(models.Item.user_id == user.id)).all()
    return [item_result(item) for item in items]


@app.post("/items/mutate")
def mutate(body: Mutation, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    operation_id = str(body.operation_id)
    item_id = str(body.id)
    previous = db.scalar(
        select(models.Operation).where(models.Operation.user_id == user.id, models.Operation.operation_id == operation_id)
    )
    if previous:
        return previous.result
    try:
        validated = ITEM_SCHEMAS[body.kind].model_validate(body.data).model_dump(mode="json")
    except ValidationError as exc:
        raise HTTPException(422, "Data har et ugyldigt format") from exc
    if body.deleted:
        validated = {}

    item = db.get(models.Item, item_id)
    if item is None:
        if body.base_revision != 0:
            raise HTTPException(409, "Elementet findes ikke længere på serveren")
        item = models.Item(id=item_id, user_id=user.id, kind=body.kind, data=validated, revision=1, deleted=body.deleted)
        db.add(item)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Elementet kunne ikke oprettes på grund af en samtidig ændring") from None
    else:
        if item.user_id != user.id:
            raise HTTPException(404, "Elementet findes ikke")
        if item.kind != body.kind:
            raise HTTPException(409, "Elementets type kan ikke ændres")
        result = db.execute(
            update(models.Item)
            .where(models.Item.id == item_id, models.Item.user_id == user.id, models.Item.revision == body.base_revision)
            .values(data=validated, revision=body.base_revision + 1, deleted=body.deleted, updated_at=models.now())
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "Elementet er ændret på en anden enhed")
        db.refresh(item)
    if body.deleted:
        receipts = db.scalars(
            select(models.Operation).where(
                models.Operation.user_id == user.id,
                models.Operation.result["id"].as_string() == item_id,
            )
        ).all()
        for receipt in receipts:
            receipt.result = {key: value for key, value in receipt.result.items() if key != "data"}
    result_data = {key: value for key, value in item_result(item).items() if key != "data"}
    db.add(models.Operation(user_id=user.id, operation_id=operation_id, result=result_data))
    db.add(models.AuditLog(user_id=user.id, action=f"{body.kind}.{'delete' if body.deleted else 'save'}"))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        previous = db.scalar(
            select(models.Operation).where(models.Operation.user_id == user.id, models.Operation.operation_id == operation_id)
        )
        if previous:
            return previous.result
        raise HTTPException(409, "Samtidig ændring; prøv igen") from None
    return result_data


@app.post("/suggestions")
async def suggestions(body: SuggestionRequest, _: models.User = Depends(current_user)):
    if not LOCAL_AI_MODEL:
        raise HTTPException(503, "En lokal AI-model er ikke konfigureret")
    prompt = (
        "Opdel opgaven i højst fem små, realistiske skridt på dansk. "
        "Returner kun JSON med formatet {\"steps\":[{\"title\":\"...\",\"minutes\":5,\"energy\":5}]}. "
        "Anslå minutter og energipoint; brug ikke medicinske råd. Opgave: " + body.title
    )
    try:
        async with httpx.AsyncClient(timeout=90, trust_env=False, follow_redirects=False) as client:
            response = await client.post(
                f"{LOCAL_AI_URL}/api/generate",
                json={"model": LOCAL_AI_MODEL, "prompt": prompt, "stream": False, "format": "json"},
            )
            response.raise_for_status()
            return Suggestions.model_validate(json.loads(response.json()["response"]))
    except (httpx.HTTPError, ValueError, KeyError, ValidationError) as exc:
        raise HTTPException(503, "Den lokale AI-model kunne ikke svare. Prøv igen senere.") from exc
