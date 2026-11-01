/**
 * Loads the India Post "All India Pincode Directory" CSV (free open data from data.gov.in) into
 * pincode_directory. Safe to re-run: rows are upserted.
 *
 *   DATABASE_URL=... npm run db:import-pincodes -- ./pincode-directory.csv
 *
 * Expected columns (case-insensitive): officename, pincode, officetype, delivery, district, statename.
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const titleCase = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function toRows(csv: string[][]) {
  const head = csv[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const col = (...names: string[]) => { const i = head.findIndex((h) => names.includes(h)); if (i < 0) throw new Error(`CSV is missing a column: ${names[0]}`); return i; };
  const ix = { name: col('officename'), pin: col('pincode'), type: col('officetype'), delivery: col('delivery', 'deliverystatus'), district: col('district', 'districtname'), state: col('statename', 'state') };
  const out = new Map<string, { pin: string; name: string; type: string; delivery: boolean; district: string; state: string }>();
  for (const r of csv.slice(1)) {
    const pin = (r[ix.pin] ?? '').trim();
    if (!/^[1-9][0-9]{5}$/.test(pin)) continue;
    const name = titleCase((r[ix.name] ?? '').replace(/[\s,]+(B\.?O|S\.?O|H\.?O)\.?$/i, '').replace(/[\s,.]+$/, ''));
    if (!name) continue;
    out.set(`${pin}|${name}`, { pin, name, type: (r[ix.type] ?? '').trim().toUpperCase(), delivery: !/non/i.test(r[ix.delivery] ?? ''), district: titleCase(r[ix.district] ?? ''), state: titleCase(r[ix.state] ?? '') });
  }
  return [...out.values()];
}

async function main() {
  const file = process.argv[2];
  if (!file || !process.env.DATABASE_URL) throw new Error('Usage: DATABASE_URL=... npm run db:import-pincodes -- <csv file>');
  const rows = toRows(parseCsv(readFileSync(file, 'utf8')));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const vals: unknown[] = [];
      const ph = batch.map((r, k) => { vals.push(r.pin, r.name, r.type || null, r.delivery, r.district, r.state); const b = k * 6; return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`; });
      await pool.query(`insert into pincode_directory (pin, office_name, office_type, delivery, district, state) values ${ph.join(',')}
        on conflict (pin, office_name) do update set office_type = excluded.office_type, delivery = excluded.delivery, district = excluded.district, state = excluded.state, updated_at = now()`, vals);
    }
    const pins = new Set(rows.map((r) => r.pin)).size;
    console.log(`Imported ${rows.length} post offices covering ${pins} PIN codes.`);
  } finally { await pool.end(); }
}

if (process.argv[1]?.endsWith('import-pincodes.ts')) main().catch((e) => { console.error(e.message); process.exit(1); });
