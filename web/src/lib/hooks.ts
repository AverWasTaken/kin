import { useRef } from "react";

/** Remembers the last non-null value, so a sheet keeps its content while it animates closed. */
export function useLastDefined<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(null);
  if (value != null) ref.current = value;
  return value ?? ref.current;
}
