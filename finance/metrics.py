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
