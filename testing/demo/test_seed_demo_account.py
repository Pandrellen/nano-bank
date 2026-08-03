from datetime import datetime
from decimal import Decimal
from testing.demo.seed_demo_account import monthly_schedule, seed, DEMO_EMAIL


def test_schedule_has_six_months_oldest_first():
    items = monthly_schedule(datetime(2026, 7, 29, 15, 0))
    salaries = [i for i in items if i.label == "Salary"]
    assert len(salaries) == 6
    # oldest first, all in the six whole months before the current one
    months = [(i.when.year, i.when.month) for i in salaries]
    assert months == [(2026, 1), (2026, 2), (2026, 3), (2026, 4), (2026, 5), (2026, 6)]
    # every timestamp is strictly before "now"
    assert all(i.when < datetime(2026, 7, 29, 15, 0) for i in items)


def test_each_month_is_salary_then_three_expenses_in_date_order():
    items = monthly_schedule(datetime(2026, 7, 29))
    first_cycle = items[:4]
    assert [i.label for i in first_cycle] == ["Salary", "Rent", "Groceries", "Utilities"]
    assert [i.direction for i in first_cycle] == ["credit", "debit", "debit", "debit"]
    assert [i.when.day for i in first_cycle] == [1, 2, 15, 18]
    # net monthly change is positive (4200 - 1600 - 550 - 180)
    net = sum((Decimal(i.amount) if i.direction == "credit" else -Decimal(i.amount)) for i in first_cycle)
    assert net == Decimal("1870.00")


class FakeBank:
    def __init__(self, exists=False):
        self.exists = exists
        self.calls = []
        self._n = 0

    def login(self, email, password):
        if not self.exists:
            raise RuntimeError("no such user")
        return "tok"

    def create_customer(self, payload):
        self.exists = True
        self.calls.append(("create_customer", payload["email"]))
        return {"customer_id": "cid-1"}

    def create_account(self, token, payload):
        self.calls.append(("create_account", payload.get("account_type")))
        return {"account_id": "acc-1"}

    def deposit(self, token, account_id, amount, description="Deposit"):
        self._n += 1
        self.calls.append(("deposit", amount, description))
        return {"transaction_id": f"txn-{self._n}"}

    def withdraw(self, token, account_id, amount, description="Withdrawal"):
        self._n += 1
        self.calls.append(("withdraw", amount, description))
        return {"transaction_id": f"txn-{self._n}"}


class FakePsql:
    def __init__(self, chequing="", salary_count="0"):
        self.sql = []
        self._chequing, self._salary_count = chequing, salary_count

    def __call__(self, sql):
        self.sql.append(sql)
        if "account_type='chequing'" in sql and sql.strip().upper().startswith("SELECT"):
            return self._chequing
        if "description='Salary'" in sql or "COUNT" in sql.upper():
            return self._salary_count
        return ""


def test_seed_creates_customer_account_and_24_postings():
    bank, psql = FakeBank(exists=False), FakePsql()
    out = seed(bank, psql, datetime(2026, 7, 29))
    assert ("create_customer", DEMO_EMAIL) in bank.calls
    assert ("create_account", "chequing") in bank.calls
    deposits = [c for c in bank.calls if c[0] == "deposit"]
    withdraws = [c for c in bank.calls if c[0] == "withdraw"]
    assert len(deposits) == 6 and len(withdraws) == 18
    assert out["posted"] == 24 and out["skipped"] is False
    joined = "\n".join(psql.sql).replace(" ", "")
    assert "daily_withdrawal_limit=100000000" in joined
    assert "daily_withdrawal_limit=1000" in joined
    assert "\n".join(psql.sql).count("UPDATE transactions") == 24


def test_seed_is_idempotent_when_history_present():
    bank = FakeBank(exists=True)
    psql = FakePsql(chequing="acc-9", salary_count="6")
    out = seed(bank, psql, datetime(2026, 7, 29))
    assert out["skipped"] is True
    assert not any(c[0] in ("deposit", "withdraw") for c in bank.calls)
