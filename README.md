# Nova Insight (hosted on Render)

Created by KaztryxAV.

Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`

Environment variables:

| Name | Purpose |
|---|---|
| `KAZAI_CREATOR_PASSWORD` | Password for the `kaztryxav` creator login. Required. |
| `DATABASE_URL` | Postgres connection string. Without it, accounts are lost whenever Render restarts. |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Optional. Without them KazAI uses the free Pollinations model. |
