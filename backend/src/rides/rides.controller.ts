import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsBooleanString, IsDate, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { IdempotencyKey } from '../common/idempotency-key';
import { LocationService, MAX_BATCH } from './location.service';
import { RidesService } from './rides.service';
import { ScheduledRidesService } from './scheduled-rides.service';

const CATEGORIES = ['regular', 'comfort', 'package'] as const;
type Cat = (typeof CATEGORIES)[number];

class LatLng {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

class QuoteDto {
  @IsIn(CATEGORIES) category!: Cat;
  @IsInt() @Min(1) @Max(500_000) distanceM!: number;
  @IsInt() @Min(0) @Max(86_400) durationS!: number;
}

class RequestRideDto {
  @IsUUID() quoteId!: string;
  @IsIn(CATEGORIES) category!: Cat;
  @IsIn(['cash', 'wallet']) paymentMethod!: 'cash' | 'wallet';
  @ValidateNested() @Type(() => LatLng) pickup!: LatLng;
  @ValidateNested() @Type(() => LatLng) dropoff!: LatLng;
}

class PingDto extends LatLng {
  @IsOptional() @IsNumber() @Min(0) @Max(100_000) accuracyM?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(400) speedKmh?: number;
  @IsOptional() @IsBoolean() mockLocation?: boolean;
}

class PointDto extends PingDto {
  /** When the phone took the reading (ISO 8601). An offline queue uploads old readings. */
  @Type(() => Date) @IsDate() recordedAt!: Date;
}

class BatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BATCH) @ValidateNested({ each: true }) @Type(() => PointDto) points!: PointDto[];
}

class CancelDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) reason?: string;
}

class ScheduleDto {
  @IsIn(CATEGORIES) category!: Cat;
  @IsIn(['cash', 'wallet']) paymentMethod!: 'cash' | 'wallet';
  @ValidateNested() @Type(() => LatLng) pickup!: LatLng;
  @ValidateNested() @Type(() => LatLng) dropoff!: LatLng;
  @IsInt() @Min(1) @Max(500_000) distanceM!: number;
  @IsInt() @Min(0) @Max(86_400) durationS!: number;
  @Type(() => Date) @IsDate() firstPickupAt!: Date;
  @IsIn(['none', 'weekly']) repeat!: 'none' | 'weekly';
  @ValidateIf((o) => o.repeat === 'weekly') @IsInt() @Min(2) @Max(52) weeks?: number;
}

class FlaggedQuery {
  @IsOptional() @IsBooleanString() onlyOpen?: string;
}

class CompleteDto {
  @IsInt() @Min(0) @Max(500_000) distanceM!: number;
  @IsInt() @Min(0) @Max(86_400) durationS!: number;
  @IsInt() @Min(0) @Max(86_400) waitingS!: number;
}

@Controller()
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly location: LocationService,
    private readonly scheduled: ScheduledRidesService,
  ) {}

  // ------------------------------------------------------------------ rider

  @Roles('rider') @Post('rides/quote') @HttpCode(200)
  quote(@CurrentUser() me: Principal, @Body() dto: QuoteDto) {
    return this.rides.quote(me.id, dto.category, { distanceM: dto.distanceM, durationS: dto.durationS });
  }

  @Roles('rider') @Post('rides') @HttpCode(200)
  async request(@CurrentUser() me: Principal, @IdempotencyKey() key: string, @Body() dto: RequestRideDto) {
    const r = await this.rides.request(me.id, key, dto);
    return { rideId: r.rideId, duplicate: !r.created };
  }

  @Roles('rider') @Post('rides/:id/cancel') @HttpCode(200)
  cancel(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.rides.cancelByRider(me.id, id, dto.reason);
  }

  // ------------------------------------------------------------------ rider: scheduled and weekly rides

  @Roles('rider') @Post('ride-schedules') @HttpCode(200)
  schedule(@CurrentUser() me: Principal, @IdempotencyKey() key: string, @Body() dto: ScheduleDto) {
    return this.scheduled.create(me.id, key, dto);
  }

  @Roles('rider') @Get('ride-schedules')
  schedules(@CurrentUser() me: Principal) {
    return this.scheduled.list(me.id);
  }

  @Roles('rider') @Post('ride-schedules/:id/cancel') @HttpCode(200)
  cancelSchedule(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduled.cancelSeries(me.id, id);
  }

  // ------------------------------------------------------------------ rider, driver and staff

  @Get('rides/:id')
  get(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.get(me, id);
  }

  @Get('rides/:id/receipt')
  receipt(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.receipt(me, id);
  }

  // ------------------------------------------------------------------ driver

  @Roles('driver') @Post('driver/location') @HttpCode(204)
  async ping(@CurrentUser() me: Principal, @Body() dto: PingDto) {
    await this.location.ingest(me.id, [{ ...dto, recordedAt: new Date() }]);
  }

  /** The background-location upload: one or many timestamped readings, from the live stream or the offline queue. */
  @Roles('driver') @Post('driver/location/batch') @HttpCode(200)
  batch(@CurrentUser() me: Principal, @Body() dto: BatchDto) {
    return this.location.ingest(me.id, dto.points);
  }

  @Roles('driver') @Post('driver/rides/:id/accept') @HttpCode(200)
  accept(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.accept(me.id, id);
  }

  @Roles('driver') @Post('driver/rides/:id/decline') @HttpCode(204)
  async decline(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.rides.decline(me.id, id);
  }

  @Roles('driver') @Post('driver/rides/:id/arrive') @HttpCode(204)
  async arrive(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.rides.advanceTrip(me.id, id, 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED');
  }

  @Roles('driver') @Post('driver/rides/:id/start') @HttpCode(204)
  async start(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.rides.advanceTrip(me.id, id, 'DRIVER_ARRIVED', 'TRIP_STARTED');
  }

  @Roles('driver') @Post('driver/rides/:id/complete') @HttpCode(200)
  complete(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteDto) {
    return this.rides.complete(me.id, id, dto);
  }
}

/** Trips where the distance the driver reported is well above the route their phone recorded. */
@Controller('admin/trip-checks')
@Roles('support', 'finance', 'admin')
@UseInterceptors(StaffAuditInterceptor)
export class AdminTripChecksController {
  constructor(private readonly rides: RidesService) {}

  @Get()
  flagged(@Query() q: FlaggedQuery) {
    return this.rides.flaggedTrips(q.onlyOpen !== 'false');
  }

  @Post(':rideId/review') @HttpCode(200)
  async review(@CurrentUser() me: Principal, @Param('rideId', ParseUUIDPipe) rideId: string) {
    return { reviewed: await this.rides.reviewTrip(rideId, me.id) };
  }
}
