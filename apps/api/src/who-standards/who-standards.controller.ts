import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Gender, WhoIndicator, WhoStandardsResponseDto } from '@app/shared';
import { WhoStandardsService } from './who-standards.service';

@ApiTags('who-standards')
@Controller('who-standards')
export class WhoStandardsController {
  constructor(private readonly service: WhoStandardsService) {}

  @Get()
  curve(
    @Query('indicator') indicator: WhoIndicator,
    @Query('gender') gender: Gender,
  ): Promise<WhoStandardsResponseDto> {
    return this.service.getCurve(indicator, gender);
  }
}
