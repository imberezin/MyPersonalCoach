import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The owner's real account is sacred: opening Home, the First Week summary or the experiment page must never write
// a pattern, evidence, experiment or event row, and must never call a provider. The database grants `authenticated`
// insert/update/delete on those tables, so the only guard is in the code: these files are scanned for a write call,
// the admin client, an analytics `track(` and the AI layer. (Every write sits behind a button, in a server action.)
const READ_PATHS = [
  "src/lib/home/load.ts",
  "src/lib/patterns/load.ts",
  "src/lib/firstWeek/load.ts",
  "src/app/(app)/page.tsx",
  "src/app/(flow)/first-week/page.tsx",
  "src/app/(flow)/first-week/experiment/page.tsx",
  "src/app/(app)/_components/HomeView.tsx",
];

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "a database write or rpc call", pattern: /\.(insert|update|upsert|delete|rpc)\(/ },
  { name: "the admin client", pattern: /createAdminClient|supabase\/admin/ },
  { name: "an analytics track call", pattern: /\btrack\(/ },
  { name: "the AI layer", pattern: /lib\/ai/ },
];

describe("the read paths of Home and the First Week pages write nothing", () => {
  for (const file of READ_PATHS) {
    const text = readFileSync(join(process.cwd(), file), "utf8");

    it(`${file} is not empty (so the scan can fail)`, () => {
      expect(text.length).toBeGreaterThan(200);
    });

    for (const { name, pattern } of FORBIDDEN) {
      it(`${file} contains no ${name}`, () => {
        expect(text).not.toMatch(pattern);
      });
    }
  }
});
