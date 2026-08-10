"""NexaTel CRM integration adapter.

Internal mode keeps the built-in support queue. Webhook mode can forward the same
normalized ticket to a CRM/integration layer. An MCP CRM tool can consume the same
payload later without changing NexaTel's ticket model.
"""
from __future__ import annotations
import json, os
from typing import Any, Dict
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError

CRM_MODE=os.getenv("CRM_MODE","internal").strip().lower()
CRM_WEBHOOK_URL=os.getenv("CRM_WEBHOOK_URL","").strip()
CRM_API_KEY=os.getenv("CRM_API_KEY","").strip()

def crm_is_configured()->bool:
    if CRM_MODE=="internal": return True
    if CRM_MODE=="webhook": return bool(CRM_WEBHOOK_URL)
    return False

def create_or_sync_crm_ticket(ticket:Dict[str,Any])->Dict[str,Any]:
    if CRM_MODE=="internal":
        return {"mode":"internal","synced":False,"external_ticket_id":None,"message":"Using NexaTel internal support queue."}
    if CRM_MODE=="webhook":
        if not CRM_WEBHOOK_URL:
            return {"mode":"webhook","synced":False,"external_ticket_id":None,"message":"CRM webhook URL is not configured."}
        headers={"Content-Type":"application/json","User-Agent":"NexaTel-Support/1.0"}
        if CRM_API_KEY: headers["Authorization"]=f"Bearer {CRM_API_KEY}"
        req=urllib_request.Request(CRM_WEBHOOK_URL,data=json.dumps(ticket).encode("utf-8"),headers=headers,method="POST")
        try:
            with urllib_request.urlopen(req,timeout=8) as response:
                body=response.read().decode("utf-8").strip()
                try: parsed=json.loads(body) if body else {}
                except json.JSONDecodeError: parsed={}
                ext=parsed.get("ticket_id") or parsed.get("id") or parsed.get("case_id")
                return {"mode":"webhook","synced":200<=response.status<300,"external_ticket_id":ext,"message":"CRM ticket synchronized."}
        except (HTTPError,URLError,TimeoutError) as error:
            print(f"[crm] webhook sync failed: {error!r}")
            return {"mode":"webhook","synced":False,"external_ticket_id":None,"message":"CRM sync failed; internal ticket retained."}
    return {"mode":CRM_MODE,"synced":False,"external_ticket_id":None,"message":"Unknown CRM mode; internal ticket retained."}
