// Minimal .xlsx reading for the one-time sheet imports: the file is a zip of XML, read with `unzip`
// (shipped with macOS and Linux). Formulas give their last calculated value.
import { execFileSync } from "node:child_process";

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Cell values of one tab by reference ("A5" → "KB_001"). */
export function readSheet(file: string, name: string) {
  const part = (p: string) => execFileSync("unzip", ["-p", file, p], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  const shared = [...part("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const rid = part("xl/workbook.xml").match(new RegExp(`<sheet [^>]*name="${name}"[^>]*r:id="(rId\\d+)"`))?.[1];
  const target =
    rid &&
    [...part("xl/_rels/workbook.xml.rels").matchAll(/<Relationship ([^>]*)\/>/g)]
      .map((m) => m[1])
      .find((a) => a.includes(`Id="${rid}"`))
      ?.match(/Target="([^"]+)"/)?.[1];
  if (!target) throw new Error(`No ${name} tab in this workbook`);
  const cells = new Map<string, string>();
  for (const m of part(`xl/${target.replace(/^\/?xl\//, "")}`).matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = m[1].match(/r="([A-Z]+\d+)"/)?.[1];
    const value = m[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (!ref || value == null) continue;
    cells.set(ref, / t="s"/.test(` ${m[1]}`) ? shared[Number(value)] : unescape(value));
  }
  const at = (col: string, row: number) => cells.get(`${col}${row}`)?.trim() ?? "";
  return { at, number: (col: string, row: number) => Number(at(col, row)) || 0 };
}

/** Excel's day number (46166) → "2026-05-24". */
export const excelDate = (serial: number) => new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
