from cfo import claims


def test_grounded_periods_from_list_periods_output_and_tool_inputs():
    trace = [
        {"kind": "tool", "name": "list_periods", "input": "{}",
         "output": "['2026-06', '2026-07']"},
        {"kind": "tool", "name": "nim", "input": "{'period': '2026-07'}",
         "output": "{'nim': '0.0628'}"},
        {"kind": "model", "name": "model", "input": None, "output": None},
    ]
    assert claims.grounded_periods(trace) == {"2026-06", "2026-07"}


def test_grounded_periods_ignores_non_period_numbers():
    trace = [{"kind": "tool", "name": "raroc", "input": "{'period': '2026-07'}",
              "output": "{'raroc': '0.151', 'total_rwa': '2026000'}"}]
    assert claims.grounded_periods(trace) == {"2026-07"}
