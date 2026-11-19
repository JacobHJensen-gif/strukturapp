"""Create a consistent SQLite snapshot without stopping the application."""

import argparse
import sqlite3
from contextlib import closing
from pathlib import Path


def create_backup(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)
    if not source.is_file():
        raise ValueError("Databasekilden skal være en fil")
    destination = destination.resolve()
    if source == destination:
        raise ValueError("Backup og database må ikke være den samme fil")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.touch(exist_ok=False)
    try:
        with closing(sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(destination)) as dst:
                src.backup(dst)
                result = dst.execute("PRAGMA integrity_check").fetchone()
                if result != ("ok",):
                    raise RuntimeError(f"Backupintegritet fejlede: {result}")
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Opret en SQLite-backup. Filen indeholder følsomme data.")
    parser.add_argument("--database", type=Path, required=True, help="Sti til den aktive SQLite-database")
    parser.add_argument("--output", type=Path, required=True, help="Ny backupfil, som ikke allerede findes")
    args = parser.parse_args()
    create_backup(args.database, args.output)
    print(f"Backup oprettet: {args.output}. Opbevar filen sikkert.")


if __name__ == "__main__":
    main()
