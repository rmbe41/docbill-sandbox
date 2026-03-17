import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface PraxisStammdaten {
  praxis?: { name?: string; adresse?: string; telefon?: string; email?: string; steuernummer?: string };
  bank?: { iban?: string; bic?: string; bankName?: string; kontoinhaber?: string };
}

export function usePraxisStammdaten() {
  const { user } = useAuth();
  const [data, setData] = useState<PraxisStammdaten | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: uData } = await supabase
      .from("user_settings")
      .select("praxis_stammdaten")
      .eq("user_id", user.id)
      .maybeSingle();
    const ps = (uData as { praxis_stammdaten?: PraxisStammdaten } | null)?.praxis_stammdaten;
    setData(ps && typeof ps === "object" ? ps : null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { praxisStammdaten: data, loading, refetch };
}
