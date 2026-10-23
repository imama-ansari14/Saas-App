// Reads an uploaded File into rows of cells in the browser. CSV goes through Papa Parse and XLSX
// through read-excel-file. The standalone demo loads both from a CDN as globals; the app bundles them.

export async function readTable(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase();
  const g = globalThis as unknown as {
    readXlsxFile?: (f: File) => Promise<unknown[][]>;
    Papa?: { parse: (t: string, o: object) => { data: unknown[][] } };
  };
  if (name.endsWith(".xlsx")) {
    if (g.readXlsxFile) return g.readXlsxFile(file);
    const m = await import("read-excel-file/browser");
    return (await m.readSheet(file)) as unknown as unknown[][];
  }
  if (name.endsWith(".xls")) {
    throw new Error("Old .xls files are not supported. Save the file as .xlsx or .csv and try again.");
  }
  const text = (await readText(file)).replace(/^\uFEFF/, "");
  const Papa = g.Papa ?? (await import("papaparse")).default;
  return Papa.parse(text, { skipEmptyLines: true }).data as unknown[][];
}

/** File.text() with a FileReader fallback for older browsers. */
function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("Could not read this file."));
    r.readAsText(file);
  });
}
