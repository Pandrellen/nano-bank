"""Pure CFO-metric math over period snapshots (debit-credit convention).
No DB/IO — every function is unit-testable in isolation. Money is Decimal.
The RAROC capital model is Basel-lite (finance.config.RiskConfig); spec #5
replaces it behind the same signatures.
"""
from __future__ import annotations
from decimal import Decimal
from . import reports
from .config import RiskConfig


def _safe_div(n: Decimal, d: Decimal):
    return n / d if d else None


def economic_capital(snapshot: dict, risk: RiskConfig) -> dict:
    rwa: dict[str, Decimal] = {}
    for role, weight in risk.risk_weights.items():
        bal = snapshot.get(role, Decimal(0))
        rwa[role] = (bal * weight).quantize(Decimal("0.01"))
    total = sum(rwa.values(), Decimal(0))
    return {"rwa": rwa, "total_rwa": total,
            "economic_capital": (total * risk.target_ratio).quantize(Decimal("0.01"))}


def expected_loss(snapshot: dict, risk: RiskConfig) -> Decimal:
    total = Decimal(0)
    for role, rate in risk.loss_rates.items():
        total += snapshot.get(role, Decimal(0)) * rate
    return total


def raroc(closing: dict, opening: dict, days: int, risk: RiskConfig) -> dict:
    inc = reports.income_statement(closing, opening)
    ni = inc["net_income"]
    # Annualise multiply-first (x * 365 / days) so exact figures stay exact.
    ni_ann = ni * Decimal(365) / Decimal(days)
    el = expected_loss(closing, risk)
    ec = economic_capital(closing, risk)
    rar = ni_ann - el
    return {
        "net_income": ni,
        "net_income_annualized": ni_ann,
        "expected_loss": el,
        "risk_adjusted_return": rar,
        "economic_capital": ec["economic_capital"],
        "total_rwa": ec["total_rwa"],
        "rwa": ec["rwa"],
        "raroc": _safe_div(rar, ec["economic_capital"]),
    }


def key_ratios(closing: dict, opening: dict, days: int, risk: RiskConfig) -> dict:
    bs = reports.balance_sheet(closing)
    inc = reports.income_statement(closing, opening)
    nim_out = reports.nim(closing, opening, days)
    ec = economic_capital(closing, risk)

    def ann(x: Decimal) -> Decimal:
        return x * Decimal(365) / Decimal(days)

    ni_ann = ann(inc["net_income"])

    ii = inc["income"].get("InterestIncome", Decimal(0))
    ie = inc["expense"].get("InterestExpense", Decimal(0))
    fee = inc["income"].get("FeeIncome", Decimal(0))
    interchange = inc["income"].get("InterchangeIncome", Decimal(0))
    opex = inc["expense"].get("OperatingExpense", Decimal(0))
    total_revenue = (ii - ie) + fee + interchange

    total_assets = bs["total_assets"]
    total_equity = sum(bs["equity"].values(), Decimal(0))
    capital_base = sum((v for k, v in bs["equity"].items()
                        if k != "CurrentEarnings"), Decimal(0))
    loans = sum((closing.get(r, Decimal(0)) for r in
                 ("CardReceivable", "OverdraftReceivable", "LoansReceivable")),
                Decimal(0))
    deposits_close = -closing.get("CustomerDeposits", Decimal(0))
    deposits_open = -opening.get("CustomerDeposits", Decimal(0))
    avg_deposits = (deposits_open + deposits_close) / Decimal(2)

    return {
        "roa": _safe_div(ni_ann, total_assets),
        "roe": _safe_div(ni_ann, capital_base),
        "efficiency_ratio": _safe_div(opex, total_revenue),
        "loan_to_deposit": _safe_div(loans, deposits_close),
        "leverage_ratio": _safe_div(total_equity, total_assets),
        "rwa_capital_ratio": _safe_div(total_equity, ec["total_rwa"]),
        "cost_of_funds": _safe_div(ann(ie), avg_deposits),
        "yield_on_earning_assets": _safe_div(ann(ii),
                                             nim_out["avg_earning_assets"]),
    }


def financial_health(closing: dict, opening: dict, days: int,
                     risk: RiskConfig) -> dict:
    return {
        "balance_sheet": reports.balance_sheet(closing),
        "income_statement": reports.income_statement(closing, opening),
        "nim": reports.nim(closing, opening, days),
        "key_ratios": key_ratios(closing, opening, days, risk),
        "raroc": raroc(closing, opening, days, risk),
    }
