import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhoLmsStandard } from '@app/database';
import { Gender, WhoIndicator, WhoLmsRowDto, WhoStandardsResponseDto } from '@app/shared';
import type { LmsRow } from '@app/shared';

@Injectable()
export class WhoStandardsService {
  constructor(
    @InjectRepository(WhoLmsStandard, 'who')
    private readonly repo: Repository<WhoLmsStandard>,
  ) {}

  async getCurve(
    indicator: WhoIndicator,
    gender: Gender,
  ): Promise<WhoStandardsResponseDto> {
    const rows = await this.repo.find({
      where: { indicator, gender },
      order: { xValue: 'ASC' },
    });
    return {
      indicator,
      gender,
      rows: rows.map(
        (r): WhoLmsRowDto => ({
          indicator: r.indicator,
          gender: r.gender,
          xValue: Number(r.xValue),
          l: Number(r.l),
          m: Number(r.m),
          s: Number(r.s),
        }),
      ),
    };
  }

  /** All four indicator/gender curves loaded once. Used by MeasurementsService for Z-score computation. */
  async getAllForGender(gender: Gender): Promise<LmsRow[]> {
    const rows = await this.repo.find({
      where: { gender },
      order: { indicator: 'ASC', xValue: 'ASC' },
    });
    return rows.map((r) => ({
      indicator: r.indicator,
      gender: r.gender,
      xValue: Number(r.xValue),
      l: Number(r.l),
      m: Number(r.m),
      s: Number(r.s),
    }));
  }
}
