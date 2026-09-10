import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
const GROQ_MODEL = "llama3-70b-8192" // Fast, capable model for production

serve(async (req) => {
  try {
    // Only allow POST requests
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }

    const { query, evidence } = await req.json()

    // Validate required fields
    if (!query || !evidence) {
      return new Response("Missing required fields: query and evidence", { status: 400 })
    }

    // Get Groq API key from environment
    const groqApiKey = Deno.env.get("GROQ_API_KEY")
    if (!groqApiKey) {
      console.error("GROQ_API_KEY not configured in Supabase secrets")
      return new Response(
        JSON.stringify({ 
          error: "Groq API not configured",
          message: "GROQ_API_KEY environment variable not set"
        }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    // Build the prompt with evidence and safety constraints
    const systemPrompt = `You are a financial crime investigation assistant. Your role is to help analysts understand suspicious transaction networks by analyzing evidence data.

SAFETY RULES - YOU MUST FOLLOW THESE:
1. Answer ONLY using the evidence provided above
2. Reference actual account IDs, transaction IDs, amounts, and timestamps from the evidence
3. DO NOT invent any transactions, accounts, amounts, or dates
4. If evidence is insufficient to answer, clearly state "Evidence insufficient to answer this question"
5. NEVER declare a person guilty or make legal accusations
6. Describe suspicious/risky behaviour patterns, not legal conclusions
7. Final decisions must be made by authorized human analysts
8. Keep responses factual and grounded in the provided data
9. Use "suspicious activity" or "risky behaviour" instead of "fraud" or "crime"
10. Include specific IDs from the evidence in your response

EVIDENCE PACKET:
- Network: ${evidence.network_name || "N/A"} (${evidence.network_id || "N/A"})
- Accounts: ${evidence.account_ids.length} (${evidence.account_ids.slice(0, 5).join(", ")}${evidence.account_ids.length > 5 ? "..." : ""})
- Transactions: ${evidence.transaction_ids.length}
- Total Amount: ₹${evidence.amounts.reduce((a: number, b: number) => a + b, 0).toLocaleString()}
- Risk Scores: ${evidence.risk_scores.slice(0, 5).join(", ")}${evidence.risk_scores.length > 5 ? "..." : ""}
- Patterns: ${evidence.patterns.join(", ")}
- Signals: ${evidence.signals.slice(0, 3).join("; ")}
${evidence.narrative ? `- Narrative: ${evidence.narrative}` : ""}

SPECIFIC DATA POINTS:
- Account IDs: ${evidence.account_ids.join(", ")}
- Transaction IDs: ${evidence.transaction_ids.slice(0, 10).join(", ")}${evidence.transaction_ids.length > 10 ? "..." : ""}
- Amounts: ${evidence.amounts.slice(0, 10).map((a: number) => `₹${a}`).join(", ")}${evidence.amounts.length > 10 ? "..." : ""}
- Timestamps: ${evidence.timestamps.slice(0, 5).join(", ")}${evidence.timestamps.length > 5 ? "..." : ""}

Provide a clear, evidence-based answer citing specific IDs from the evidence packet above.`

    // Call Groq API
    const groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: query
          }
        ],
        temperature: 0.3, // Lower temperature for more factual responses
        max_tokens: 500,
      }),
    })

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text()
      console.error("Groq API error:", groqResponse.status, errorText)
      return new Response(
        JSON.stringify({ 
          error: "Groq API request failed",
          status: groqResponse.status,
          message: errorText
        }),
        { 
          status: groqResponse.status,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const groqData = await groqResponse.json()
    const aiResponse = groqData.choices?.[0]?.message?.content || ""

    // Extract citations from response
    const citations = extractCitations(aiResponse, evidence)

    return new Response(
      JSON.stringify({
        text: aiResponse,
        citations,
        confidence: 0.8,
        used_llm: true,
        evidence_insufficient: aiResponse.toLowerCase().includes("evidence insufficient")
      }),
      {
        headers: { "Content-Type": "application/json" }
      }
    )

  } catch (error) {
    console.error("Edge function error:", error)
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        message: error.message
      }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
})

function extractCitations(response: string, evidence: any): string[] {
  const citations: string[] = []
  
  // Look for account IDs
  const accountPattern = /ACC-[A-Z0-9]+/g
  const accounts = response.match(accountPattern)
  if (accounts) {
    citations.push(...accounts.filter((id: string) => evidence.account_ids.includes(id)))
  }
  
  // Look for transaction IDs
  const txnPattern = /TXN-[A-Z0-9]+/g
  const txns = response.match(txnPattern)
  if (txns) {
    citations.push(...txns.filter((id: string) => evidence.transaction_ids.includes(id)))
  }
  
  // Look for network IDs
  const netPattern = /NET-\d+/g
  const nets = response.match(netPattern)
  if (nets) {
    citations.push(...nets.filter((id: string) => id === evidence.network_id))
  }
  
  return [...new Set(citations)] // Remove duplicates
}