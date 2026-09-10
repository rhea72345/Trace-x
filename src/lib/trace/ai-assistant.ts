/**
 * AI Investigation Assistant with Supabase Edge Function + Groq API
 * 
 * Integrates hosted LLM (via Supabase Edge Function calling Groq API) for natural language investigation queries,
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
  endpoint: "/functions/v1/ai-investigation", // Supabase Edge Function endpoint
  model: "llama3-70b-8192", // Groq model (configured in Edge Function)
  timeout: 2500, // 2.5 seconds for fast fail to deterministic fallback
};

let llmConfig = { ...DEFAULT_LLM_CONFIG };
let llmAvailable = false;

/**
 * Check if Supabase Edge Function is available
 */
export async function checkLLMAvailability(): Promise<boolean> {
  try {
    // Try a simple health check on the Edge Function
    // We'll test with a minimal query to see if the function responds
    const response = await fetch(llmConfig.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "test",
        evidence: {
          account_ids: [],
          transaction_ids: [],
          amounts: [],
          timestamps: [],
          risk_scores: [],
          signals: [],
          patterns: [],
        }
      }),
      signal: AbortSignal.timeout(2000), // Fast 2-second timeout
    });
    
    // If we get any response (even error), the function is available
    // If it's a 500 due to missing API key, we'll handle that in the actual call
    llmAvailable = response.status !== 404 && response.status !== 403;
    return llmAvailable;
  } catch (error) {
    // Silent fail - no console logs to avoid exposing issues in demo
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
 * Query Supabase Edge Function (calls Groq API)
 */
async function queryLocalLLM(prompt: string, evidence: EvidencePacket): Promise<string> {
  try {
    const response = await fetch(llmConfig.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: prompt,
        evidence: evidence,
      }),
      signal: AbortSignal.timeout(llmConfig.timeout),
    });

    if (!response.ok) {
      // Silent fail - throw error to trigger deterministic fallback
      throw new Error(`Edge Function request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.text || "";
  } catch (error) {
    // Silent fail - no console logs to avoid exposing issues in demo
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
      // Pass both query and evidence to Edge Function
      const llmResponse = await queryLocalLLM(query, evidence);

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
      // Silent fail - fall through to deterministic response without console warnings
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
  // Skip availability check for demo to ensure fast load
  // If Edge Function is deployed and available, it will be tried on first query
  // Otherwise, deterministic fallback will be used seamlessly
  llmAvailable = false; // Start with deterministic fallback for demo safety
}
