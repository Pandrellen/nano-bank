from decimal import Decimal as D
from finance import metrics
from finance.config import RiskConfig

RC = RiskConfig.default()


def _assets():
    # closing balances, debit-normal (assets +)
    return {
        "CardReceivable": D("10000"),
        "OverdraftReceivable": D("4000"),
        "LoansReceivable": D("6000"),
        "TreasuryPlacement": D("5000"),
        "CashReserves": D("2000"),
    }


def test_economic_capital_rwa_and_ec():
    ec = metrics.economic_capital(_assets(), RC)
    # RWA: card .75*10000=7500, od 1*4000=4000, loan 1*6000=6000,
    #      treasury .20*5000=1000, cash 0*2000=0  -> 18500
    assert ec["total_rwa"] == D("18500.00")
    assert ec["rwa"]["CardReceivable"] == D("7500.00")
    assert ec["economic_capital"] == D("18500.00") * D("0.10")


def test_expected_loss():
    el = metrics.expected_loss(_assets(), RC)
    # .03*10000 + .02*4000 + .015*6000 = 300 + 80 + 90 = 470
    assert el == D("300.00") + D("80.00") + D("90.000")


def test_raroc_components():
    closing = dict(_assets(),
                   InterestIncome=D("-1000"), InterestExpense=D("200"),
                   OperatingExpense=D("100"), FeeIncome=D("-50"))
    opening = {"InterestIncome": D("0"), "InterestExpense": D("0"),
               "OperatingExpense": D("0"), "FeeIncome": D("0")}
    out = metrics.raroc(closing, opening, days=30, risk=RC)
    # income statement net income: income (1000+50) - expense (200+100) = 750
    assert out["net_income"] == D("750")
    assert out["net_income_annualized"] == D("750") * D("365") / D("30")
    assert out["expected_loss"] == D("470.000")
    assert out["economic_capital"] == D("18500.00") * D("0.10")
    assert out["risk_adjusted_return"] == (
        out["net_income_annualized"] - out["expected_loss"])
    assert out["raroc"] == out["risk_adjusted_return"] / out["economic_capital"]


def test_raroc_zero_capital_is_safe():
    out = metrics.raroc({}, {}, days=30, risk=RC)
    assert out["economic_capital"] == D("0.00")
    assert out["raroc"] is None
