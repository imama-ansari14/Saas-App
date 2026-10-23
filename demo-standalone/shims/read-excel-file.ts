// The standalone demo loads read-excel-file from jsDelivr as the readXlsxFile global.
export const readSheet = (file: File) =>
  (globalThis as unknown as { readXlsxFile: (f: File) => Promise<unknown[][]> }).readXlsxFile(file);
