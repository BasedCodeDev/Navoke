import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toneClassNames } from "./themes";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return toneClassNames.success;
    case "running":
      return toneClassNames.info;
    case "pausing":
    case "waiting_manual":
      return toneClassNames.warning;
    case "failed":
      return toneClassNames.danger;
    case "cancelled":
      return toneClassNames.neutral;
    default:
      return toneClassNames.neutral;
  }
}
