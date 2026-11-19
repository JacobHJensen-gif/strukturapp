import hashlib
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from .models import Invitation, now


def invitation_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def issue_invitation(db: Session, hours: int = 24) -> str:
    if not 1 <= hours <= 168:
        raise ValueError("Invitationens gyldighed skal være mellem 1 og 168 timer")
    code = secrets.token_urlsafe(32)
    db.add(Invitation(code_hash=invitation_hash(code), expires_at=now() + timedelta(hours=hours)))
    db.commit()
    return code
