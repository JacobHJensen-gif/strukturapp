"""Issue an invitation from the trusted server command line."""

import argparse

from dotenv import load_dotenv


def main() -> None:
    parser = argparse.ArgumentParser(description="Opret en engangsinvitation til Hverdagsro.")
    parser.add_argument("--env-file", default="../.env", help="Sti til serverens konfiguration")
    parser.add_argument("--hours", type=int, default=24, help="Gyldighed i timer (1-168)")
    args = parser.parse_args()
    if not load_dotenv(args.env_file):
        raise RuntimeError("Konfigurationsfilen kunne ikke indlæses")
    from .database import Base, SessionLocal, engine
    from .invitations import issue_invitation

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        code = issue_invitation(db, args.hours)
    print("Engangsinvitation (del den kun via en sikker kanal):")
    print(code)


if __name__ == "__main__":
    main()
