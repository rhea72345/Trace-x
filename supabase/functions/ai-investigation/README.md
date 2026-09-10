# AI Investigation Edge Function

This Supabase Edge Function provides hosted AI capabilities for the TRACE-X investigation assistant using Groq's fast API.

## Setup Instructions

### 1. Get Groq API Key
1. Go to [https://console.groq.com/](https://console.groq.com/)
2. Sign up for a free account (Groq has a generous free tier)
3. Create an API key in the dashboard
4. Copy the API key

### 2. Add API Key to Supabase Secrets
Run this command in your project directory:

```bash
supabase secrets set GROQ_API_KEY=your_groq_api_key_here
```

Or add it via the Supabase dashboard:
1. Go to your project in Supabase dashboard
2. Navigate to Edge Functions → Settings
3. Add environment variable: `GROQ_API_KEY`
4. Paste your Groq API key as the value

### 3. Deploy the Edge Function
```bash
supabase functions deploy ai-investigation
```

## How It Works

1. The Edge Function receives investigation queries with evidence packets
2. It constructs a safety-constrained prompt with the evidence
3. Calls Groq API using the `llama3-70b-8192` model (fast and capable)
4. Returns AI-generated responses with citations from the evidence
5. Falls back gracefully if the API is unavailable

## Safety Features

- Evidence-grounded responses only
- Never invents transactions, accounts, or amounts
- Clearly states when evidence is insufficient
- Never declares guilt or makes legal accusations
- Maintains human analyst decision authority

## Model Configuration

- **Model**: `llama3-70b-8192` (hosted on Groq)
- **Temperature**: 0.3 (factual, lower creativity)
- **Max Tokens**: 500 (concise responses)
- **Timeout**: 15 seconds

## Testing

Test the function locally:
```bash
supabase functions serve ai-investigation
```

Test with curl:
```bash
curl -X POST http://localhost:54321/functions/v1/ai-investigation \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Why is this network suspicious?",
    "evidence": {
      "network_id": "NET-001",
      "network_name": "Test Network",
      "account_ids": ["ACC-001", "ACC-002"],
      "transaction_ids": ["TXN-001"],
      "amounts": [1000],
      "timestamps": ["2024-01-01T00:00:00Z"],
      "risk_scores": [75],
      "signals": ["High velocity"],
      "patterns": ["mule_chain"]
    }
  }'
```