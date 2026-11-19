/** +values+ in slices of at most +size+, so one statement never binds more parameters than SQLite allows. */
export function chunked<T>(values: readonly T[], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) chunks.push(values.slice(start, start + size));
  return chunks;
}
