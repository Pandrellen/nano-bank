from decimal import Decimal as D
from finance.config import RiskConfig


def test_default_risk_config_matches_spec():
    rc = RiskConfig.default()
    assert rc.target_ratio == D("0.10")
    assert rc.risk_weights["CardReceivable"] == D("0.75")
    assert rc.risk_weights["TreasuryPlacement"] == D("0.20")
    assert rc.risk_weights["OverdraftReceivable"] == D("1.00")
    assert rc.risk_weights["LoansReceivable"] == D("1.00")
    assert rc.risk_weights["CashReserves"] == D("0")
    assert rc.loss_rates["CardReceivable"] == D("0.03")
    assert rc.loss_rates["OverdraftReceivable"] == D("0.02")
    assert rc.loss_rates["LoansReceivable"] == D("0.015")


def test_from_env_overrides_target_and_a_weight():
    rc = RiskConfig.from_env({
        "RISK_TARGET_RATIO": "0.12",
        "RISK_WEIGHT_CardReceivable": "0.80",
        "RISK_LOSS_LoansReceivable": "0.02",
    })
    assert rc.target_ratio == D("0.12")
    assert rc.risk_weights["CardReceivable"] == D("0.80")
    assert rc.risk_weights["TreasuryPlacement"] == D("0.20")   # untouched default
    assert rc.loss_rates["LoansReceivable"] == D("0.02")
