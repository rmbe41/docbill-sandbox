import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatSandboxDateEuropean, parseSandboxDateToIso } from "@/lib/sandbox/europeanDate";

export type SandboxEuropeanDateInputProps = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (iso: string) => void;
};

export function SandboxEuropeanDateInput({
  value,
  onValueChange,
  className,
  onFocus,
  onBlur,
  ...rest
}: SandboxEuropeanDateInputProps) {
  const [text, setText] = useState(() => formatSandboxDateEuropean(value || undefined, { emptyLabel: "" }));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setText(formatSandboxDateEuropean(value || undefined, { emptyLabel: "" }));
    }
  }, [value]);

  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="TT/MM/JJJJ"
      className={cn("tabular-nums", className)}
      value={text}
      onFocus={(e) => {
        focusedRef.current = true;
        setText(formatSandboxDateEuropean(value || undefined, { emptyLabel: "" }));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        const iso = parseSandboxDateToIso(text);
        if (iso) {
          onValueChange(iso);
          setText(formatSandboxDateEuropean(iso, { emptyLabel: "" }));
        } else if (!text.trim()) {
          onValueChange("");
          setText("");
        } else {
          setText(formatSandboxDateEuropean(value || undefined, { emptyLabel: "" }));
        }
        onBlur?.(e);
      }}
      onChange={(e) => setText(e.target.value)}
    />
  );
}
