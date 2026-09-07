CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id text,
  network_id text,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  decision text,
  notes text,
  risk_score integer NOT NULL DEFAULT 0,
  pattern_tags text[] NOT NULL DEFAULT '{}',
  attached_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO anon, authenticated;
GRANT ALL ON public.cases TO service_role;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Prototype open access to cases" ON public.cases FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.case_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  investigator_note text,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_feedback TO anon, authenticated;
GRANT ALL ON public.case_feedback TO service_role;
ALTER TABLE public.case_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Prototype open access to case feedback" ON public.case_feedback FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.scenario_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_type text NOT NULL,
  label text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected boolean NOT NULL DEFAULT false,
  detection_gap boolean NOT NULL DEFAULT false,
  score integer NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation integer NOT NULL DEFAULT 1,
  run_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_runs TO anon, authenticated;
GRANT ALL ON public.scenario_runs TO service_role;
ALTER TABLE public.scenario_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Prototype open access to scenario runs" ON public.scenario_runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.trace_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER cases_touch_updated_at BEFORE UPDATE ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.trace_touch_updated_at();