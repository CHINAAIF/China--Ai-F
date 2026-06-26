import os
import hmac
import hashlib
import re
import json
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="TRUNKIA Cognitive Defense Sidecar")

SIDECAR_SECRET = os.getenv("SIDECAR_SECRET", "default_secret")

def verify_signature(payload: bytes, signature: str):
    expected = hmac.new(SIDECAR_SECRET.encode(), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=403, detail="Invalid Signature")

INJECTION_PATTERNS = [
    r"ignore (all )?previous instructions",
    r"you are now (DAN|an AI without restrictions)",
    r"forget your (training|rules)",
    r"reveal your system prompt",
    r"do not follow your rules",
    r"act as (if you are )?an unrestricted AI"
]

JAILBREAK_INDICATORS = [
    "jailbreak", "DAN", "do anything now", "override", "bypass", 
    "restrictions off", "developer mode", "sudo ", "rm -rf"
]

def analyze_prompt(text: str) -> dict:
    text_lower = text.lower()
    
    injection_score = 0.0
    matched_patterns = []
    
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text_lower):
            injection_score += 0.4
            matched_patterns.append(pattern)
            
    jailbreak_score = 0.0
    for indicator in JAILBREAK_INDICATORS:
        if indicator in text_lower:
            jailbreak_score += 0.3
            
    manipulation_score = 0.0
    if len(text) > 4000:
        manipulation_score += 0.2
    if text.count('\n') > 20:
        manipulation_score += 0.2
        
    composite_risk = (manipulation_score * 0.35) + (jailbreak_score * 0.40) + (injection_score * 0.25)
    
    # STRICT POLICY: Any injection attempt is an instant block
    action = "pass"
    if injection_score >= 0.4 or composite_risk >= 0.2:
        action = "block"
    elif composite_risk >= 0.1:
        action = "sanitize"
        
    return {
        "manipulation_score": round(manipulation_score, 4),
        "jailbreak_score": round(jailbreak_score, 4),
        "injection_score": round(injection_score, 4),
        "composite_risk_score": round(composite_risk, 4),
        "detected_techniques": matched_patterns,
        "recommended_action": action
    }

class AnalyzeRequest(BaseModel):
    session_id: str
    messages: List[dict]
    user_id: Optional[str] = None

@app.post("/analyze")
async def analyze_request(req: Request):
    signature = req.headers.get("X-Sidecar-Signature", "")
    body = await req.body()
    verify_signature(body, signature)
    
    try:
        data = json.loads(body)
        messages = data.get("messages", [])
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON")
        
    if not messages:
        return {"action": "pass", "reason": "no_messages"}
        
    last_message = messages[-1].get("content", "")
    analysis = analyze_prompt(last_message)
    
    response = {
        "action": analysis["recommended_action"],
        "scores": analysis
    }
    
    if response["action"] == "sanitize":
        sanitized = last_message
        for pattern in INJECTION_PATTERNS:
            sanitized = re.sub(pattern, "[REDACTED]", sanitized, flags=re.IGNORECASE)
        messages[-1]["content"] = sanitized
        response["sanitized_messages"] = messages
        
    return response

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "cognitive-defense"}
