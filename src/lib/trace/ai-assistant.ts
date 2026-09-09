/**
 * AI Investigation Assistant with Local LLM Support
 * 
 * Integrates local LLM (via Ollama) for natural language investigation queries,
 * with graceful fallback to the existing deterministic query engine.
 * 
 * Safety Rules:
 * - AI must answer using provided evidence only
 * - Reference actual IDs/data from evidence
 * - Avoid inventing transactions/accounts/amounts/dates
 * - Clearly say when evidence is insufficient
 * - Never declare a person guilty
 * - Describe suspicious/risky behaviour, not legal accusations
 * - Keep final decisions with authorized human analysts
 */

import { db, type NetworkCluster, type Account, type Transaction } from "./engine";

export interface EvidencePacket {
  network_id?: string;
  network_name?: string;
  account_ids: string[];
  transaction_ids: string[];
  amounts: number[];
  timestamps: string[];
  risk_scores: number[];
  signals: string[];
  patterns: string[];
  narrative?: string;
  cluster_risk_score?: number;
}

export interface AIResponse {
  text: string;
  citations: string[];
  confidence: number;
  used_llm: boolean;
  evidence_insufficient: boolean;
}

export interface LLMConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeout: number;
}

const DEFAULT_LLM_CONFIG: LLMConfig = {
  enabled: true,
  endpoint: "http://localhost:11434/api/generate", // Default Ollama endpoint
  model: "llama3.2", // Lightweight model
  timeout: 10000, // 10 seconds
};

let llmConfig = { ...DEFAULT_LLM_CONFIG };
let llmAvailable = false;

/**
 * Check if Ollama/local LLM is available
 */
export async function checkLLMAvailability(): Promise<boolean> {
  try {
    const response = await fetch(llmConfig.endpoint.replace("/generate", "/tags"), {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    llmAvailable = response.ok;
    console.log("LLM availability check:", llmAvailable);
    return llmAvailable;
  } catch (error) {
    console.warn("LLM not available, using deterministic fallback:", error);
    llmAvailable = false;
    return false;
  }
}

/**
 * Configure LLM settings
 */
export function configureLLM(config: Partial<LLMConfig>): void {
  llmConfig = { ...llmConfig, ...config };
}

/**
 * Generate evidence packet for AI context
 */
export function generateEvidencePacket(
  networkId?: string,
  accountId?: string,
  transactionIds?: string[]
): EvidencePacket {
  const packet: EvidencePacket = {
    account_ids: [],
    transaction_ids: [],
    amounts: [],
    timestamps: [],
    risk_scores: [],
    signals: [],
    patterns: [],
  };

  if (networkId) {
    const cluster = db.getCluster(networkId);
    if (cluster) {
      packet.network_id = cluster.id;
      packet.network_name = cluster.name;
      packet.account_ids = cluster.member_account_ids;
      packet.transaction_ids = cluster.transaction_ids;
      packet.cluster_risk_score = cluster.cluster_risk_score;
      packet.patterns = cluster.pattern_tags;
      packet.signals = cluster.signals.map(s => `${s.label}: ${s.reason}`);
      packet.narrative = cluster.narrative;

      const txns = db.clusterTransactions(networkId);
      packet.amounts = txns.map(t => t.amount);
      packet.timestamps = txns.map(t => t.timestamp);

      const accounts = cluster.member_account_ids
        .map(id => db.getAccount(id))
        .filter((a): a is Account => a !== null);
      packet.risk_scores = accounts.map(a => a.risk_score);
    }
  }

  if (accountId) {
    const account = db.getAccount(accountId);
    if (account) {
      if (!packet.account_ids.includes(accountId)) {
        packet.account_ids.push(accountId);
      }
      packet.risk_scores.push(account.risk_score);

      const txns = db.accountTransactions(accountId);
      txns.forEach(t => {
        if (!packet.transaction_ids.includes(t.transaction_id)) {
          packet.transaction_ids.push(t.transaction_id);
          packet.amounts.push(t.amount);
          packet.timestamps.push(t.timestamp);
        }
      });
    }
  }

  if (transactionIds) {
    transactionIds.forEach(tid => {
      const txn = db.getTransaction(tid);
      if (txn && !packet.transaction_ids.includes(tid)) {
        packet.transaction_ids.push(tid);
        packet.amounts.push(txn.amount);
        packet.timestamps.push(txn.timestamp);
      }
    });
  }

  return packet;
}

/**
 * Build prompt for LLM with evidence and safety constraints
 */
function buildLLMPrompt(query: string, evidence: EvidencePacket): string {
  const evidenceText = `
EVIDENCE PACKET:
- Network: ${evidence.network_name || "N/A"} (${evidence.network_id || "N/A"})
- Accounts: ${evidence.account_ids.length} (${evidence.account_ids.slice(0, 5).join(", ")}${evidence.account_ids.length > 5 ? "..." : ""})
- Transactions: ${evidence.transaction_ids.length}
- Total Amount: ₹${evidence.amounts.reduce((a, b) => a + b, 0).toLocaleString()}
- Risk Scores: ${evidence.risk_scores.slice(0, 5).join(", ")}${evidence.risk_scores.length > 5 ? "..." : ""}
- Patterns: ${evidence.patterns.join(", ")}
- Signals: ${evidence.signals.slice(0, 3).join("; ")}
${evidence.narrative ? `- Narrative: ${evidence.narrative}` : ""}

SPECIFIC DATA POINTS:
- Account IDs: ${evidence.account_ids.join(", ")}
- Transaction IDs: ${evidence.transaction_ids.slice(0, 10).join(", ")}${evidence.transaction_ids.length > 10 ? "..." : ""}
- Amounts: ${evidence.amounts.slice(0, 10).map(a => `₹${a}`).join(", ")}${evidence.amounts.length > 10 ? "..." : ""}
- Timestamps: ${evidence.timestamps.slice(0, 5).join(", ")}${evidence.timestamps.length > 5 ? "..." : ""}
`;

  const safetyInstructions = `
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
`;

  return `${safetyInstructions}

${evidenceText}

USER QUESTION: ${query}

Provide a clear, evidence-based answer citing specific IDs from the evidence packet above.`;
}

/**
 * Query local LLM (Ollama)
 */
async function queryLocalLLM(prompt: string): Promise<string> {
  try {
    const response = await fetch(llmConfig.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llmConfig.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3, // Lower temperature for more factual responses
          max_tokens: 500,
        },
      }),
      signal: AbortSignal.timeout(llmConfig.timeout),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.response || data.text || "";
  } catch (error) {
    console.error("LLM query failed:", error);
    throw error;
  }
}

/**
 * Process AI query with LLM or fallback
 */
export async function processAIQuery(
  query: string,
  networkId?: string,
  accountId?: string
): Promise<AIResponse> {
  const evidence = generateEvidencePacket(networkId, accountId);

  // Try LLM if available and enabled
  if (llmConfig.enabled && llmAvailable) {
    try {
      const prompt = buildLLMPrompt(query, evidence);
      const llmResponse = await queryLocalLLM(prompt);

      // Extract citations from response (look for IDs)
      const citations = extractCitations(llmResponse, evidence);

      return {
        text: llmResponse,
        citations,
        confidence: 0.8, // LLM responses have good confidence when available
        used_llm: true,
        evidence_insufficient: llmResponse.toLowerCase().includes("evidence insufficient"),
      };
    } catch (error) {
      console.warn("LLM query failed, using deterministic fallback:", error);
      // Fall through to deterministic response
    }
  }

  // Deterministic fallback
  return processDeterministicQuery(query, evidence);
}

/**
 * Extract IDs from LLM response for citations
 */
function extractCitations(response: string, evidence: EvidencePacket): string[] {
  const citations: string[] = [];
  
  // Look for account IDs
  const accountPattern = /ACC-[A-Z0-9]+/g;
  const accounts = response.match(accountPattern);
  if (accounts) {
    citations.push(...accounts.filter(id => evidence.account_ids.includes(id)));
  }
  
  // Look for transaction IDs
  const txnPattern = /TXN-[A-Z0-9]+/g;
  const txns = response.match(txnPattern);
  if (txns) {
    citations.push(...txns.filter(id => evidence.transaction_ids.includes(id)));
  }
  
  // Look for network IDs
  const netPattern = /NET-\d+/g;
  const nets = response.match(netPattern);
  if (nets) {
    citations.push(...nets.filter(id => id === evidence.network_id));
  }
  
  return [...new Set(citations)]; // Remove duplicates
}

/**
 * Deterministic query processing (fallback)
 */
function processDeterministicQuery(query: string, evidence: EvidencePacket): AIResponse {
  const lowerQuery = query.toLowerCase();
  let response = "";
  const citations: string[] = [];

  // Pattern-based deterministic responses
  if (lowerQuery.includes("suspicious") || lowerQuery.includes("risk")) {
    if (evidence.cluster_risk_score !== undefined) {
      response = `Based on the evidence, network ${evidence.network_id} has a risk score of ${evidence.cluster_risk_score}/100. `;
      response += `The patterns detected include: ${evidence.patterns.join(", ")}. `;
      response += `Key signals: ${evidence.signals.slice(0, 2).join("; ")}. `;
      response += `This indicates suspicious activity requiring investigation.`;
      citations.push(...evidence.account_ids.slice(0, 3));
      citations.push(...evidence.transaction_ids.slice(0, 3));
    } else {
      response = "Evidence insufficient to determine risk level for this query.";
    }
  } else if (lowerQuery.includes("amount") || lowerQuery.includes("money")) {
    const totalAmount = evidence.amounts.reduce((a, b) => a + b, 0);
    response = `Total transaction amount in evidence: ₹${totalAmount.toLocaleString()} across ${evidence.transaction_ids.length} transactions. `;
    response += `Individual amounts range from ₹${Math.min(...evidence.amounts).toLocaleString()} to ₹${Math.max(...evidence.amounts).toLocaleString()}.`;
    citations.push(...evidence.transaction_ids.slice(0, 5));
  } else if (lowerQuery.includes("account")) {
    response = `Evidence includes ${evidence.account_ids.length} accounts with risk scores: ${evidence.risk_scores.join(", ")}. `;
    response += `Account IDs: ${evidence.account_ids.slice(0, 5).join(", ")}${evidence.account_ids.length > 5 ? "..." : ""}.`;
    citations.push(...evidence.account_ids.slice(0, 5));
  } else if (lowerQuery.includes("pattern")) {
    response = `Detected patterns in evidence: ${evidence.patterns.join(", ") || "No specific patterns detected"}. `;
    response += `These patterns indicate suspicious transaction structures requiring further analysis.`;
    citations.push(evidence.network_id || "N/A");
  } else {
    response = "Evidence insufficient to answer this specific question. The available evidence contains transaction data, account information, and risk scores. Please ask about suspicious activity, amounts, accounts, or patterns.";
  }

  return {
    text: response,
    citations,
    confidence: 0.6, // Lower confidence for deterministic responses
    used_llm: false,
    evidence_insufficient: response.includes("Evidence insufficient"),
  };
}

/**
 * Get LLM status
 */
export function getLLMStatus(): { available: boolean; config: LLMConfig } {
  return {
    available: llmAvailable,
    config: llmConfig,
  };
}

/**
 * Initialize AI assistant
 */
export async function initializeAIAssistant(): Promise<void> {
  if (llmConfig.enabled) {
    await checkLLMAvailability();
  }
}
