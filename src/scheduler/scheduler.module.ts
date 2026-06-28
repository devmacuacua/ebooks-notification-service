import { Module } from '@nestjs/common';
import { SubscriptionExpiryScheduler } from './subscription-expiry.scheduler';
import { EmailModule } from '../email/email.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [EmailModule, NotificationModule],
  providers: [SubscriptionExpiryScheduler],
})
export class SchedulerModule {}
