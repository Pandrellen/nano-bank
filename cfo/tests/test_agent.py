import asyncio
from unittest.mock import patch
from langchain_core.messages import AIMessage

from cfo.config import Settings
from cfo import agent as cfo_agent


class _FakeAgent:
    async def ainvoke(self, state, config=None):
        return {"messages": state["messages"] +
                [AIMessage("RAROC is 18.3%, which is healthy.")]}


def test_prompt_pins_discipline():
    p = cfo_agent.CFO_PROMPT.lower()
    assert "chief financial officer" in p
    assert "never" in p and "tool" in p


def test_ask_returns_answer_and_thread():
    s = Settings.from_env({"OLLAMA_API_KEY": "x"})

    async def _fake_get_tools(settings):
        return []

    with patch.object(cfo_agent, "get_tools", _fake_get_tools), \
         patch.object(cfo_agent, "create_react_agent", return_value=_FakeAgent()), \
         patch.object(cfo_agent.mf, "llm", return_value=object()):
        out = asyncio.run(cfo_agent.ask(s, "How healthy are we?", thread_id="t1"))
    assert out["thread_id"] == "t1"
    assert "RAROC" in out["answer"]
    assert isinstance(out["trace"], list)


def test_prompt_refuses_unverified_premises():
    """The CFO's worst failure mode is completing a narrative: given a made-up
    NPL ratio it will happily explain what is driving it. The prompt has to
    make a supplied figure a claim to check, not a fact to build on."""
    p = cfo_agent.CFO_PROMPT.lower()
    assert "unverified claim" in p
    assert "cannot see it" in p
    assert "list_periods does not cover" in p


def test_prompt_pins_units_discipline():
    """expected_loss is annual; netting it against a month of net income turns
    a profitable month into a fake loss."""
    p = cfo_agent.CFO_PROMPT.lower()
    assert "expected_loss_period" in p
    assert "annual figure" in p


def test_prompt_requires_naming_the_period_and_its_limits():
    """Snapshots are monthly. Asked about 'last quarter' the CFO answered from
    a single month without saying so — quietly narrowing the question is as
    misleading as answering it wrong."""
    p = cfo_agent.CFO_PROMPT.lower()
    assert "name the period" in p
    assert "monthly" in p


def test_prompt_routes_hypotheticals_to_a_tool():
    """Asked what a 1% provision would do, the CFO hand-computed the answer and
    forgot to annualise it — ROE came out 11x too small, tabled beside the
    correctly annualised current figure."""
    p = cfo_agent.CFO_PROMPT.lower()
    assert "provision_scenario" in p
    assert "do not hand-roll" in p


def test_prompt_is_honest_about_close_period():
    """It claimed to take no actions while holding a tool that writes a GL
    snapshot — and used it on request."""
    p = cfo_agent.CFO_PROMPT.lower()
    assert "close_period" in p
    assert "no financial actions" in p


class _TwoPassAgent:
    """Pass 1 returns an ungrounded figure; pass 2 (after the revise message)
    returns a clean, grounded answer. Records how many times it was invoked."""

    def __init__(self):
        self.calls = 0

    async def ainvoke(self, state, config=None):
        self.calls += 1
        if self.calls == 1:
            text = "Net income $1,448.08, and an invented loss of -$7,652.00."
        else:
            text = "Corrected: net income $1,448.08 (my estimate: none)."
        return {"messages": state["messages"] + [AIMessage(text)]}


def test_ask_revises_once_when_a_figure_is_ungrounded():
    s = Settings.from_env({"OLLAMA_API_KEY": "x"})
    fake = _TwoPassAgent()

    async def _fake_get_tools(settings):
        return []

    # The grounded set comes from the trace; stub it so 1448.08 is grounded and
    # 7652 is not, regardless of what the fake agent "called".
    trace = [{"kind": "tool", "name": "income_statement",
              "output": "{'net_income': '1448.08'}"}]

    with patch.object(cfo_agent, "get_tools", _fake_get_tools), \
         patch.object(cfo_agent, "create_react_agent", return_value=fake), \
         patch.object(cfo_agent.mf, "llm", return_value=object()), \
         patch.object(cfo_agent.TraceRecorder, "events", lambda self: trace):
        out = asyncio.run(cfo_agent.ask(s, "How did we do?", thread_id="t"))

    assert fake.calls == 2                       # revised exactly once
    assert out["verification"]["revised"] is True
    assert "$1,448.08" in out["answer"]


def test_ask_does_not_revise_when_all_grounded():
    s = Settings.from_env({"OLLAMA_API_KEY": "x"})
    fake = _TwoPassAgent()

    async def _fake_get_tools(settings):
        return []

    trace = [{"kind": "tool", "name": "income_statement",
              "output": "{'net_income': '1448.08'}"}]

    # Pass-1 answer here contains only grounded figures.
    async def _one_pass(state, config=None):
        fake.calls += 1
        return {"messages": state["messages"] +
                [AIMessage("Net income was $1,448.08.")]}
    fake.ainvoke = _one_pass

    with patch.object(cfo_agent, "get_tools", _fake_get_tools), \
         patch.object(cfo_agent, "create_react_agent", return_value=fake), \
         patch.object(cfo_agent.mf, "llm", return_value=object()), \
         patch.object(cfo_agent.TraceRecorder, "events", lambda self: trace):
        out = asyncio.run(cfo_agent.ask(s, "How did we do?", thread_id="t"))

    assert fake.calls == 1                       # no revision
    assert out["verification"]["revised"] is False
    assert out["verification"]["ungrounded"] == []
