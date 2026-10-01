/**
 * Reads provider keys for the bake-off without a new dependency. `vite` is not a declared dependency
 * and `vitest/config` does not export `loadEnv`, so the vitest config reads `.env.local` with node:fs
 * and hands the text to these two pure functions. Nothing here prints anything.
 */

/** `KEY=VALUE` lines, `#` comments, optional single or double quotes. Later lines win. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      // An unquoted value ends at an inline comment.
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

const BAKE_OFF_PREFIXES = ["GEMINI_", "GROQ_"] as const;

/** Only GEMINI_* and GROQ_* variables are kept (nothing else from .env.local is needed or passed on); the real process environment wins. */
export function loadBakeOffEnv(fileText: string | null, processEnv: Record<string, string | undefined>): Record<string, string> {
  const merged: Record<string, string> = {};
  const fromFile = fileText ? parseEnvFile(fileText) : {};
  for (const [key, value] of Object.entries(fromFile)) {
    if (BAKE_OFF_PREFIXES.some((p) => key.startsWith(p))) merged[key] = value;
  }
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined && BAKE_OFF_PREFIXES.some((p) => key.startsWith(p))) merged[key] = value;
  }
  return merged;
}
