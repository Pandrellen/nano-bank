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
