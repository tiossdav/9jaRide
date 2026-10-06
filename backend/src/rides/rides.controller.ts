import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsBooleanString, IsDate, IsIn, IsInt, Matches, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { AssetTypesService } from '../catalog/asset-types.service';
import { IdempotencyKey } from '../common/idempotency-key';
import { ChatService } from './chat.service';
import { ExtensionsService } from './extensions.service';
import { LocationService, MAX_BATCH } from './location.service';
import { RidesService } from './rides.service';
import { ScheduledRidesService } from './scheduled-rides.service';

type Cat = string;

class LatLng {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

class QuoteDto {
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: Cat;
  @IsInt() @Min(1) @Max(500_000) distanceM!: number;
  @IsInt() @Min(0) @Max(86_400) durationS!: number;
}

class RequestRideDto {
  @IsOptional() @IsString() @MaxLength(200) pickupAddress?: string;
  @IsOptional() @IsString() @MaxLength(200) dropoffAddress?: string;
  @IsUUID() quoteId!: string;
  @IsOptional() @IsString() @MaxLength(20) promoCode?: string;
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: Cat;
  @IsIn(['cash', 'wallet']) paymentMethod!: 'cash' | 'wallet';
  @ValidateNested() @Type(() => LatLng) pickup!: LatLng;
  @ValidateNested() @Type(() => LatLng) dropoff!: LatLng;
}

class PromoCheckDto {
  @IsString() @MinLength(3) @MaxLength(20) code!: string;
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: Cat;
  @IsInt() @Min(1) @Max(500_000) distanceM!: number;
  @IsInt() @Min(0) @Max(86_400) durationS!: number;
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

class RateDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

class MessageDto {
  @IsString() @MinLength(1) @MaxLength(500) text!: string;
  @IsOptional() @IsString() @MaxLength(64) clientId?: string;
}

class MessagesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) after?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(25) wait?: number;
}

class ReadDto {
  @IsInt() @Min(0) upTo!: number;
}

class ExtensionDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsInt() @Min(1) @Max(500_000) distanceM!: number;
  @IsInt() @Min(0) @Max(86_400) durationS!: number;
}

class ExtensionAnswerDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

class ListQuery {
  @IsOptional() @IsIn(['active', 'history']) scope?: 'active' | 'history';
}

class CancelDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) reason?: string;
}

class ScheduleDto {
  @IsOptional() @IsString() @MaxLength(200) pickupAddress?: string;
  @IsOptional() @IsString() @MaxLength(200) dropoffAddress?: string;
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: Cat;
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

/** A phone's own id, as sent in X-Device-Id. Anything odd is ignored rather than trusted. */
const cleanDevice = (v?: string): string | undefined => (v && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : undefined);

class WaitQuery {
  /** The extensionVersion the app already shows: the held answer is also released when an extension is asked or answered. */
  @IsOptional() @IsString() @MaxLength(80) ext?: string;
  @IsOptional() @IsString() @MaxLength(40) waitFor?: string;
  /** How long the server may hold the answer, in seconds. Capped at 25 so connections never sit open for long. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(25) wait?: number;
}

@Controller()
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly location: LocationService,
    private readonly scheduled: ScheduledRidesService,
    private readonly assetTypes: AssetTypesService,
    private readonly chat: ChatService,
    private readonly extensions: ExtensionsService,
  ) {}

  // ------------------------------------------------------------------ rider

  /** What a rider can book right now: categories an admin has switched on that have fees in force. */
  @Roles('rider') @Get('rides/categories')
  categories() {
    return this.assetTypes.offered();
  }

  /** Would this code work, and what would it take off? Nothing is used up by asking. */
  @Roles('rider') @Post('rides/promo/check') @HttpCode(200)
  async checkPromo(@CurrentUser() me: Principal, @Body() dto: PromoCheckDto) {
    return this.rides.checkPromo(me.id, dto.code, dto.category, { distanceM: dto.distanceM, durationS: dto.durationS });
  }

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

  // These two sit above rides/:id so "active" is not read as an id.
  @Roles('rider') @Get('rides')
  list(@CurrentUser() me: Principal, @Query() q: ListQuery) {
    return this.rides.listForRider(me.id, q.scope ?? 'history');
  }

  @Roles('rider') @Get('rides/active')
  active(@CurrentUser() me: Principal) {
    return this.rides.activeForRider(me.id);
  }

  // ------------------------------------------------------------------ chat between the rider and driver of a ride

  // ------------------------------------------------------------------ going further than the booked destination

  /** Either side proposes a new destination; the other is asked. Only one question is open at a time. */
  @Roles('rider', 'driver') @Post('rides/:id/extension') @HttpCode(200)
  askExtension(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtensionDto) {
    return this.extensions.request(me.id, id, dto);
  }

  @Roles('rider', 'driver') @Post('rides/:id/extension/:extId/accept') @HttpCode(200)
  acceptExtension(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('extId', ParseUUIDPipe) extId: string) {
    return this.extensions.respond(me.id, id, extId, true);
  }

  @Roles('rider', 'driver') @Post('rides/:id/extension/:extId/decline') @HttpCode(200)
  declineExtension(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('extId', ParseUUIDPipe) extId: string, @Body() dto: ExtensionAnswerDto) {
    return this.extensions.respond(me.id, id, extId, false, dto.reason);
  }

  @Roles('rider', 'driver') @Post('rides/:id/extension/:extId/withdraw') @HttpCode(200)
  withdrawExtension(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('extId', ParseUUIDPipe) extId: string) {
    return this.extensions.withdraw(me.id, id, extId);
  }

  /** Messages after `after`; with `wait` the answer is held until a new one arrives. Only this ride's rider and driver may read. */
  @Roles('rider', 'driver') @Get('rides/:id/messages')
  messages(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Query() q: MessagesQuery) {
    return this.chat.list(me.id, id, q.after ?? 0, q.wait ?? 0);
  }

  @Roles('rider', 'driver') @Post('rides/:id/messages') @HttpCode(200)
  sendMessage(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageDto) {
    return this.chat.send(me.id, id, dto.text, dto.clientId);
  }

  @Roles('rider', 'driver') @Post('rides/:id/messages/read') @HttpCode(204)
  async readMessages(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReadDto) {
    await this.chat.markRead(me.id, id, dto.upTo);
  }

  @Roles('rider', 'driver') @Post('rides/:id/rating') @HttpCode(200)
  rate(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RateDto) {
    return this.rides.rate(me, id, dto.stars, dto.tags ?? [], dto.comment);
  }

  /**
   * One ride. With waitFor=<the status the app already shows> the answer is held (up to `wait` seconds) until the status
   * changes, so a phone watching a ride makes one request every twenty seconds or so instead of one every few seconds, and still
   * hears of a change at once. Without waitFor it answers immediately, as before.
   */
  @Get('rides/:id')
  async get(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Query() q: WaitQuery) {
    const first = await this.rides.get(me, id); // also checks this person may see the ride
    if (!q.waitFor || first.status !== q.waitFor) return first;
    const changed = await this.rides.waitForStatusChange(id, q.waitFor, q.wait ?? 20, q.ext);
    return changed ? this.rides.get(me, id) : first;
  }

  @Roles('rider') @Get('rides/:id/driver-location')
  driverLocation(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.driverPosition(me, id).then((p) => p ?? { lat: null, lng: null, at: null });
  }

  @Get('rides/:id/receipt')
  receipt(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.receipt(me, id);
  }

  // ------------------------------------------------------------------ driver

  @Roles('driver') @Post('driver/location') @HttpCode(204)
  async ping(@CurrentUser() me: Principal, @Body() dto: PingDto, @Headers('x-device-id') device?: string) {
    await this.location.ingest(me.id, [{ ...dto, recordedAt: new Date() }], cleanDevice(device));
  }

  /** The driver went online on this phone: it now holds the claim, and any other phone with this account is told to go offline. */
  @Roles('driver') @Post('driver/online') @HttpCode(204)
  async online(@CurrentUser() me: Principal, @Headers('x-device-id') device?: string) {
    const id = cleanDevice(device);
    if (id) await this.location.claimDevice(me.id, id);
  }

  @Roles('driver') @Post('driver/offline') @HttpCode(204)
  async offline(@CurrentUser() me: Principal, @Headers('x-device-id') device?: string) {
    const id = cleanDevice(device);
    if (id) await this.location.releaseDevice(me.id, id);
  }

  /** The background-location upload: one or many timestamped readings, from the live stream or the offline queue. */
  @Roles('driver') @Post('driver/location/batch') @HttpCode(200)
  batch(@CurrentUser() me: Principal, @Body() dto: BatchDto, @Headers('x-device-id') device?: string) {
    return this.location.ingest(me.id, dto.points, cleanDevice(device));
  }

  /** The offer waiting for this driver. The app asks every few seconds while the driver is online. */
  @Roles('driver') @Get('driver/offer')
  async myOffer(@CurrentUser() me: Principal, @Query() q: WaitQuery, @Headers('x-device-id') device?: string) {
    // a phone that is not the one the driver is online on is not given the booking
    try { await this.location.assertDevice(me.id, cleanDevice(device)); } catch { return { offer: null }; }
    // With wait=<seconds> the answer is held until an offer arrives (or the time runs out): one request in place of many.
    return { offer: q.wait ? await this.rides.waitForDriverOffer(me.id, q.wait) : await this.rides.driverOffer(me.id) };
  }

  @Roles('driver') @Get('driver/rides/active')
  async myRide(@CurrentUser() me: Principal) {
    return { ride: await this.rides.driverActiveRide(me.id) };
  }

  @Roles('driver') @Post('driver/rides/:id/cancel') @HttpCode(200)
  driverCancel(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.rides.cancelByDriver(me.id, id, dto.reason);
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
