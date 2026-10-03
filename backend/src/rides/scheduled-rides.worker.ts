import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ScheduledRidesService } from './scheduled-rides.service';

// Runs in the worker role. Safe on several instances: each ride is claimed with FOR UPDATE SKIP LOCKED.
@Injectable()
export class ScheduledRidesWorker {
  private readonly log = new Logger(ScheduledRidesWorker.name);

  constructor(private readonly scheduled: ScheduledRidesService) {}

  @Interval(30_000)
  async tick() {
    try {
      await this.scheduled.activateDue();
    } catch (e) {
      this.log.error(`scheduled-ride activation failed: ${e}`);
    }
  }
}
