# TRACE Insight

Build TRACE (Transaction Risk Analysis & Crime Exploration) — a financial-crime investigation platform prototype. This is NOT a fraud/not-fraud classifier and NOT a payment app. It is an intelligence layer / investigation cockpit that helps analysts discover suspicious networks, trace money across accounts, understand behaviour, explain alerts, and build cases — with a signature Adversarial Fraud Simulator that continuously stress-tests the detection engine with evolving synthetic fraud scenarios.
Tagline: "One transaction can look normal. The network tells the truth."
Core product loop the whole UI should express: DETECT → CONNECT → TRACE → EXPLAIN → INVESTIGATE → LEARN → STRESS-TEST.
Visual identity & UI direction
Design this like a professional SOC/fraud-ops command center — think Palantir, Chainalysis Reactor, or a modern SIEM dashboard. Not a generic admin template.
Theme: Dark-mode-first "investigation cockpit" aesthetic — deep charcoal/near-black background (#0B0E14 range), with a single sharp accent color for risk/alert states (electric red-orange for critical, amber for medium, teal/cyan for safe/normal) and a cool blue or violet for interactive/AI elements.
Typography: A clean technical sans (Inter or similar) for UI chrome, and a monospace font (JetBrains Mono or similar) for transaction IDs, account IDs, amounts, timestamps, and hashes — this sells the "forensic tool" feel.
Graph/network views are the visual centerpiece — nodes glow subtly by risk level, edges show direction/thickness by transaction volume, suspicious clusters get a highlighted halo/border.
Use subtle motion: risk scores animate/count up, story-mode plays edges in sequence, alerts pulse gently when new/critical.
Data-dense but never cluttered — use cards, sparklines, badges, and collapsible panels rather than walls of text. Every risk score, pattern tag, and status should be a color-coded badge (Low/Medium/High/Critical).
Include empty states, loading skeletons, and toast notifications for actions (case created, scenario run, feedback saved).
Tech & data approach for this build
Since this is a prototype, implement it as a single React app with Supabase as the backend/database (use it for transactions, accounts, alerts, cases, scenarios, feedback tables). Seed the database with realistic synthetic data only — no real personal or financial data. Build a seed script/edge function that generates:
~150–300 synthetic accounts and ~1,000+ synthetic transactions
Several embedded fraud patterns: mule chains, fan-in, fan-out, circular transfers, rapid layering, dormant-account synchronized activation, and normal/legitimate high-value transactions
Fields per transaction: transaction_id, sender_id, receiver_id, amount, timestamp, transaction_type (UPI/bank/wallet), device_id, location_id, account_age_days, scenario_id, label (normal/suspicious)
Detection logic can be implemented as a rules + scoring engine (weighted signals, see scoring model below) computed client-side or in a Supabase edge function — it does not need real ML, but should feel data-driven and consistent, not random.
For the graph visualization, use React Flow or a force-directed graph library (e.g., react-force-graph or d3-force) — nodes = accounts, edges = transactions.
For the AI Investigation Assistant, wire up a real LLM call (via a Supabase edge function) that is grounded in the specific case's data (transactions, timeline, risk factors passed as context) — it should explain, summarize, and draft reports, but never declare guilt; always frame outputs as investigative support for a human decision-maker.
1. Pages / Site Structure
Build these as distinct routes with a persistent left sidebar nav (collapsible), top bar with global search + alert bell + user/analyst avatar:
Dashboard — Overview: active alerts count by severity, critical networks list, emerging clusters, detection statistics (precision/recall style KPIs, scenarios tested today, detection gaps found), a live-feed style "recent activity" panel, and a risk-heatmap or trend chart of alerts over time.
Alerts — Sortable/filterable queue of suspicious transactions/networks. Filters: time range, amount range, risk level, pattern type, status (New/Reviewing/Escalated/Resolved). Each row shows risk score badge, pattern tags, accounts involved, and a "Investigate" action.
Network Investigation — The centerpiece interactive graph screen. Accounts as nodes (sized/colored by risk), transactions as edges (labeled with amount, direction arrows). Side panel shows: cluster risk score, "Network DNA / Fraud Fingerprint" (velocity, layering, fan-in/out, circularity meters), central/mule/bridge account highlights, and filter controls (time, amount, risk, pattern). Clicking a node opens the Account Profile drawer.
Account Profile — Behaviour baseline vs current activity, transaction history, connections list, role in network (e.g., "bridge account"), risk score breakdown.
Money Tracer — Visual source → intermediary → destination flow across multiple hops, with amounts and timestamps at each hop, and total value traced.
Timeline — Chronological reconstruction of an incident's suspicious activity, scrubbable/scrollable, with event markers.
Explainability ("Why Flagged?") — Shows the risk score with a breakdown of contributing signals (behaviour deviation, velocity, new counterparties, network signals, pattern match, historical association) as a weighted bar/donut chart, plus plain-language reasons and linked evidence.
AI Investigation — Chat-style interface, scoped to the currently open case/network. Quick-action buttons: "Summarize incident," "Identify highest-risk account," "Explain money-flow path," "Draft investigation report," "Suggest next step." Responses should cite the specific evidence (transaction IDs, accounts, dates) they're grounded in.
Cases — List + detail view. Create a case directly from an alert; auto-attach graph snapshot, transactions, timeline, risk score, patterns, money path, and AI summary. Status pipeline: Open → Investigating → Escalated/Resolved. Human decision buttons: Confirmed Suspicious / False Positive / Needs Review, plus a feedback/notes field.
Detection Lab — The Adversarial Fraud Simulator control room (see section 3 below): scenario library, "Run Scenario" action, results feed (Detected/Missed), detection success rate over time, hardest scenario leaderboard, before/after performance comparison.
Reports — Generate/export an investigation summary (PDF-style preview in-app is fine) pulling from a resolved case: evidence, timeline, decision, and rationale.
2. Feature Detail by Module
Detection features (drive the scores you compute/display)
Transaction Risk Score (multi-signal, 0–100)
Behaviour Analysis (baseline vs deviation)
Anomaly Detection (unusual amount/timing/frequency/counterparty)
Fraud Pattern Engine — detect and label: mule chains, fan-in/fan-out, circular flow, rapid layering, multi-hop movement
Dormant Account Detection — flag accounts reactivating after long inactivity
Synchronized Activation — flag multiple dormant accounts activating together
Investigation features
Money Flow Tracer — multi-hop trace with amounts/timestamps
Timeline Reconstruction — full suspicious-activity sequence
Fraud Story Mode — an animated "play" button that steps through the network's formation over time (edges/nodes appear in chronological order with a scrub bar and play/pause)
What Changed? — side-by-side normal vs suspicious behaviour comparison for an account
What-If Simulator — let the investigator toggle off a node/edge and see the cluster risk score recalculate live
Why Flagged? — full evidence breakdown (see Explainability page)
Risk scoring model (use these as the illustrative weights)
SignalWeightBehaviour deviation25%Network signals25%Transaction velocity15%New counterparties15%Pattern match15%Historical association5%
Score bands: 0–29 Low (Monitor) · 30–59 Medium (Review if corroborated) · 60–79 High (Prioritise investigation) · 80–100 Critical (Immediate analyst review). Label these as prototype weights, not a real banking standard, somewhere in the UI (e.g., a tooltip).
3. Adversarial Fraud Simulator (Detection Lab) — signature feature, make this impressive
This is the differentiator — give it real presence in the UI, not an afterthought.
A library of scenario templates (fan-in, fan-out, circular transfer, mule chain, bridge account, dormant sync-activation, rapid layering, legitimate high-value control case)
"Generate & Run Scenario" button that: creates a synthetic transaction set → runs it through the detection engine → shows Detected ✅ or Missed (Detection Gap) ⚠️ with the resulting score and triggered signals
If detected: offer "Generate harder variation" (simulate parameter mutation — smaller amounts, longer time gaps, more intermediary accounts)
If missed: log it as a Detection Gap in a visible gap-tracking list
Dashboard tile within Detection Lab: scenarios tested, detection success rate (%), detection gaps found, hardest scenario (lowest detection rate), and a before/after performance chart showing detector improvement over simulation rounds
Frame this clearly in copy as "a controlled synthetic scenario generator for stress-testing," never as a real criminal AI
AI Investigation Assistant — guardrails to reflect in the product copy/UX
Always case/evidence-grounded (answers reference actual transaction IDs, accounts, timestamps from the open case)
Never states guilt or makes the final call — UI copy should reinforce "investigative support" framing (e.g., a small persistent note: "AI supports investigation. Final decisions are made by authorised analysts.")
4. Data Model (Supabase tables, suggested)
accounts (id, created_at, account_age_days, current_status, baseline_behaviour jsonb, risk_score, role_tag)
transactions (transaction_id, sender_id, receiver_id, amount, timestamp, transaction_type, device_id, location_id, scenario_id, label)
alerts (id, network_id, risk_score, level, pattern_tags[], status, created_at)
networks / clusters (id, member_account_ids[], cluster_risk_score, fingerprint jsonb)
cases (id, alert_id, status, decision, notes, attached_evidence jsonb, created_at, updated_at)
feedback (id, case_id, investigator_note, outcome)
scenarios (id, type, params jsonb, detected boolean, detection_gap boolean, run_at, generation number)
5. Judge/Demo-ready details worth including in the UI copy
Product positioning line somewhere visible (e.g., footer or about/info modal): "An intelligence layer that integrates with existing banking, UPI, wallet and payment systems — not a replacement payment app."
A subtle "Synthetic/Prototype Data" badge in the header so it's clear this is demo data, not real financial information.
Differentiator statement available in an About/Info panel: "Most fraud systems learn from yesterday's fraud. TRACE stress-tests its detection engine with evolving synthetic fraud scenarios to discover blind spots before they become real weaknesses."
6. Priority build order (build in this order so the demo works even if time runs out)
Dashboard + Alerts with seeded synthetic data
Interactive Network graph (React Flow) with at least 4 fraud patterns visibly detectable
Network/cluster risk score + Why Flagged explainability
Money Flow Tracer + Timeline
Case creation flow end-to-end (alert → case → decision → feedback)
AI Investigation Assistant (LLM-backed, case-grounded)
Detection Lab / Adversarial Simulator with at least one working scenario run
Reports export + visual polish pass
Build this as a cohesive, believably "real" investigation product — not a wireframe. Prioritize the graph screen, Detection Lab, and AI assistant as the three moments that should feel the most polished, since they're the core differentiators.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
