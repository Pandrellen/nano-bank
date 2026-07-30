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
