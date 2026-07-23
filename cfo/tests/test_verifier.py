from decimal import Decimal as D
from cfo import verifier


def test_grounded_values_parses_numbers_from_tool_outputs():
    trace = [
        {"kind": "tool", "name": "raroc",
         "output": "{'raroc': '0.151', 'expected_loss': '9100.00', "
                   "'credit_exposure': '510000'}"},
        {"kind": "model", "name": "model", "output": None},
        {"kind": "tool", "name": "key_ratios",
         "output": "{'roe': '0.2131', 'roa': '0.0209'}"},
    ]
    vals = verifier.grounded_values(trace)
    assert D("0.151") in vals
    assert D("9100.00") in vals
    assert D("510000") in vals
    assert D("0.2131") in vals


def test_grounded_values_ignores_model_events_and_empty_output():
    trace = [
        {"kind": "model", "name": "model", "output": None},
        {"kind": "tool", "name": "t", "output": ""},
    ]
    assert verifier.grounded_values(trace) == []
