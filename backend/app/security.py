from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from sqlalchemy.orm import Session
from uuid import uuid4

from .config import ACCESS_TOKEN_MINUTES, secret_key
from .database import get_db
from .models import AuthSession, User

passwords = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = passwords.hash("not-a-real-user-password")
bearer = HTTPBearer(auto_error=False)


def create_token(user: User, db: Session) -> str:
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    session_id = str(uuid4())
    token = jwt.encode(
        {"sub": user.id, "jti": session_id, "iat": now, "exp": expiry},
        secret_key(),
        algorithm="HS256",
    )
    db.add(AuthSession(id=session_id, user_id=user.id, expires_at=expiry))
    return token


def current_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> tuple[User, AuthSession]:
    error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Log ind igen")
    if not credentials:
        raise error
    try:
        payload = jwt.decode(credentials.credentials, secret_key(), algorithms=["HS256"], options={"require": ["sub", "jti", "exp", "iat"]})
        user = db.get(User, payload["sub"])
        auth_session = db.get(AuthSession, payload["jti"])
    except (InvalidTokenError, ValueError, TypeError):
        raise error from None
    if user is None or auth_session is None or auth_session.user_id != user.id or auth_session.revoked_at is not None:
        raise error
    return user, auth_session


def current_user(auth: tuple[User, AuthSession] = Depends(current_auth)) -> User:
    return auth[0]
