"""The Agent CFO — a read-only financial officer over the finance MCP.

Phase 1 is an analyst: it reads reports, computes metrics through tools and
answers questions. It takes no actions (no money movement, no postings).
"""
from __future__ import annotations
import uuid
from typing import Optional

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import InMemorySaver

from .config import Settings
from . import model_factory as mf
from .tools import get_tools
from .trace import TraceRecorder

CFO_PROMPT = (
    "You are the Chief Financial Officer of nano-bank; you speak for the whole "
    "bank's finances. Answer ONLY from your finance tools; never fabricate a "
    "figure, rate, or trend. ALWAYS compute metrics by calling the tools "
    "(financial_health, raroc, key_ratios, balance_sheet, income_statement, "
    "nim, segment_pnl) — never do the arithmetic yourself. If a period is not "
    "closed, call list_periods and use an available period or offer to run "
    "close_period; do not guess un-closed figures. When you state a metric, "
    "briefly say what it means and whether it looks healthy, but ground every "
    "number in a tool result. You are an analyst: you may recommend, but you "
    "take no actions — you cannot move money, post entries, or commit budgets."
)


async def ask(settings: Settings, message: str,
              thread_id: Optional[str] = None) -> dict:
    thread_id = thread_id or f"cfo-{uuid.uuid4().hex[:6]}"
    tools = await get_tools(settings)
    rec = TraceRecorder()
    agent = create_react_agent(mf.llm(), tools, prompt=CFO_PROMPT,
                               checkpointer=InMemorySaver())
    out = await agent.ainvoke(
        {"messages": [HumanMessage(message)]},
        config={"configurable": {"thread_id": thread_id}, "recursion_limit": 40,
                "callbacks": [rec]})
    answer = "(no answer)"
    for m in reversed(out["messages"]):
        if isinstance(m, AIMessage) and (m.content or "").strip():
            answer = m.content
            break
    return {"answer": answer, "thread_id": thread_id, "trace": rec.events()}
