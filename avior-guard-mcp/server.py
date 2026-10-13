"""AVIOR Guard — fail-closed MCP pilot. No Google or Gmail credentials are used."""
from __future__ import annotations
import os
from decimal import Decimal, InvalidOperation
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("AVIOR Guard — safe diagnostic", host="0.0.0.0", port=int(os.environ.get("PORT", "10000")), stateless_http=True, json_response=True)

def as_number(value: str) -> Decimal:
    try:
        if value.lower().strip() in ("true", "false"):
            raise ValueError("not a number")
        return Decimal(value.strip().replace(" ", "").replace(",", "."))
    except (InvalidOperation, AttributeError):
        raise ValueError("not a number") from None

@mcp.tool()
def avior_guard_status() -> dict:
    """Check MCP connectivity and whether real protected Google operations have been authorized."""
    return {"connected": True, "version": "0.1.0", "google_authorized": False,
            "writes_enabled": False, "private_data_access": False,
            "next_step": "Secure Google authentication is required before real writes."}

@mcp.tool()
def avior_validate_transaction_shape(action: str, tab: str, cell: str, value: str) -> dict:
    """Check a proposed operation against a narrow test allowlist. Never reads or edits Google data."""
    if action != "set_price" or tab != "4. План-счёт" or cell != "E3":
        return {"allowed": False, "reason": "OUTSIDE_ALLOWLIST", "writes_performed": 0}
    try:
        as_number(value)
    except ValueError:
        return {"allowed": False, "reason": "INVALID_NUMBER", "writes_performed": 0}
    return {"allowed": False, "reason": "SOURCE_NOT_VERIFIED", "writes_performed": 0,
            "note": "Trusted Google source was not checked, so operation remains blocked."}

if __name__ == "__main__":
    mcp.run(transport="streamable-http")
