import sqlite3
from contextlib import closing

import pytest

from app.backup import create_backup


def test_backup_is_consistent_and_never_overwrites(tmp_path):
    source = tmp_path / "source.db"
    destination = tmp_path / "backup.db"
    with closing(sqlite3.connect(source)) as db:
        with db:
            db.execute("CREATE TABLE example (name TEXT)")
            db.execute("INSERT INTO example VALUES ('test')")
    create_backup(source, destination)
    with closing(sqlite3.connect(destination)) as db:
        assert db.execute("SELECT name FROM example").fetchone() == ("test",)
    with pytest.raises(FileExistsError):
        create_backup(source, destination)
    with pytest.raises(ValueError):
        create_backup(source, source)
