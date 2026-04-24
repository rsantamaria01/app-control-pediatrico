import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateParentContactDto,
  CreateParentDto,
  ParentContactDto,
  ParentDto,
  UpdateParentDto,
  UserRole,
} from '@app/shared';
import { ParentsService } from './parents.service';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('parents')
@Controller('parents')
@Roles(UserRole.ADMIN, UserRole.DOCTOR)
export class ParentsController {
  constructor(private readonly parents: ParentsService) {}

  @Get()
  list(): Promise<ParentDto[]> {
    return this.parents.list();
  }

  @Post()
  create(@Body() dto: CreateParentDto): Promise<ParentDto> {
    return this.parents.create(dto);
  }

  @Get(':id')
  byId(@Param('id') id: string): Promise<ParentDto> {
    return this.parents.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateParentDto): Promise<ParentDto> {
    return this.parents.update(id, dto);
  }

  @Post(':id/contacts')
  addContact(
    @Param('id') id: string,
    @Body() dto: CreateParentContactDto,
  ): Promise<ParentContactDto> {
    return this.parents.addContact(id, dto);
  }

  @Get(':id/contacts')
  listContacts(@Param('id') id: string): Promise<ParentContactDto[]> {
    return this.parents.listContacts(id);
  }
}
