export type CopyOutcome = "idle" | "copied" | "failed";

/** Copies exactly the supplied text; clipboard errors never enter diagnostics. */
export async function copyText(text: string): Promise<Exclude<CopyOutcome, "idle">> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
