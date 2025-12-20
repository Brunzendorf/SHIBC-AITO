# 🚨 Token-Spar-Modus (Bei niedrigem Claude Quota)

Wenn dein Claude.ai Usage bei <10% ist, aktiviere diese Einstellungen:

## Schnell-Aktivierung (.env):

```bash
# 1. PR Bypass (spart am meisten!)
WORKSPACE_SKIP_PR=true          # Kein RAG Review, kein CEO Approval

# 2. Gemini bevorzugen
LLM_PREFER_GEMINI=true          # Alle Tasks → Gemini (außer critical)

# 3. Optional: Routing Strategy ändern
LLM_ROUTING_STRATEGY=gemini-prefer
```

## Was wird gespart:

| Feature | Claude Calls | Token-Ersparnis |
|---------|--------------|-----------------|
| **PR Bypass** | -3 calls/commit | ~6000 tokens |
| ├─ PR Creation | -1 call | ~2000 tokens |
| ├─ RAG Review | -1 call | ~2000 tokens |
| └─ CEO Approval | -1 call | ~2000 tokens |
| **Gemini Prefer** | -80% calls | ~15000 tokens/Tag |
| └─ Nur critical → Claude | Rest → Gemini Free |

## Rückgängig machen (nach Quota-Reset):

```bash
WORKSPACE_SKIP_PR=false
LLM_PREFER_GEMINI=false
LLM_ROUTING_STRATEGY=task-type
```

## Container neu starten:

```bash
docker compose restart
```
