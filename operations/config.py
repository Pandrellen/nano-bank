from __future__ import annotations
import os
from dataclasses import dataclass
from typing import Mapping, Optional


@dataclass
class Settings:
    nano_bank_api: str
    service_client_secret: str
    mcp_port: int
    timeout: float

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Settings":
        e = os.environ if env is None else env
        return cls(
            nano_bank_api=e.get("NANO_BANK_API", "http://localhost:8081"),
            service_client_secret=e.get(
                "SERVICE_CLIENT_SECRET", "nano-bank-visa-network-secret-change-me"
            ),
            mcp_port=int(e.get("MCP_PORT", "8092")),
            timeout=float(e.get("REQUEST_TIMEOUT", "10.0")),
        )
