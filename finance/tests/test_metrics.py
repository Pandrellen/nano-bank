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


def _ann(x):
    # multiply-first annualisation, matching the implementation
    return x * D("365") / D("30")


def test_key_ratios():
    closing = {
        "CashReserves": D("5000"), "CardReceivable": D("10000"),
        "TreasuryPlacement": D("5000"),
        "CustomerDeposits": D("-16000"),          # deposits 16000
        "Capital": D("-3000"),                    # equity 3000 (ex earnings)
        "InterestIncome": D("-1000"), "InterestExpense": D("200"),
        "OperatingExpense": D("100"), "FeeIncome": D("-50"),
    }
    opening = {
        "CardReceivable": D("10000"), "TreasuryPlacement": D("5000"),
        "CustomerDeposits": D("-16000"),
        "InterestIncome": D("0"), "InterestExpense": D("0"),
        "OperatingExpense": D("0"), "FeeIncome": D("0"),
    }
    r = metrics.key_ratios(closing, opening, days=30, risk=RC)
    # net income = income(1050) - expense(300) = 750; annualised = 750*365/30
    ni_ann = _ann(D("750"))
    # total assets = 5000+10000+5000 = 20000
    assert r["roa"] == ni_ann / D("20000")
    # capital base = equity excluding CurrentEarnings = 3000
    assert r["roe"] == ni_ann / D("3000")
    # efficiency = opex(100) / total_revenue(net interest 800 + fee 50) = 100/850
    assert r["efficiency_ratio"] == D("100") / D("850")
    # LDR = loans(10000) / deposits(16000)
    assert r["loan_to_deposit"] == D("10000") / D("16000")
    # cost of funds = interest_expense annualised / avg deposits(16000)
    assert r["cost_of_funds"] == _ann(D("200")) / D("16000")


def test_key_ratios_guard_zero_denominators():
    r = metrics.key_ratios({}, {}, days=30, risk=RC)
    assert r["roa"] is None
    assert r["loan_to_deposit"] is None


def test_financial_health_bundle_keys():
    closing = {"CashReserves": D("100"), "Capital": D("-100"),
               "InterestIncome": D("-10")}
    opening = {"InterestIncome": D("0")}
    fh = metrics.financial_health(closing, opening, days=30, risk=RC)
    assert set(fh) == {"balance_sheet", "income_statement", "nim",
                       "key_ratios", "raroc"}
    assert fh["raroc"]["net_income"] == D("10")
