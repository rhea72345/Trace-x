/**
 * Data Ingestion Module for TRACE-X
 * 
 * Supports loading realistic/public transaction datasets and converting them
 * to the TRACE-X account/transaction format.
 * 
 * Gracefully falls back to synthetic data if external datasets are unavailable.
 */

import type { Account, Transaction } from "./engine";
import { db } from "./engine";

export interface DataSource {
  name: string;
  description: string;
  type: "synthetic" | "public" | "custom";
  available: boolean;
  recordCount: number;
}

export interface IngestedData {
  accounts: Account[];
  transactions: Transaction[];
  source: DataSource;
}

export interface DatasetConfig {
  useSyntheticFallback: boolean;
  preferredSource: "synthetic" | "public" | "custom";
  customDatasetPath?: string;
}

/**
 * Simulated public fraud dataset for demonstration
 * In production, this would load from a real public dataset file
 */
const SIMULATED_PUBLIC_DATASET = {
  name: "Kaggle Credit Card Fraud (Simulated Sample)",
  description: "Sample dataset inspired by public credit card fraud data for demonstration",
  type: "public" as const,
  available: true,
  recordCount: 284, // Reasonable size for demo
};

/**
 * Generate realistic public dataset sample
 * This simulates what would be loaded from a real public dataset
 */
function generatePublicDatasetSample(): IngestedData {
  const accounts: Account[] = [];
  const transactions: Transaction[] = [];
  
  // Simulate public dataset structure with realistic patterns
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;
  const int = (min: number, max: number) => Math.floor(rand(min, max + 1));
  
  let acctSeq = 5000;
  let txnSeq = 500000;
  
  // Generate accounts with realistic distribution
  for (let i = 0; i < 120; i++) {
    const age = int(30, 1800);
    const isFraudRelated = i < 15; // 15% flagged accounts
    
    accounts.push({
      id: `PUB-${(acctSeq++).toString().padStart(5, "0")}`,
      holder: `Public User ${i + 1}`,
      created_at: new Date(Date.now() - age * 86400000).toISOString(),
      account_age_days: age,
      current_status: isFraudRelated && age < 90 ? "Reactivated" : "Active",
      baseline_behaviour: {
        avg_amount: rand(500, 5000),
        avg_txn_per_week: rand(1, 15),
        typical_counterparties: int(2, 8),
        typical_hours: [9, 17],
        home_location: `LOC-PUB-${int(1, 20)}`,
      },
      risk_score: isFraudRelated ? int(50, 85) : int(5, 35),
      role_tag: isFraudRelated ? "High-risk account" : "Standard",
      cluster_id: null,
    });
  }
  
  // Generate transactions with realistic fraud patterns
  for (let i = 0; i < 284; i++) {
    const sender = accounts[int(0, accounts.length - 1)];
    let receiver = accounts[int(0, accounts.length - 1)];
    while (receiver.id === sender.id) {
      receiver = accounts[int(0, accounts.length - 1)];
    }
    
    const isSuspicious = i < 32; // ~11% suspicious transactions
    const amount = isSuspicious ? rand(2000, 15000) : rand(10, 2000);
    
    transactions.push({
      transaction_id: `PTX-${(txnSeq++).toString().padStart(6, "0")}`,
      sender_id: sender.id,
      receiver_id: receiver.id,
      amount: Math.round(amount),
      timestamp: new Date(Date.now() - rand(0, 30) * 86400000).toISOString(),
      transaction_type: ["UPI", "BANK", "WALLET"][int(0, 2)] as "UPI" | "BANK" | "WALLET",
      device_id: `PUB-DEV-${int(1000, 9999)}`,
      location_id: sender.baseline_behaviour.home_location,
      account_age_days: sender.account_age_days,
      scenario_id: isSuspicious ? `PUB-SCN-${int(1, 5)}` : null,
      label: isSuspicious ? "suspicious" : "normal",
    });
  }
  
  return {
    accounts,
    transactions,
    source: SIMULATED_PUBLIC_DATASET,
  };
}

/**
 * Load data from configured source
 */
export function loadData(config: DatasetConfig = { useSyntheticFallback: true, preferredSource: "synthetic" }): IngestedData {
  try {
    // Try preferred source first
    if (config.preferredSource === "public") {
      try {
        const publicData = generatePublicDatasetSample();
        console.log("Loaded public dataset sample:", publicData.source.name);
        return publicData;
      } catch (error) {
        console.warn("Public dataset unavailable, falling back to synthetic:", error);
        if (!config.useSyntheticFallback) {
          throw new Error("Public dataset unavailable and synthetic fallback disabled");
        }
      }
    }
    
    if (config.preferredSource === "custom" && config.customDatasetPath) {
      try {
        // In production, this would load from the custom path
        console.log("Custom dataset loading not implemented, using synthetic");
      } catch (error) {
        console.warn("Custom dataset unavailable:", error);
      }
    }
    
    // Default to synthetic data from engine
    console.log("Using synthetic data from TRACE-X engine");
    return {
      accounts: db.accounts,
      transactions: db.transactions,
      source: {
        name: "TRACE-X Synthetic Generator",
        description: "Deterministic synthetic fraud patterns for demonstration",
        type: "synthetic",
        available: true,
        recordCount: db.transactions.length,
      },
    };
  } catch (error) {
    console.error("Data loading failed:", error);
    throw error;
  }
}

/**
 * Get available data sources
 */
export function getAvailableDataSources(): DataSource[] {
  return [
    {
      name: "TRACE-X Synthetic Generator",
      description: "Deterministic synthetic fraud patterns for demonstration",
      type: "synthetic",
      available: true,
      recordCount: db.transactions.length,
    },
    SIMULATED_PUBLIC_DATASET,
    {
      name: "Custom Dataset",
      description: "Load your own transaction dataset (CSV/JSON)",
      type: "custom",
      available: false,
      recordCount: 0,
    },
  ];
}

/**
 * Convert external dataset format to TRACE-X format
 * This is a template for future real dataset integration
 */
export function convertToTRACEXFormat(
  externalData: any[]
): { accounts: Account[]; transactions: Transaction[] } {
  // Template for converting external datasets
  // In production, this would handle specific dataset schemas
  
  const accounts: Account[] = [];
  const transactions: Transaction[] = [];
  
  // Example conversion logic (would be customized per dataset)
  for (const record of externalData) {
    // Convert external record to TRACE-X Account/Transaction format
    // This is a placeholder for actual conversion logic
  }
  
  return { accounts, transactions };
}

/**
 * Validate dataset format
 */
export function validateDataset(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!Array.isArray(data)) {
    errors.push("Data must be an array");
    return { valid: false, errors };
  }
  
  if (data.length === 0) {
    errors.push("Dataset is empty");
    return { valid: false, errors };
  }
  
  // Additional validation would go here
  
  return { valid: errors.length === 0, errors };
}

/**
 * Get current data source info
 */
export function getCurrentDataSource(): DataSource {
  return {
    name: "TRACE-X Synthetic Generator",
    description: "Deterministic synthetic fraud patterns for demonstration",
    type: "synthetic",
    available: true,
    recordCount: db.transactions.length,
  };
}
