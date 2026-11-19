import hashlib
import hmac
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import case, delete, or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import secret_key
from .models import LoginThrottle, now

MAX_ATTEMPTS = 10
WINDOW_MINUTES = 15


def throttle_key(username: str) -> str:
    return hmac.new(secret_key().encode(), f"login:{username}".encode(), hashlib.sha256).hexdigest()


def reserve_attempt(db: Session, username: str) -> str:
    key = throttle_key(username)
    current_time = now()
    db.execute(delete(LoginThrottle).where(LoginThrottle.window_end < current_time - timedelta(days=1)))
    db.commit()
    if db.get(LoginThrottle, key) is None:
        db.add(LoginThrottle(key=key, attempts=0, window_end=current_time + timedelta(minutes=WINDOW_MINUTES)))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    expired = LoginThrottle.window_end <= current_time
    result = db.execute(
        update(LoginThrottle)
        .where(LoginThrottle.key == key, or_(expired, LoginThrottle.attempts < MAX_ATTEMPTS))
        .values(
            attempts=case((expired, 1), else_=LoginThrottle.attempts + 1),
            window_end=case((expired, current_time + timedelta(minutes=WINDOW_MINUTES)), else_=LoginThrottle.window_end),
        )
    )
    db.commit()
    if result.rowcount != 1:
        raise HTTPException(429, "For mange loginforsøg. Vent lidt, og prøv igen.", headers={"Retry-After": str(WINDOW_MINUTES * 60)})
    return key


def clear_attempts(db: Session, key: str) -> None:
    db.execute(delete(LoginThrottle).where(LoginThrottle.key == key))
