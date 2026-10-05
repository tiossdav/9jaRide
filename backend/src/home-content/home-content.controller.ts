import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseInterceptors } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { CARD_KINDS, CardKind, HomeContentService } from './home-content.service';

class CardDto {
  @IsIn(CARD_KINDS) kind!: CardKind;
  @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @IsString() @MinLength(1) @MaxLength(300) body!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) amountKobo?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

@Controller()
export class HomeContentController {
  constructor(private readonly cards: HomeContentService) {}

  /** The strip under the booking box on the rider home screen. */
  @Roles('rider') @Get('app/home-cards')
  forRiders() { return this.cards.forRiders().then((items) => ({ items })); }
}

@Controller('admin/home-cards')
@UseInterceptors(StaffAuditInterceptor)
export class HomeContentAdminController {
  constructor(private readonly cards: HomeContentService) {}

  @Roles('support', 'admin') @Get()
  list() { return this.cards.list().then((items) => ({ items })); }

  @Roles('admin') @Post() @HttpCode(200)
  create(@Body() dto: CardDto) { return this.cards.create(dto); }

  @Roles('admin') @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CardDto) { return this.cards.update(id, dto); }

  @Roles('admin') @Delete(':id') @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) { await this.cards.remove(id); }
}
