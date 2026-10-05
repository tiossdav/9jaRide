import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { FleetService, MAX_DEDUCTION_BPS } from './fleet.service';
import { TEMPLATE_CSV } from './fleet-import';

class BusinessDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(100) contactName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_DEDUCTION_BPS) defaultDeductionBps?: number;
}

class VehicleDto {
  /** Needed when an admin adds the vehicle; a business account always adds to its own business. */
  @IsOptional() @IsUUID() businessId?: string;
  @IsString() @MinLength(5) @MaxLength(14) plate!: string;
  @IsString() @MinLength(2) @MaxLength(80) makeModel!: string;
  @IsString() @MinLength(2) @MaxLength(30) colour!: string;
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: string;
  @IsOptional() @IsInt() @Min(1990) @Max(2100) year?: number;
  @IsOptional() @IsString() @MaxLength(40) vin?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class ListQuery {
  @IsOptional() @IsString() @MaxLength(60) search?: string;
  @IsOptional() @IsIn(['all', 'pending', 'verified', 'suspended', 'retired']) status?: string;
  @IsOptional() @Matches(/^[a-z][a-z0-9_]{1,29}$/) category?: string;
  @IsOptional() @IsUUID() businessId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() available?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

class ImportBody {
  @IsOptional() @IsUUID() businessId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() dryRun?: boolean;
}

class StatusDto { @IsIn(['verified', 'suspended', 'retired']) status!: 'verified' | 'suspended' | 'retired'; }
class ImageDto { @IsUUID() fileId!: string; }
class AssignDto {
  @IsUUID() driverId!: string;
  @IsInt() @Min(0) @Max(MAX_DEDUCTION_BPS) deductionBps!: number;
  @IsOptional() @IsInt() @Min(1) targetKobo?: number;
}
class EndDto { @IsString() @MinLength(3) @MaxLength(300) reason!: string; }
class SearchQuery { @IsOptional() @IsString() @MaxLength(60) search?: string; }

/** The vehicle list: for businesses (their own vehicles only), and for staff (all of them). */
@Controller('fleet')
@Roles('support', 'admin', 'business')
@UseInterceptors(StaffAuditInterceptor)
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get('businesses')
  async businesses(@CurrentUser() me: Principal) { return this.fleet.listBusinesses(await this.fleet.scopeFor(me)); }

  @Get('businesses/:id/users') @Roles('admin')
  businessUsers(@Param('id', ParseUUIDPipe) id: string) { return this.fleet.businessUsers(id); }

  @Post('businesses') @Roles('admin') @HttpCode(200)
  createBusiness(@Body() dto: BusinessDto) { return this.fleet.createBusiness(dto); }

  @Get('template.csv') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="vehicles-template.csv"')
  template() { return TEMPLATE_CSV; }

  @Get('vehicles')
  async list(@CurrentUser() me: Principal, @Query() q: ListQuery) { return this.fleet.list(await this.fleet.scopeFor(me), q); }

  @Get('drivers') @Roles('admin', 'business')
  drivers(@Query() q: SearchQuery) { return this.fleet.drivers(q.search); }

  @Get('owners')
  async owners(@CurrentUser() me: Principal) { return this.fleet.ownerBalances(await this.fleet.scopeFor(me)); }

  @Post('vehicles') @Roles('admin', 'business') @HttpCode(200)
  async create(@CurrentUser() me: Principal, @Body() dto: VehicleDto) {
    const scope = await this.fleet.scopeFor(me);
    const businessId = scope.businessId ?? dto.businessId;
    if (!businessId) throw new BadRequestException('say which business this vehicle belongs to');
    return this.fleet.create({ ...dto, businessId, year: dto.year ?? null }, me.id);
  }

  /** Send the file as the form field "file". With dryRun=true nothing is saved; the answer lists what would be accepted and why a line would not. */
  @Post('vehicles/import') @Roles('admin', 'business') @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1 } }))
  async importFile(@CurrentUser() me: Principal, @Body() body: ImportBody, @UploadedFile() file?: { buffer: Buffer; originalname: string }) {
    if (!file) throw new BadRequestException('choose a file to import');
    const scope = await this.fleet.scopeFor(me);
    const businessId = scope.businessId ?? body.businessId;
    if (!businessId) throw new BadRequestException('say which business these vehicles belong to');
    return this.fleet.importFile(businessId, { buffer: file.buffer, name: file.originalname }, body.dryRun ?? false, me.id);
  }

  @Get('vehicles/:id')
  async get(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.fleet.get(await this.fleet.scopeFor(me), id); }

  @Post('vehicles/:id/status') @Roles('admin', 'business') @HttpCode(204)
  async status(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) { await this.fleet.setStatus(await this.fleet.scopeFor(me), id, dto.status, me.id); }

  @Post('vehicles/:id/images') @Roles('admin', 'business') @HttpCode(204)
  async addImage(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImageDto) { await this.fleet.addImage(await this.fleet.scopeFor(me), id, dto.fileId, me.id); }

  @Delete('vehicles/:id/images/:imageId') @Roles('admin', 'business') @HttpCode(204)
  async removeImage(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) { await this.fleet.removeImage(await this.fleet.scopeFor(me), id, imageId); }

  @Post('vehicles/:id/assign') @Roles('admin', 'business') @HttpCode(200)
  async assign(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.fleet.assign(await this.fleet.scopeFor(me), id, dto.driverId, { deductionBps: dto.deductionBps, targetKobo: dto.targetKobo ?? null }, me.id);
  }

  @Post('assignments/:id/end') @Roles('admin', 'business') @HttpCode(204)
  async end(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndDto) { await this.fleet.endAssignment(await this.fleet.scopeFor(me), id, dto.reason); }
}

class ShareDto { @IsInt() @Min(100) @Max(MAX_DEDUCTION_BPS) deductionBps!: number; }

/** What a driver sees and may change about paying toward their vehicle. */
@Controller('driver/vehicle-terms')
@Roles('driver')
export class DriverVehicleTermsController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  async terms(@CurrentUser() me: Principal) { return { terms: await this.fleet.driverTerms(me.id) }; }

  @Put() @HttpCode(204)
  async set(@CurrentUser() me: Principal, @Body() dto: ShareDto) { await this.fleet.setDriverShare(me.id, dto.deductionBps); }
}
