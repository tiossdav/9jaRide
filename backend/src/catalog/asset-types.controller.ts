import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { AssetTypesService } from './asset-types.service';

class CreateDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,29}$/) code!: string;
  @IsString() @MinLength(2) @MaxLength(40) label!: string;
}
class UpdateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) label?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('admin/asset-types')
@UseInterceptors(StaffAuditInterceptor)
export class AssetTypesController {
  constructor(private readonly types: AssetTypesService) {}

  @Roles('support', 'finance', 'admin') @Get() list() { return this.types.list(); }
  @Roles('admin') @Post() @HttpCode(204) async create(@Body() dto: CreateDto) { await this.types.create(dto); }
  @Roles('admin') @Patch(':code') @HttpCode(204) async update(@Param('code') code: string, @Body() dto: UpdateDto) { await this.types.update(code, dto); }
}
