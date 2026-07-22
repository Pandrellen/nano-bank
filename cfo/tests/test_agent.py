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
