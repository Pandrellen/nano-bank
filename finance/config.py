from __future__ import annotations
import os
from dataclasses import dataclass
from decimal import Decimal
from typing import Mapping, Optional


_DEFAULT_WEIGHTS = {
    "CashReserves": Decimal("0"),
    "TreasuryPlacement": Decimal("0.20"),
    "CardReceivable": Decimal("0.75"),
    "OverdraftReceivable": Decimal("1.00"),
    "LoansReceivable": Decimal("1.00"),
}
_DEFAULT_LOSS = {
    "CardReceivable": Decimal("0.03"),
    "OverdraftReceivable": Decimal("0.02"),
    "LoansReceivable": Decimal("0.015"),
}


@dataclass(frozen=True)
class RiskConfig:
    """Basel-lite capital model for RAROC (spec #5 replaces this behind raroc())."""
    risk_weights: dict
    loss_rates: dict
    target_ratio: Decimal

    @classmethod
    def default(cls) -> "RiskConfig":
        return cls(risk_weights=dict(_DEFAULT_WEIGHTS),
                   loss_rates=dict(_DEFAULT_LOSS),
                   target_ratio=Decimal("0.10"))

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "RiskConfig":
        e = os.environ if env is None else env
        weights = dict(_DEFAULT_WEIGHTS)
        loss = dict(_DEFAULT_LOSS)
        for role in list(weights):
            if (v := e.get(f"RISK_WEIGHT_{role}")) is not None:
                weights[role] = Decimal(v)
        for role in list(loss):
            if (v := e.get(f"RISK_LOSS_{role}")) is not None:
                loss[role] = Decimal(v)
        ratio = Decimal(e.get("RISK_TARGET_RATIO", "0.10"))
        return cls(risk_weights=weights, loss_rates=loss, target_ratio=ratio)


@dataclass
class Settings:
    db: dict
    nano_bank_api: str
    mcp_port: int

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Settings":
        e = os.environ if env is None else env

        def g(k, d=""):
            return e.get(k, d)

        return cls(
            db=dict(
                host=g("DB_HOST", "::1"),
                port=int(g("DB_PORT", "5432")),
                dbname=g("DB_NAME", "nano_bank_db"),
                user=g("DB_USER", "nanobank_user"),
                password=g("DB_PASSWORD", "secure_nano_password_2024!"),
            ),
            nano_bank_api=g("NANO_BANK_API", "http://localhost:8081"),
            mcp_port=int(g("MCP_PORT", "8088")),
        )
