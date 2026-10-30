export type PageResult<T> = { data: T[] | null; error?: { message?: string } | null };
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>,
  pageSize = 500,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("pageSize must be an integer between 1 and 1000");
  }
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(String(error.message || "Unable to read paginated audit rows"));
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    if (rows.length > 100000) throw new Error("Paginated audit read exceeded the safety limit of 100,000 rows");
  }
}
