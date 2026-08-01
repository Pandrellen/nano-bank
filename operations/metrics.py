"""Pure operational-metric aggregations over the bank's back-office read
payloads. No IO — every function is dict-in/dict-out and unit-testable. Money is
Decimal, parsed from the JSON strings the bank returns.

First cut is status-agnostic: totals, per-type/per-system/per-rail rollups, and
per-status passthrough. Health flags and settlement-success rates (which need
per-rail status semantics) come in Plan B2.
"""
from __future__ import annotations
from decimal import Decimal


def _dec(v) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal(0)


def float_summary(payload: dict) -> dict:
    by_system: dict[str, Decimal] = {}
    for a in payload.get("accounts", []):
        by_system[a["system"]] = by_system.get(a["system"], Decimal(0)) + _dec(a["balance"])
    return {
        "total_float": _dec(payload.get("total_float")),
        "by_system": by_system,
    }


def transactions_summary(payload: dict) -> dict:
    by_type: dict[str, dict] = {}
    total_count = 0
    total_amount = Decimal(0)
    for g in payload.get("groups", []):
        t = by_type.setdefault(g["transaction_type"], {"count": 0, "amount": Decimal(0)})
        t["count"] += int(g["count"])
        t["amount"] += _dec(g["total"])
        total_count += int(g["count"])
        total_amount += _dec(g["total"])
    return {
        "window": payload.get("window"),
        "total_count": total_count,
        "total_amount": total_amount,
        "by_type": by_type,
    }


def rails_summary(payload: dict) -> dict:
    by_rail: dict[str, dict] = {}
    for rail, groups in payload.get("rails", {}).items():
        by_status: dict[str, dict] = {}
        total_count = 0
        total_amount = Decimal(0)
        for g in groups:
            by_status[g["status"]] = {"count": int(g["count"]), "amount": _dec(g["total"])}
            total_count += int(g["count"])
            total_amount += _dec(g["total"])
        by_rail[rail] = {
            "total_count": total_count,
            "total_amount": total_amount,
            "by_status": by_status,
        }
    return {"window": payload.get("window"), "by_rail": by_rail}


def exceptions_summary(payload: dict) -> dict:
    kinds = payload.get("exceptions", {})
    by_kind = {k: int(v) for k, v in kinds.items()}
    return {
        "window": payload.get("window"),
        "total": sum(by_kind.values()),
        "by_kind": by_kind,
    }


def cards_summary(payload: dict) -> dict:
    holds = payload.get("authorization_holds", {})
    cap_count = 0
    cap_amount = Decimal(0)
    for g in payload.get("card_transactions", []):
        cap_count += int(g["count"])
        cap_amount += _dec(g["total"])
    return {
        "window": payload.get("window"),
        "open_holds": {"count": int(holds.get("open_count", 0)), "amount": _dec(holds.get("open_amount"))},
        "captured": {"count": cap_count, "amount": cap_amount},
    }
