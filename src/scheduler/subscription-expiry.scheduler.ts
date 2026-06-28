import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '@prisma/client';

interface SubscriptionRecord {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  expiresAt: string;
}

@Injectable()
export class SubscriptionExpiryScheduler {
  private readonly logger = new Logger(SubscriptionExpiryScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Runs daily at 09:00 to check subscriptions expiring in 7, 3, or 1 day.
   */
  @Cron('0 9 * * *', { name: 'subscription-expiry-check' })
  async checkExpiringSubscriptions(): Promise<void> {
    this.logger.log('Running subscription expiry check...');
    const daysToCheck = [7, 3, 1];

    for (const daysLeft of daysToCheck) {
      try {
        const subscriptions = await this.fetchExpiringSubscriptions(daysLeft);
        this.logger.log(`Found ${subscriptions.length} subscriptions expiring in ${daysLeft} day(s)`);

        for (const sub of subscriptions) {
          await this.processExpiringSubscription(sub, daysLeft);
        }
      } catch (err: any) {
        this.logger.error(`Error checking subscriptions expiring in ${daysLeft} days: ${err.message}`);
      }
    }

    this.logger.log('Subscription expiry check complete');
  }

  private async fetchExpiringSubscriptions(daysLeft: number): Promise<SubscriptionRecord[]> {
    const subscriptionServiceUrl = this.config.get<string>(
      'SUBSCRIPTION_SERVICE_URL',
      'http://ebooks-subscription:3004',
    );

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysLeft);
    const dateStr = targetDate.toISOString().split('T')[0];

    const url = `${subscriptionServiceUrl}/subscriptions/internal/expiring?date=${dateStr}`;

    try {
      const response = await fetch(url, {
        headers: {
          'x-internal-key': this.config.get<string>('INTERNAL_API_KEY', ''),
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        this.logger.warn(`Subscription service returned ${response.status} for daysLeft=${daysLeft}`);
        return [];
      }

      const body: { data: SubscriptionRecord[] } = await response.json();
      return body.data ?? [];
    } catch (err: any) {
      this.logger.error(`Failed to fetch subscriptions from subscription-service: ${err.message}`);
      return [];
    }
  }

  private async processExpiringSubscription(
    sub: SubscriptionRecord,
    daysLeft: number,
  ): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const renewUrl = `${frontendUrl}/subscription/renew?id=${sub.id}`;

    try {
      await Promise.all([
        this.emailService.sendSubscriptionExpiringEmail(
          sub.userEmail,
          sub.userName,
          daysLeft,
          renewUrl,
        ),
        this.notificationService.create({
          userId: sub.userId,
          type: NotificationType.SUBSCRIPTION_EXPIRING,
          title: 'Subscription Expiring Soon',
          body: `Your subscription expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Renew to keep access.`,
          metadata: {
            subscriptionId: sub.id,
            expiresAt: sub.expiresAt,
            daysLeft,
          },
        }),
      ]);
      this.logger.log(`Notified user ${sub.userId} about subscription expiring in ${daysLeft} day(s)`);
    } catch (err: any) {
      this.logger.error(`Failed to notify user ${sub.userId}: ${err.message}`);
    }
  }
}
