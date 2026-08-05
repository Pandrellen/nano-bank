# Demo account seed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-command demo that seeds a fixed-credential customer with a realistic profile and 6 months of backdated salary+expense history, logs into the UI, and is usable by the personal-manager agent.

**Architecture:** A Python seeder (`testing/demo/`) creates the customer/account and posts 6 monthly cycles through the bank API (so ledger invariants hold), then backdates those rows via `kubectl exec … psql`. A shell wrapper port-forwards the ClusterIP-only bank-api and runs it. A small API-only hook in `agent/seed.py` lets the agent adopt the fixed demo customer.

**Tech Stack:** Python 3.13 (the agent's `.venv`, which has `httpx`+`pytest`), the bank REST API, `kubectl exec … psql`, bash.

## Global Constraints

- Fixed creds: email `demo@nano.bank`, password `Demo-Pass-2026`. Profile: `Jordan Demo`, DOB `1990-05-14`, SIN `046454286` (9 digits), phone unique 10-digit.
- Run the seeder + its tests with the agent venv: `agent/.venv/bin/python`.
- All money movement goes through the bank API; **direct SQL only in the seeder** (backdating + limit management), never in agent/bank-API code.
- `daily_withdrawal_limit` defaults to **$1000** and is checked at creation time; the seeder raises it before posting debits and restores it (and zeroes the used counters) after.
- Per cycle post the **salary credit first**, then debits, oldest month first, so the running balance never goes negative at creation time.
- Reuse `agent/bank.py::BankClient` (`login`, `deposit(token, account_id, amount, description=)`, `withdraw(token, account_id, amount, description=)`, `create_customer(payload)`, `create_account(token, payload)`); deposit/withdraw responses contain `transaction_id`.
- Branch `ui-fullstack-and-tests` (PR #40).

---

### Task 1: Pure monthly schedule

**Files:**
- Create: `testing/demo/__init__.py` (empty)
- Create: `testing/demo/seed_demo_account.py`
- Create: `testing/demo/test_seed_demo_account.py`

**Interfaces:**
- Produces `monthly_schedule(now: datetime) -> list[Item]`, `Item(when: datetime, label: str, direction: str, amount: str)` with `direction in {"credit","debit"}`.

- [ ] **Step 1: Write the failing test**

`testing/demo/test_seed_demo_account.py`:
```python
from datetime import datetime
from decimal import Decimal
from testing.demo.seed_demo_account import monthly_schedule

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `agent/.venv/bin/python -m pytest testing/demo/test_seed_demo_account.py -q`
Expected: FAIL — `seed_demo_account` / `monthly_schedule` not defined.

- [ ] **Step 3: Write the implementation**

Top of `testing/demo/seed_demo_account.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `agent/.venv/bin/python -m pytest testing/demo/test_seed_demo_account.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add testing/demo/__init__.py testing/demo/seed_demo_account.py testing/demo/test_seed_demo_account.py
git commit -m "feat(demo): pure monthly salary+expense schedule with tests"
```

---

### Task 2: Seed orchestration + backdating

**Files:**
- Modify: `testing/demo/seed_demo_account.py`
- Modify: `testing/demo/test_seed_demo_account.py`

**Interfaces:**
- Consumes `monthly_schedule` (Task 1) and a `bank` object with `login/create_customer/create_account/deposit/withdraw`.
- Produces `seed(bank, psql, now, *, profile=DEMO_PROFILE, email=DEMO_EMAIL, password=DEMO_PASSWORD) -> dict` where `psql(sql: str) -> str` runs SQL and returns stdout. Returns `{"email","account_id","posted","skipped": bool}`.

- [ ] **Step 1: Write the failing test**

Append to `testing/demo/test_seed_demo_account.py`:
```python
from testing.demo.seed_demo_account import seed, DEMO_EMAIL

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
        self._n += 1; self.calls.append(("deposit", amount, description))
        return {"transaction_id": f"txn-{self._n}"}
    def withdraw(self, token, account_id, amount, description="Withdrawal"):
        self._n += 1; self.calls.append(("withdraw", amount, description))
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
    # limit raised before, restored + backdate applied after
    joined = "\n".join(psql.sql)
    assert "daily_withdrawal_limit=100000000" in joined.replace(" ", "")
    assert "daily_withdrawal_limit=1000" in joined.replace(" ", "")
    assert joined.count("UPDATE transactions") == 24

def test_seed_is_idempotent_when_history_present():
    bank = FakeBank(exists=True)
    psql = FakePsql(chequing="acc-9", salary_count="6")
    out = seed(bank, psql, datetime(2026, 7, 29))
    assert out["skipped"] is True
    assert not any(c[0] in ("deposit", "withdraw") for c in bank.calls)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `agent/.venv/bin/python -m pytest testing/demo/test_seed_demo_account.py -q`
Expected: FAIL — `seed` not defined.

- [ ] **Step 3: Write the implementation**

Append to `testing/demo/seed_demo_account.py`:
```python
def _q(psql, sql: str) -> str:
    return psql(sql).strip()

def _existing_chequing(psql, email: str) -> str:
    return _q(psql, (
        "SELECT a.account_id FROM accounts a JOIN customers c "
        "ON c.customer_id=a.customer_id "
        f"WHERE c.email='{email}' AND a.account_type='chequing' "
        "ORDER BY a.created_at LIMIT 1;"))

def _salary_count(psql, account_id: str) -> int:
    out = _q(psql, (
        "SELECT COUNT(*) FROM transactions "
        f"WHERE account_id='{account_id}' AND description='Salary';"))
    return int(out or "0")

def _backdate_sql(rows: list[tuple[str, datetime]]) -> str:
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
    # 4. raise the daily withdrawal cap so the bulk backfill isn't rejected
    psql(f"UPDATE account_limits SET daily_withdrawal_limit=100000000 WHERE account_id='{account_id}';")
    # 5. post cycles (salary first each month) and collect ids to backdate
    rows: list[tuple[str, datetime]] = []
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `agent/.venv/bin/python -m pytest testing/demo/test_seed_demo_account.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add testing/demo/seed_demo_account.py testing/demo/test_seed_demo_account.py
git commit -m "feat(demo): idempotent seed orchestration with SQL backdating"
```

---

### Task 3: CLI entrypoint + `demo-seed.sh` wrapper

**Files:**
- Modify: `testing/demo/seed_demo_account.py` (add `main()` + `__main__`)
- Create: `scripts/demo-seed.sh`

**Interfaces:**
- Consumes `seed()` (Task 2). Produces a runnable CLI (`--api URL`) and the `kubectl … psql` default `psql` implementation.

- [ ] **Step 1: Add the real `psql` runner, bank client factory, and `main()`**

Append to `testing/demo/seed_demo_account.py`:
```python
import subprocess, sys, os

def kubectl_psql(sql: str) -> str:
    cmd = ["kubectl", "exec", "-n", "nano-bank", "deploy/postgres", "--",
           "psql", "-U", "nanobank_user", "-d", "nano_bank_db",
           "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout

def main(argv=None) -> int:
    import argparse
    from datetime import datetime
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
```

- [ ] **Step 2: Verify the module imports and CLI parses (no stack needed)**

Run: `agent/.venv/bin/python -c "import testing.demo.seed_demo_account as m; print(m.DEMO_EMAIL)"`
Expected: prints `demo@nano.bank` with no import error.

- [ ] **Step 3: Create `scripts/demo-seed.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "🌱 Seeding demo account (requires the stack up: ./scripts/deploy-all.sh)"
PY="agent/.venv/bin/python"
[ -x "$PY" ] || { echo "❌ $PY not found — run agent setup first"; exit 1; }

# bank-api is ClusterIP-only; port-forward it for the seeder.
kubectl -n nano-bank port-forward svc/bank-api 8081:8081 >/tmp/demo-seed-pf.log 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null || true' EXIT

echo "⏳ waiting for bank-api on :8081 ..."
for _ in $(seq 1 30); do
  curl -fsS http://localhost:8081/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://localhost:8081/health >/dev/null || { echo "❌ bank-api not reachable"; exit 1; }

"$PY" testing/demo/seed_demo_account.py --api http://localhost:8081
```
Then: `chmod +x scripts/demo-seed.sh`.

- [ ] **Step 4: Syntax-check the script**

Run: `bash -n scripts/demo-seed.sh && echo OK`
Expected: prints `OK`.

- [ ] **Step 5: Commit**

```bash
git add testing/demo/seed_demo_account.py scripts/demo-seed.sh
git commit -m "feat(demo): CLI entrypoint + scripts/demo-seed.sh wrapper"
```

---

### Task 4: Agent adopt-hook

**Files:**
- Modify: `agent/bank.py` (add `profile()`)
- Modify: `agent/seed.py` (adopt the fixed demo customer in `seed_demo`)
- Create: `agent/tests/test_seed_demo_adopt.py`

**Interfaces:**
- Consumes `BankClient.login`. Produces `BankClient.profile(token) -> dict` (calls `GET /api/v1/customers/profile`, returns JSON incl. `customer_id`) and an extended `seed_demo(bank)` whose result includes the demo customer when it exists.

- [ ] **Step 1: Add `profile()` to `agent/bank.py`**

After the `login` method add:
```python
    def _get(self, path: str, token=None):
        headers = {"authorization": f"Bearer {token}"} if token else {}
        r = self.http.get(self.base + path, headers=headers, timeout=10.0)
        if r.status_code >= 400:
            raise BankError(r.status_code, _safe_json(r))
        return _safe_json(r)

    def profile(self, token) -> dict:
        return self._get("/api/v1/customers/profile", token=token)
```
(`BankError` and `self.http`/`self.base` already exist in this file; confirm names when editing.)

- [ ] **Step 2: Write the failing adopt test**

`agent/tests/test_seed_demo_adopt.py`:
```python
from agent.seed import seed_demo

class FakeBank:
    def __init__(self, demo_exists):
        self.demo_exists = demo_exists
    def create_customer(self, payload):
        return {"customer_id": "rand-" + payload["email"]}
    def login(self, email, password):
        if email == "demo@nano.bank":
            if not self.demo_exists:
                raise RuntimeError("no demo user")
            return "demo-tok"
        return "tok"
    def create_account(self, token, payload):
        return {"account_id": "acc"}
    def deposit(self, token, account_id, amount, description="Deposit"):
        return {"transaction_id": "t"}
    def profile(self, token):
        return {"customer_id": "demo-cid", "email": "demo@nano.bank"}

def test_adopts_demo_customer_when_present():
    out = seed_demo(FakeBank(demo_exists=True))
    assert any(c["email"] == "demo@nano.bank" for c in out["customers"])
    assert out["creds"].get("demo-cid") == ("demo@nano.bank", "Demo-Pass-2026")

def test_skips_demo_customer_when_absent():
    out = seed_demo(FakeBank(demo_exists=False))
    assert all(c["email"] != "demo@nano.bank" for c in out["customers"])
```

- [ ] **Step 3: Run test to verify it fails**

Run: `agent/.venv/bin/python -m pytest agent/tests/test_seed_demo_adopt.py -q`
Expected: FAIL — demo customer not adopted.

- [ ] **Step 4: Extend `seed_demo` in `agent/seed.py`**

Just before `return {"customers": customers, ...}` add:
```python
    # Adopt the fixed demo customer (seeded out-of-band by scripts/demo-seed.sh)
    # so the agent can act as it. API-only: login + read profile; skip if absent.
    try:
        demo_tok = bank.login("demo@nano.bank", "Demo-Pass-2026")
        demo_cid = bank.profile(demo_tok)["customer_id"]
    except Exception:
        pass
    else:
        store.put(demo_cid, "demo@nano.bank", "Demo-Pass-2026")
        customers.append({"customer_id": demo_cid, "email": "demo@nano.bank",
                          "password": "Demo-Pass-2026", "first": "Jordan"})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `agent/.venv/bin/python -m pytest agent/tests/test_seed_demo_adopt.py agent/tests/test_seed.py -q`
Expected: PASS (new tests + existing `test_seed.py` still green).

- [ ] **Step 6: Commit**

```bash
git add agent/bank.py agent/seed.py agent/tests/test_seed_demo_adopt.py
git commit -m "feat(agent): adopt the fixed demo customer in seed_demo (API-only)"
```

---

### Task 5: Docs + live verification

**Files:**
- Modify: `ui/README.md` (add a "Demo account" walkthrough)

- [ ] **Step 1: Add the walkthrough to `ui/README.md`**

Append a `## Demo account` section documenting: run `./scripts/deploy-all.sh` then `./scripts/demo-seed.sh`; log into `http://localhost:3000` as `demo@nano.bank` / `Demo-Pass-2026`; port-forward `svc/agent-console 8505`, click "Seed demo", pick "Jordan Demo", and ask *"summarize my salary and spending over the last 6 months."* Note that the seeder is idempotent and backdates via `kubectl exec … psql`.

- [ ] **Step 2: Full test suite (unit)**

Run: `agent/.venv/bin/python -m pytest testing/demo agent/tests/test_seed_demo_adopt.py agent/tests/test_seed.py -q`
Expected: all pass.

- [ ] **Step 3: Live verification (stack must be up)**

Run: `./scripts/deploy-all.sh` (if not already up) then `./scripts/demo-seed.sh`.
Then verify the history via the API (through the same port-forward the script uses, or a fresh one):
```bash
kubectl -n nano-bank port-forward svc/bank-api 8081:8081 &
TOKEN=$(curl -fsS -XPOST localhost:8081/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@nano.bank","password":"Demo-Pass-2026"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -fsS localhost:8081/api/v1/transactions -H "authorization: Bearer $TOKEN"
```
Expected: 6 `Salary` credits dated across the last 6 months plus rent/groceries/utilities debits; a positive ending balance. Then confirm UI login at `http://localhost:3000` and that the agent console lists "Jordan Demo" after "Seed demo".

- [ ] **Step 4: Commit + push**

```bash
git add ui/README.md
git commit -m "docs(demo): demo-account walkthrough"
git push origin ui-fullstack-and-tests
```

---

## Self-Review

**Spec coverage:**
- Fixed creds + realistic profile → Task 1 (`DEMO_PROFILE`). ✓
- Account + 6mo salary+expenses via API → Task 2 (`seed`). ✓
- Backdating (direct SQL, demo-only) + `chk_status_timestamps` (all 3 stamps) → Task 2 `_backdate_sql`. ✓
- $1000 daily-withdrawal-limit workaround (raise/restore + zero counters) → Task 2. ✓
- Idempotent (customer, account, history skip) → Task 2. ✓
- Opt-in wrapper, port-forward ClusterIP bank-api → Task 3. ✓
- Agent can act as the demo customer (API-only adopt) → Task 4. ✓
- Tests (pure schedule, orchestration w/ fakes, adopt-hook) → Tasks 1,2,4. ✓
- Docs + live verification → Task 5. ✓

**Placeholder scan:** No TBD/TODO; the one "confirm names when editing" note (Task 4 Step 1) is a guard against a real detail in `agent/bank.py` (`BankError`/`self.http`), not a deferral — the code to add is fully written.

**Type consistency:** `seed(bank, psql, now, …) -> {"email","account_id","posted","skipped"}`; `psql(sql)->str`; `Item(when,label,direction,amount)`; `BankClient.profile(token)->dict` with `customer_id`; deposit/withdraw responses `{"transaction_id":…}` — consistent across tasks.
