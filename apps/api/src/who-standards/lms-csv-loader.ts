import { Logger } from '@nestjs/common';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { Gender, WhoIndicator, type LmsRow } from '@app/shared';

/**
 * Maps the leading `<xAxis>_<yAxis>` segment of a CSV filename to the
 * indicator the row contributes to. The user's filename schema is:
 *
 *   <xAxis>_<yAxis>_<initialMonthOfChart>_<lastMonthOfChart>.csv
 *
 * For weight-for-stature the trailing numbers are stature in cm rather
 * than months — the loader does not care, it just reads the numeric x
 * value from the second CSV column.
 */
const PREFIX_TO_INDICATOR: Record<string, WhoIndicator> = {
  // height/length-for-age (CDC infant length and child stature both
  // serialize into a single chart in this app).
  h_a: WhoIndicator.HEIGHT_FOR_AGE,
  l_a: WhoIndicator.HEIGHT_FOR_AGE,
  // weight-for-age
  w_a: WhoIndicator.WEIGHT_FOR_AGE,
  // weight-for-stature (x is height in cm)
  w_h: WhoIndicator.WEIGHT_FOR_HEIGHT,
  w_l: WhoIndicator.WEIGHT_FOR_HEIGHT,
  // bmi-for-age
  b_a: WhoIndicator.BMI_FOR_AGE,
  // head-circumference-for-age (no consumer wired up yet; loaded so it
  // shows in /who-standards if the UI ever asks for it)
  hc_a: WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE,
};

const SEX_TO_GENDER: Record<string, Gender> = {
  '1': Gender.MALE,
  '2': Gender.FEMALE,
};

interface RowWithIndicator extends LmsRow {}

export interface LmsLoadResult {
  rows: RowWithIndicator[];
  filesLoaded: string[];
  filesSkipped: string[];
}

/**
 * Read every `*.csv` in `dir` that matches the file-naming convention
 * and return parsed LMS rows. Order within an indicator/gender is not
 * guaranteed; the consumer sorts by xValue when needed.
 */
export function loadLmsCsvDir(dir: string, logger?: Logger): LmsLoadResult {
  const absDir = resolve(dir);
  const result: LmsLoadResult = { rows: [], filesLoaded: [], filesSkipped: [] };
  const entries = readdirSync(absDir);
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.csv')) {
      continue;
    }
    const stem = entry.slice(0, -4);
    const parts = stem.split('_');
    if (parts.length < 4) {
      logger?.warn(`Skipping CSV with unrecognised name: ${entry}`);
      result.filesSkipped.push(entry);
      continue;
    }
    const prefix = `${parts[0]}_${parts[1]}`;
    const indicator = PREFIX_TO_INDICATOR[prefix];
    if (!indicator) {
      logger?.warn(`Skipping CSV with unknown indicator prefix '${prefix}': ${entry}`);
      result.filesSkipped.push(entry);
      continue;
    }
    const text = readFileSync(join(absDir, entry), 'utf8');
    const parsed = parseCsv(text);
    if (parsed.rows.length === 0) {
      logger?.warn(`Skipping empty CSV: ${entry}`);
      result.filesSkipped.push(entry);
      continue;
    }
    const headers = parsed.header.map((h) => h.toLowerCase());
    const sexIdx = findHeader(headers, ['sex']);
    const xIdx = findHeader(headers, ['x', 'agemos', 'length', 'height', 'stature']);
    const lIdx = findHeader(headers, ['l']);
    const mIdx = findHeader(headers, ['m']);
    const sIdx = findHeader(headers, ['s']);
    if ([sexIdx, xIdx, lIdx, mIdx, sIdx].some((i) => i < 0)) {
      logger?.warn(
        `Skipping CSV ${entry}: required columns Sex/X/L/M/S not all present (found ${parsed.header.join(',')})`,
      );
      result.filesSkipped.push(entry);
      continue;
    }
    let added = 0;
    for (const row of parsed.rows) {
      const sex = (row[sexIdx] ?? '').trim();
      const gender = SEX_TO_GENDER[sex];
      if (!gender) continue;
      const xValue = Number(row[xIdx]);
      const l = Number(row[lIdx]);
      const m = Number(row[mIdx]);
      const s = Number(row[sIdx]);
      if (!Number.isFinite(xValue) || !Number.isFinite(l) || !Number.isFinite(m) || !Number.isFinite(s)) {
        continue;
      }
      result.rows.push({ indicator, gender, xValue, l, m, s });
      added += 1;
    }
    result.filesLoaded.push(entry);
    logger?.log(`Loaded ${added} LMS rows from ${entry} (${indicator})`);
  }
  return result;
}

function findHeader(headers: string[], names: string[]): number {
  for (const name of names) {
    const idx = headers.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

interface ParsedCsv {
  header: string[];
  rows: string[][];
}

/**
 * Minimal RFC-4180-ish CSV parser — handles quoted fields with
 * embedded commas, newlines, and double-quote escaping. Avoids a
 * runtime dep for what is essentially a tiny fixed-format file.
 */
function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // strip empty trailing rows
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) {
    rows.pop();
  }
  if (rows.length === 0) {
    return { header: [], rows: [] };
  }
  const [header, ...data] = rows;
  return { header: header.map((c) => c.trim()), rows: data };
}
