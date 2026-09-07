-- Ownership columns
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();
ALTER TABLE public.case_feedback ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();
ALTER TABLE public.scenario_runs ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

-- Drop permissive prototype policies
DROP POLICY IF EXISTS "Prototype open access to cases" ON public.cases;
DROP POLICY IF EXISTS "Prototype open access to case feedback" ON public.case_feedback;
DROP POLICY IF EXISTS "Prototype open access to scenario runs" ON public.scenario_runs;

-- Remove anonymous access
REVOKE ALL ON public.cases FROM anon;
REVOKE ALL ON public.case_feedback FROM anon;
REVOKE ALL ON public.scenario_runs FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_runs TO authenticated;
GRANT ALL ON public.cases TO service_role;
GRANT ALL ON public.case_feedback TO service_role;
GRANT ALL ON public.scenario_runs TO service_role;

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators manage their own cases" ON public.cases
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Investigators manage feedback on their own cases" ON public.case_feedback
  FOR ALL TO authenticated
  USING (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_feedback.case_id AND c.created_by = auth.uid()))
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_feedback.case_id AND c.created_by = auth.uid()));

CREATE POLICY "Investigators manage their own scenario runs" ON public.scenario_runs
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());