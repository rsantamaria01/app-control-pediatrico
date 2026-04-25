import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolve } from 'path';
import { Gender, WhoIndicator, WhoLmsRowDto, WhoStandardsResponseDto } from '@app/shared';
import type { LmsRow } from '@app/shared';
import { loadLmsCsvDir } from './lms-csv-loader';

/**
 * In-memory store of CDC growth-chart LMS rows loaded from CSV files
 * in `LMS_DATA_DIR` at startup. The chart is static reference data —
 * keeping it in memory avoids a second database engine and makes the
 * Z-score path a synchronous lookup.
 */
@Injectable()
export class WhoStandardsService implements OnModuleInit {
  private readonly logger = new Logger(WhoStandardsService.name);
  private rowsByGender = new Map<Gender, LmsRow[]>();

  onModuleInit(): void {
    const dir = resolve(process.env.LMS_DATA_DIR ?? './data/lms');
    this.logger.log(`Loading LMS CSV files from ${dir}`);
    const result = loadLmsCsvDir(dir, this.logger);
    for (const row of result.rows) {
      const list = this.rowsByGender.get(row.gender) ?? [];
      list.push(row);
      this.rowsByGender.set(row.gender, list);
    }
    for (const list of this.rowsByGender.values()) {
      list.sort((a, b) => {
        if (a.indicator !== b.indicator) {
          return a.indicator < b.indicator ? -1 : 1;
        }
        return a.xValue - b.xValue;
      });
    }
    this.logger.log(
      `LMS data ready: ${result.rows.length} rows, ${result.filesLoaded.length} files (${result.filesLoaded.join(', ')})`,
    );
  }

  getCurve(indicator: WhoIndicator, gender: Gender): WhoStandardsResponseDto {
    const all = this.rowsByGender.get(gender) ?? [];
    const rows = all
      .filter((r) => r.indicator === indicator)
      .map(
        (r): WhoLmsRowDto => ({
          indicator: r.indicator,
          gender: r.gender,
          xValue: r.xValue,
          l: r.l,
          m: r.m,
          s: r.s,
        }),
      );
    return { indicator, gender, rows };
  }

  /** All indicator/gender curves used by MeasurementsService for Z-score computation. */
  getAllForGender(gender: Gender): LmsRow[] {
    return this.rowsByGender.get(gender) ?? [];
  }
}
