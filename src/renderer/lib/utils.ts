import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
      return "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-200";
    case "running":
      return "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-200";
    case "waiting_manual":
      return "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-200";
    case "failed":
      return "border-red-200 bg-red-100 text-red-800 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-200";
    case "cancelled":
      return "border-slate-300 bg-slate-200 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  }
}
