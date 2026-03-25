import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from "react";

interface DraftState {
  text: string;
  setText: (text: string) => void;
  files: File[];
  addFiles: (files: File[]) => void;
  removeFile: (index: number) => void;
  clearFiles: () => void;
  clearDraft: () => void;
}

const DraftContext = createContext<DraftState | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const addFiles = useCallback((newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
  }, []);

  const clearDraft = useCallback(() => {
    setText("");
    setFiles([]);
  }, []);

  return (
    <DraftContext.Provider
      value={{ text, setText, files, addFiles, removeFile, clearFiles, clearDraft }}
    >
      {children}
    </DraftContext.Provider>
  );
}

export function useDraft(): DraftState {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraft must be used within DraftProvider");
  return ctx;
}
