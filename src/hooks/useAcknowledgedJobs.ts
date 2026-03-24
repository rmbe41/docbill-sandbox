import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "docbill:ackCompletedJobs:";

export function useAcknowledgedJobs(userId: string | undefined) {
  const storageKey = userId ? `${STORAGE_PREFIX}${userId}` : null;
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (!storageKey) {
      setIds([]);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      setIds(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setIds([]);
    }
  }, [storageKey]);

  const acknowledge = useCallback(
    (jobId: string) => {
      if (!storageKey) return;
      setIds((prev) => {
        if (prev.includes(jobId)) return prev;
        const next = [...prev, jobId];
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignore quota */
        }
        return next;
      });
    },
    [storageKey],
  );

  const acknowledgedSet = useMemo(() => new Set(ids), [ids]);

  return { acknowledgedSet, acknowledge };
}
