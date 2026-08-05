from __future__ import annotations
from dataclasses import dataclass
from datetime import date, datetime, time

DEMO_EMAIL = "demo@nano.bank"
DEMO_PASSWORD = "Demo-Pass-2026"
DEMO_PROFILE = {
    "first_name": "Jordan", "last_name": "Demo", "email": DEMO_EMAIL,
    "date_of_birth": "1990-05-14", "sin": "046454286", "password": DEMO_PASSWORD,
}

SALARY = ("Salary", 1, "4200.00")
EXPENSES = [("Rent", 2, "1600.00"), ("Groceries", 15, "550.00"), ("Utilities", 18, "180.00")]


@dataclass(frozen=True)
class Item:
    when: datetime
    label: str
    direction: str  # "credit" | "debit"
    amount: str


def _add_months(first_of_month: date, delta: int) -> date:
    m = first_of_month.month - 1 + delta
    return date(first_of_month.year + m // 12, m % 12 + 1, 1)


def monthly_schedule(now: datetime) -> list[Item]:
    """Six whole months before the current month, oldest first. Each month:
    a salary credit on the 1st, then rent/groceries/utilities debits."""
    this_month = date(now.year, now.month, 1)
    items: list[Item] = []
    for i in range(6, 0, -1):
        m = _add_months(this_month, -i)
        label, day, amount = SALARY
        items.append(Item(datetime.combine(date(m.year, m.month, day), time(9, 0)), label, "credit", amount))
        for label, day, amount in EXPENSES:
            items.append(Item(datetime.combine(date(m.year, m.month, day), time(12, 0)), label, "debit", amount))
    return items


def _q(psql, sql: str) -> str:
    return psql(sql).strip()


def _existing_chequing(psql, email: str) -> str:
    return _q(psql, (
        "SELECT a.account_id FROM accounts a JOIN customers c "
        "ON c.customer_id=a.customer_id "
        f"WHERE c.email='{email}' AND a.account_type='chequing' "
        "ORDER BY a.created_at LIMIT 1;"))


def _salary_count(psql, account_id: str) -> int:
    # `transactions` has no account_id; account linkage is via transaction_entries.
    out = _q(psql, (
        "SELECT COUNT(DISTINCT t.transaction_id) FROM transactions t "
        "JOIN transaction_entries e ON e.transaction_id=t.transaction_id "
        f"WHERE e.account_id='{account_id}' AND t.description='Salary';"))
    return int(out or "0")


def _backdate_sql(rows: "list[tuple[str, datetime]]") -> str:
    parts = []
    for txn_id, when in rows:
        ts = when.strftime("%Y-%m-%d %H:%M:%S")
        parts.append(
            f"UPDATE transactions SET created_at='{ts}', processed_at='{ts}', "
            f"completed_at='{ts}' WHERE transaction_id='{txn_id}';")
        parts.append(
            f"UPDATE transaction_entries SET created_at='{ts}' "
            f"WHERE transaction_id='{txn_id}';")
    return "\n".join(parts)


def seed(bank, psql, now, *, profile=None, email=DEMO_EMAIL, password=DEMO_PASSWORD) -> dict:
    profile = profile or DEMO_PROFILE
    # 1. idempotent customer
    try:
        token = bank.login(email, password)
    except Exception:
        import uuid
        bank.create_customer({**profile, "phone_number": f"1555{uuid.uuid4().int % 1_000_000:06d}"})
        token = bank.login(email, password)
    # 2. reuse existing chequing account, else open one
    account_id = _existing_chequing(psql, email) or bank.create_account(
        token, {"account_type": "chequing"})["account_id"]
    # 3. idempotent: skip if history already present
    if _salary_count(psql, account_id) > 0:
        return {"email": email, "account_id": account_id, "posted": 0, "skipped": True}
    # 4. raise the daily withdrawal cap so the bulk backfill isn't rejected.
    # The limits row is created lazily (INSERT ... ON CONFLICT DO NOTHING) by the
    # first withdrawal with the $1000 default, so upsert it high up front.
    psql("INSERT INTO account_limits (account_id, daily_withdrawal_limit) "
         f"VALUES ('{account_id}', 100000000) "
         "ON CONFLICT (account_id) DO UPDATE SET daily_withdrawal_limit=100000000;")
    # 5. post cycles (salary first each month) and collect ids to backdate
    rows: "list[tuple[str, datetime]]" = []
    for it in monthly_schedule(now):
        if it.direction == "credit":
            resp = bank.deposit(token, account_id, it.amount, description=it.label)
        else:
            resp = bank.withdraw(token, account_id, it.amount, description=it.label)
        rows.append((resp["transaction_id"], it.when))
    # 6. backdate + restore realistic limits/counters
    psql(_backdate_sql(rows))
    psql("UPDATE account_limits SET daily_withdrawal_limit=1000, "
         "daily_withdrawal_used=0, daily_transfer_used=0 "
         f"WHERE account_id='{account_id}';")
    return {"email": email, "account_id": account_id, "posted": len(rows), "skipped": False}


import subprocess
import sys
import os


def kubectl_psql(sql: str) -> str:
    cmd = ["kubectl", "exec", "-n", "nano-bank", "deploy/postgres", "--",
           "psql", "-U", "nanobank_user", "-d", "nano_bank_db",
           "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def main(argv=None) -> int:
    import argparse
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from agent.bank import BankClient  # reuse the tested client
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://localhost:8081")
    args = p.parse_args(argv)
    out = seed(BankClient(args.api), kubectl_psql, datetime.now())
    print(f"\nDemo account ready: {out}")
    print(f"  UI login:  {DEMO_EMAIL} / {DEMO_PASSWORD}  at http://localhost:3000")
    print("  Agent:     kubectl -n nano-bank port-forward svc/agent-console 8505:8505")
    print("             then open http://localhost:8505, click 'Seed demo', pick Jordan Demo")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
