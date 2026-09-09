/**
 * ML Anomaly Detection Engine for TRACE-X
 * 
 * Implements a lightweight Isolation Forest algorithm for unsupervised anomaly detection.
 * This is a simplified version designed for client-side execution without heavy ML dependencies.
 * 
 * The ML layer identifies unusual transaction/account behaviour based on:
 * - Transaction amount patterns
 * - Transaction frequency/velocity
 * - Number of counterparties
 * - Incoming/outgoing ratio
 * - Transaction timing patterns
 * - Network degree
 * - Fan-in/fan-out behaviour
 */

import type { Account, Transaction } from "./engine";

export interface MLFeatureVector {
  // Transaction-level features
  amount: number;
  amount_log: number;
  hour_of_day: number;
  day_of_week: number;
  
  // Account-level features
  account_age_days: number;
  total_transactions: number;
  unique_counterparties: number;
  incoming_ratio: number;
  outgoing_ratio: number;
  avg_amount: number;
  amount_std: number;
  
  // Network features
  degree: number;
  in_degree: number;
  out_degree: number;
  clustering_coefficient: number;
}

export interface MLAnomalyScore {
  account_id: string;
  anomaly_score: number; // 0-100, higher = more anomalous
  feature_contributions: Record<string, number>;
  is_anomaly: boolean;
  confidence: number;
}

export interface MLModelStats {
  total_samples: number;
  anomaly_count: number;
  anomaly_rate: number;
  mean_score: number;
  std_score: number;
  threshold: number;
}

/**
 * Simplified Isolation Forest implementation
 * 
 * Isolation Forest works by randomly selecting a feature and split value,
 * then recursively partitioning the data. Anomalies are isolated faster (require fewer splits).
 */
class IsolationTree {
  private maxDepth: number;
  private depth: number;
  private splitFeature: number | null = null;
  private splitValue: number | null = null;
  private left: IsolationTree | null = null;
  private right: IsolationTree | null = null;
  private size: number;

  constructor(maxDepth: number, depth: number = 0) {
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.size = 0;
  }

  fit(data: number[][]): void {
    this.size = data.length;
    
    // Base cases: stop if max depth reached, single sample, or all identical
    if (this.depth >= this.maxDepth || this.size <= 1) {
      return;
    }

    // Check if all samples are identical
    const first = data[0];
    const allSame = data.every(row => 
      row.every((val, i) => Math.abs(val - first[i]) < 1e-10)
    );
    if (allSame) return;

    // Randomly select feature and split value
    const numFeatures = data[0].length;
    this.splitFeature = Math.floor(Math.random() * numFeatures);
    
    const featureValues = data.map(row => row[this.splitFeature!]);
    const minVal = Math.min(...featureValues);
    const maxVal = Math.max(...featureValues);
    
    if (minVal === maxVal) return; // Can't split this feature
    
    this.splitValue = minVal + Math.random() * (maxVal - minVal);

    // Partition data
    const leftData: number[][] = [];
    const rightData: number[][] = [];
    
    for (const row of data) {
      if (row[this.splitFeature!] < this.splitValue!) {
        leftData.push(row);
      } else {
        rightData.push(row);
      }
    }

    // Recursively build subtrees
    if (leftData.length > 0) {
      this.left = new IsolationTree(this.maxDepth, this.depth + 1);
      this.left.fit(leftData);
    }
    
    if (rightData.length > 0) {
      this.right = new IsolationTree(this.maxDepth, this.depth + 1);
      this.right.fit(rightData);
    }
  }

  pathLength(x: number[]): number {
    if (this.splitFeature === null || this.splitValue === null) {
      return this.depth + this.c(this.size);
    }

    if (x[this.splitFeature] < this.splitValue) {
      return this.left ? this.left.pathLength(x) : this.depth + this.c(this.size);
    } else {
      return this.right ? this.right.pathLength(x) : this.depth + this.c(this.size);
    }
  }

  // Average path length of unsuccessful search in BST
  private c(n: number): number {
    if (n <= 1) return 0;
    const H = Math.log(n) + 0.5772156649; // Euler's constant
    return 2 * H - (2 * (n - 1)) / n;
  }
}

export class IsolationForest {
  private trees: IsolationTree[] = [];
  private numTrees: number;
  private maxSamples: number;
  private maxDepth: number;
  private featureMean: number[] = [];
  private featureStd: number[] = [];

  constructor(numTrees: number = 100, maxSamples: number = 256) {
    this.numTrees = numTrees;
    this.maxSamples = maxSamples;
    this.maxDepth = Math.ceil(Math.log2(maxSamples));
  }

  fit(data: number[][]): void {
    if (data.length === 0) return;

    // Normalize features
    const numFeatures = data[0].length;
    this.featureMean = new Array(numFeatures).fill(0);
    this.featureStd = new Array(numFeatures).fill(1);

    for (let i = 0; i < numFeatures; i++) {
      const values = data.map(row => row[i]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      this.featureMean[i] = mean;
      this.featureStd[i] = Math.sqrt(variance) || 1;
    }

    // Normalize data
    const normalizedData = data.map(row => 
      row.map((val, i) => (val - this.featureMean[i]) / this.featureStd[i])
    );

    // Build trees
    this.trees = [];
    const sampleSize = Math.min(this.maxSamples, normalizedData.length);
    
    for (let i = 0; i < this.numTrees; i++) {
      // Bootstrap sample
      const indices = Array.from({ length: normalizedData.length }, (_, i) => i);
      const shuffled = indices.sort(() => Math.random() - 0.5);
      const sample = shuffled.slice(0, sampleSize).map(idx => normalizedData[idx]);
      
      const tree = new IsolationTree(this.maxDepth);
      tree.fit(sample);
      this.trees.push(tree);
    }
  }

  decisionFunction(x: number[]): number {
    if (this.trees.length === 0) return 0;

    // Normalize input
    const normalized = x.map((val, i) => 
      (val - this.featureMean[i]) / this.featureStd[i]
    );

    // Average path length across all trees
    let totalPathLength = 0;
    for (const tree of this.trees) {
      totalPathLength += tree.pathLength(normalized);
    }
    const avgPathLength = totalPathLength / this.trees.length;

    // Convert to anomaly score (0-1, higher = more anomalous)
    const c_n = this.c(this.maxSamples);
    const score = Math.pow(2, -avgPathLength / c_n);
    
    return score;
  }

  private c(n: number): number {
    if (n <= 1) return 0;
    const H = Math.log(n) + 0.5772156649;
    return 2 * H - (2 * (n - 1)) / n;
  }
}

/**
 * Extract ML features from transaction data
 */
export function extractFeatures(
  account: Account,
  transactions: Transaction[],
  allAccounts: Account[]
): MLFeatureVector {
  const accountTxns = transactions.filter(
    t => t.sender_id === account.id || t.receiver_id === account.id
  );

  const amounts = accountTxns.map(t => t.amount);
  const totalAmount = amounts.reduce((a, b) => a + b, 0);
  const avgAmount = amounts.length > 0 ? totalAmount / amounts.length : 0;
  const amountStd = amounts.length > 0 
    ? Math.sqrt(amounts.reduce((a, b) => a + (b - avgAmount) ** 2, 0) / amounts.length)
    : 0;

  const counterparties = new Set(
    accountTxns.map(t => t.sender_id === account.id ? t.receiver_id : t.sender_id)
  );

  const incoming = accountTxns.filter(t => t.receiver_id === account.id);
  const outgoing = accountTxns.filter(t => t.sender_id === account.id);
  const incomingAmount = incoming.reduce((a, b) => a + b.amount, 0);
  const outgoingAmount = outgoing.reduce((a, b) => a + b.amount, 0);
  const totalFlow = incomingAmount + outgoingAmount;

  // Network degree
  const degree = counterparties.size;
  const inDegree = new Set(incoming.map(t => t.sender_id)).size;
  const outDegree = new Set(outgoing.map(t => t.receiver_id)).size;

  // Clustering coefficient (simplified)
  let clusteringCoefficient = 0;
  if (degree > 1) {
    const neighborPairs = 0;
    const connectedPairs = 0;
    // Simplified: use degree as proxy
    clusteringCoefficient = Math.min(1, degree / 10);
  }

  // Timing features
  const timestamps = accountTxns.map(t => new Date(t.timestamp).getTime());
  const hours = timestamps.map(ts => new Date(ts).getHours());
  const days = timestamps.map(ts => new Date(ts).getDay());
  const avgHour = hours.length > 0 ? hours.reduce((a, b) => a + b, 0) / hours.length : 12;
  const avgDay = days.length > 0 ? days.reduce((a, b) => a + b, 0) / days.length : 3;

  return {
    // Transaction features
    amount: avgAmount,
    amount_log: Math.log(avgAmount + 1),
    hour_of_day: avgHour / 24,
    day_of_week: avgDay / 7,
    
    // Account features
    account_age_days: account.account_age_days,
    total_transactions: accountTxns.length,
    unique_counterparties: counterparties.size,
    incoming_ratio: totalFlow > 0 ? incomingAmount / totalFlow : 0.5,
    outgoing_ratio: totalFlow > 0 ? outgoingAmount / totalFlow : 0.5,
    avg_amount: avgAmount,
    amount_std: amountStd,
    
    // Network features
    degree,
    in_degree: inDegree,
    out_degree: outDegree,
    clustering_coefficient: clusteringCoefficient,
  };
}

/**
 * Train ML model and compute anomaly scores
 */
export function trainAndScore(
  accounts: Account[],
  transactions: Transaction[]
): {
  scores: MLAnomalyScore[];
  stats: MLModelStats;
  model: IsolationForest;
} {
  // Extract features for all accounts
  const featureVectors: number[][] = [];
  const accountMap = new Map<string, MLFeatureVector>();

  for (const account of accounts) {
    const features = extractFeatures(account, transactions, accounts);
    accountMap.set(account.id, features);
    featureVectors.push(Object.values(features));
  }

  // Train model
  const model = new IsolationForest(50, 128); // Fewer trees for performance
  model.fit(featureVectors);

  // Compute anomaly scores
  const scores: MLAnomalyScore[] = [];
  for (const account of accounts) {
    const features = accountMap.get(account.id)!;
    const featureArray = Object.values(features);
    const anomalyScore = model.decisionFunction(featureArray);
    
    // Convert to 0-100 scale
    const scaledScore = Math.round(anomalyScore * 100);

    // Feature contributions (simplified: use deviation from mean)
    const contributions: Record<string, number> = {};
    const featureNames = Object.keys(features);
    featureNames.forEach((name, i) => {
      const value = featureArray[i];
      const mean = (model as any).featureMean?.[i] || 0;
      const std = (model as any).featureStd?.[i] || 1;
      contributions[name] = Math.abs((value - mean) / std);
    });

    scores.push({
      account_id: account.id,
      anomaly_score: scaledScore,
      feature_contributions: contributions,
      is_anomaly: scaledScore > 60, // Threshold
      confidence: Math.min(1, scaledScore / 80),
    });
  }

  // Compute statistics
  const anomalyCount = scores.filter(s => s.is_anomaly).length;
  const meanScore = scores.reduce((a, b) => a + b.anomaly_score, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b.anomaly_score - meanScore) ** 2, 0) / scores.length;
  const stdScore = Math.sqrt(variance);

  const stats: MLModelStats = {
    total_samples: scores.length,
    anomaly_count: anomalyCount,
    anomaly_rate: anomalyCount / scores.length,
    mean_score,
    std_score: stdScore,
    threshold: 60,
  };

  return { scores, stats, model };
}

/**
 * Safe fallback when ML fails
 */
export function getFallbackMLScores(accounts: Account[]): MLAnomalyScore[] {
  return accounts.map(account => ({
    account_id: account.id,
    anomaly_score: Math.round(account.risk_score * 0.3), // Conservative fallback
    feature_contributions: {},
    is_anomaly: false,
    confidence: 0,
  }));
}
