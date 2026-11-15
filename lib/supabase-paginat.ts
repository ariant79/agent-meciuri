const MARIME_PAGINA = 1000; // PostgREST limitează implicit select-urile la 1000 de rânduri

/** paginează orice query Supabase ca să luăm toate rândurile, nu doar primele 1000 */
export async function fetchToateRanduri<T>(
  construieste: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const toate: T[] = [];
  let start = 0;
  while (true) {
    const { data, error } = await construieste(start, start + MARIME_PAGINA - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    toate.push(...data);
    if (data.length < MARIME_PAGINA) break;
    start += MARIME_PAGINA;
  }
  return toate;
}
