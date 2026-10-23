import Papa from "papaparse";
import { parseCourierMatrix, type ParsedCourierFile } from "./matrix";

export { detectColumns, parseCourierMatrix, type ParsedCourierFile } from "./matrix";

export function parseCourierCsv(text: string, courier: string): ParsedCourierFile {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true });
  return parseCourierMatrix(res.data as unknown[][], courier);
}

export async function parseCourierFile(buf: Buffer, filename: string, courier: string): Promise<ParsedCourierFile> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/node");
    const rows = (await readSheet(buf)) as unknown as unknown[][];
    return parseCourierMatrix(rows, courier);
  }
  if (lower.endsWith(".xls")) {
    return {
      parcels: [],
      headers: [],
      columns: {},
      rows: 0,
      skipped: 0,
      error: "Old .xls files are not supported. Open the file and save it as .xlsx or .csv, then upload again.",
    };
  }
  return parseCourierCsv(buf.toString("utf8"), courier);
}
