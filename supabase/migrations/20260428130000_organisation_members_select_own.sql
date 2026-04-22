-- Eigene organisation_members-Zeile immer lesbar (user_id = auth.uid()).
-- Die Policy organisation_members_select_same_org referenziert dieselbe Tabelle
-- unter RLS; ohne diese Ergänzung kann die erste Mitgliedschaftszeile für
-- manche Clients leer bleiben → canWriteBatches false, obwohl Rolle admin ist.

CREATE POLICY "organisation_members_select_own"
  ON public.organisation_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
