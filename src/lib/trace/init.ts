/**
 * TRACE-X Initialization Module
 * 
 * Initializes all enhanced detection components with graceful fallbacks:
 * - ML anomaly detection engine
 * - Hybrid risk scoring
 * - AI assistant with local LLM
 * - Data ingestion
 */

import { initializeMLEngine, isMLEngineAvailable } from "./hybrid-engine";
import { initializeAIAssistant } from "./ai-assistant";
import { loadData } from "./data-ingestion";

export interface InitStatus {
  ml_engine: boolean;
  ai_assistant: boolean;
  data_source: string;
  hybrid_scoring: boolean;
  errors: string[];
}

/**
 * Initialize all TRACE-X enhanced components
 */
export async function initializeTRACEX(): Promise<InitStatus> {
  const status: InitStatus = {
    ml_engine: false,
    ai_assistant: false,
    data_source: "synthetic",
    hybrid_scoring: false,
    errors: [],
  };

  // Initialize ML engine
  try {
    const mlSuccess = initializeMLEngine();
    status.ml_engine = mlSuccess;
    if (!mlSuccess) {
      status.errors.push("ML engine initialized in fallback mode");
    }
  } catch (error) {
    status.errors.push(`ML engine initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // Initialize AI assistant
  try {
    await initializeAIAssistant();
    status.ai_assistant = true;
  } catch (error) {
    status.errors.push(`AI assistant initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // Load data source
  try {
    const data = loadData({ useSyntheticFallback: true, preferredSource: "synthetic" });
    status.data_source = data.source.type;
  } catch (error) {
    status.errors.push(`Data loading failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // Hybrid scoring depends on ML engine
  status.hybrid_scoring = isMLEngineAvailable();

  console.log("TRACE-X Initialization Status:", status);
  return status;
}

/**
 * Get current initialization status
 */
export function getInitStatus(): InitStatus {
  return {
    ml_engine: isMLEngineAvailable(),
    ai_assistant: true, // AI assistant always available (has fallback)
    data_source: "synthetic",
    hybrid_scoring: isMLEngineAvailable(),
    errors: [],
  };
}
