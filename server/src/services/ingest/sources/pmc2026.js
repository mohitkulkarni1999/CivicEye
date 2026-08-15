/**
 * PMC 2026 ward-wise winners.
 *
 * Source: Pune Municipal Corporation election results published by the
 * Maharashtra State Election Commission, mirrored as an open CSV by opencity.in
 * (https://data.opencity.in/dataset/pmc-election-results-2026).
 *
 * Columns: Ward No., Ward Name, Seat, Reservation, Elected Candidate Name, Party
 * Seats A/B/C/D carry reservation categories (SC/ST/OBC/General, + Women).
 */
export const PMC2026 = {
  id: 'pmc_2026',
  label: 'Pune Municipal Corporation — 2026 ward-wise winners (official SEC data via opencity.in)',
  corporationCode: 'PMC',
  corporationName: 'Pune Municipal Corporation',
  city: 'Pune',
  designation: 'Nagar Sevak (Corporator)',
  dataSource: 'pmc_2026_opencity',
  sourceUrl: 'https://data.opencity.in/dataset/pmc-election-results-2026',
  sourceCodeForWard: 'official_gazette',
  csvUrl:
    'https://data.opencity.in/dataset/bab43521-68f4-4909-a9c0-7dac9bf164f2/resource/ac74e3a3-0fce-4ce5-bcdf-b3b6271ae722/download/pmc-election-results.csv',

  async fetchCsv() {
    const res = await fetch(this.csvUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`PMC 2026 CSV fetch failed: HTTP ${res.status}`);
    return res.text();
  },

  /**
   * Map generic header-keyed CSV rows (keys lowercased with spaces) into ingest
   * rows. Override point per source: adjust to the source's column layout.
   */
  mapRows(rows) {
    return rows.map((r) => ({
      wardNumber: String(r['ward no'] ?? '').trim(),
      wardName: (r['ward name'] ?? '').trim(),
      seat: (r['seat'] ?? '').trim(),
      reservation: (r['reservation'] ?? '').trim(),
      name: (r['elected candidate name'] ?? '').trim(),
      party: (r['party'] ?? '').trim(),
    }));
  },

  constituencyFor(wardNumber, wardName, seat) {
    const base = `Ward ${wardNumber}${wardName ? ` (${wardName})` : ''}`;
    return seat ? `${base} — Seat ${seat}` : base;
  },
};
