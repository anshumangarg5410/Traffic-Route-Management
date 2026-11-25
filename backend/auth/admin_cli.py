import argparse
import asyncio
import getpass
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from backend.auth.security import hash_password, validate_password_strength
from backend.database.models import User
from backend.database.session import async_session_factory


async def create_admin_account(
    email: str | None = None,
    full_name: str | None = None,
    password: str | None = None,
) -> int:
    """
    Create an administrator account.
    If parameters are not provided via CLI flags, prompts interactively.
    """
    print("==================================================")
    print(" ITMS Administrator Account Provisioning Tool")
    print("==================================================")

    try:
        if not email:
            email = input("Enter administrator email: ").strip().lower()
        else:
            email = email.strip().lower()

        if not email or "@" not in email:
            print("Error: A valid email address is required.", file=sys.stderr)
            return 1

        if not full_name:
            full_name = input("Enter full name: ").strip()
        else:
            full_name = full_name.strip()

        if not full_name:
            print("Error: Full name cannot be blank.", file=sys.stderr)
            return 1

        if not password:
            password = getpass.getpass("Enter administrator password: ")
            confirm_password = getpass.getpass("Confirm password: ")
            if password != confirm_password:
                print("Error: Passwords do not match.", file=sys.stderr)
                return 1

        try:
            validate_password_strength(password)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

        # Check existing user
        async with async_session_factory() as session:
            stmt = select(User).where(User.email == email)
            existing = (await session.execute(stmt)).scalar_one_or_none()
            if existing:
                print(f"Error: Account with email '{email}' already exists.", file=sys.stderr)
                return 1

            # Hash and create admin
            hashed = hash_password(password)
            now = datetime.now(timezone.utc)
            admin = User(
                id=uuid.uuid4().hex,
                email=email,
                password_hash=hashed,
                full_name=full_name,
                role="admin",
                is_active=1,
                token_version=1,
                created_at=now,
                updated_at=now,
            )
            session.add(admin)
            await session.commit()

        print(f"\nAdministrator account '{email}' ({full_name}) created successfully.")
        return 0

    except (KeyboardInterrupt, EOFError):
        print("\nOperation cancelled by user.")
        return 1
    except Exception as e:
        print(f"Error creating administrator: {e}", file=sys.stderr)
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(description="ITMS Admin Account Provisioning CLI")
    parser.add_argument("--email", help="Administrator email address")
    parser.add_argument("--full-name", "--name", dest="full_name", help="Administrator full name")
    parser.add_argument("--password", help="Administrator password (optional, prompted if omitted)")

    args = parser.parse_args()
    code = asyncio.run(create_admin_account(
        email=args.email,
        full_name=args.full_name,
        password=args.password,
    ))
    sys.exit(code)


if __name__ == "__main__":
    main()
