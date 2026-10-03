import { Injectable, Logger, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AdminSosController, SosController } from './sos.controller';
import { SosService } from './sos.service';
import {
  CALL_ESCALATOR,
  CallEscalator,
  SMS_SENDER,
  SOS_ACK_NOTIFIER,
  STAFF_ALERTER,
  SmsSender,
  SosAckNotifier,
  StaffAlerter,
} from './safety.types';

// Placeholders until the admin Socket.IO gateway, an SMS provider and a voice provider are wired in.
// They log loudly so an unwired channel is never mistaken for a working one.
const warn = new Logger('SafetyChannels');
const staffAlerter: StaffAlerter = { newSos: async (s) => warn.warn(`[stub] staff alert for SOS ${s.id}`) };
const smsSender: SmsSender = { send: async (to, text) => warn.warn(`[stub] SMS to ${to}: ${text}`) };
const callEscalator: CallEscalator = { call: async (to, id) => warn.warn(`[stub] phone escalation to ${to} for SOS ${id}`) };
const ackNotifier: SosAckNotifier = { acknowledged: async (u, id) => warn.warn(`[stub] ack for SOS ${id} -> user ${u}`) };

// Runs in the worker role. Dedicated tick: escalation must not wait behind other jobs.
@Injectable()
export class SafetyWorker {
  private readonly log = new Logger(SafetyWorker.name);
  constructor(private readonly sos: SosService) {}

  @Interval(5_000)
  async tick() {
    try {
      await this.sos.escalateUnacknowledged();
    } catch (e) {
      this.log.error(`escalation tick failed: ${e}`);
    }
  }
}

@Module({
  controllers: [SosController, AdminSosController],
  providers: [
    SosService,
    SafetyWorker,
    { provide: STAFF_ALERTER, useValue: staffAlerter },
    { provide: SMS_SENDER, useValue: smsSender },
    { provide: CALL_ESCALATOR, useValue: callEscalator },
    { provide: SOS_ACK_NOTIFIER, useValue: ackNotifier },
  ],
  exports: [SosService],
})
export class SafetyModule {}
