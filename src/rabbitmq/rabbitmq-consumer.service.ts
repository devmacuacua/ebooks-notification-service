import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notifications/notification.service';
import { SmsService } from '../sms/sms.service';
import { NotificationType } from '@prisma/client';

interface RabbitMQMessage<T = Record<string, any>> {
  data: T;
}

interface UserRegisteredPayload {
  userId: string;
  email: string;
  name: string;
  verificationUrl: string;
}

interface PasswordResetPayload {
  email: string;
  name: string;
  resetUrl: string;
}

interface SubscriptionExpiringPayload {
  userId: string;
  subscriptionId: string;
  daysLeft: number;
  endDate?: string;
  planType?: string;
}

interface SubscriptionActivatedPayload {
  userId: string;
  subscriptionId: string;
  planId: string;
  planName: string;
  expiresAt: string;
}

interface OrderStatusChangedPayload {
  orderId: string;
  orderNumber?: string;
  userId: string;
  previousStatus?: string;
  newStatus: string;
}

interface DeliveryUpdatedPayload {
  deliveryId?: string;
  orderId: string;
  userId: string;
  trackingCode?: string;
  status: string;
  province?: string;
  recipientName?: string;
  recipientPhone?: string;
  estimatedDelivery?: string;
  deliveredAt?: string;
}

interface PaymentConfirmedPayload {
  paymentId: string;
  userId: string;
  amount: number;
  currency?: string;
  method?: string;
  orderId?: string;
  subscriptionId?: string;
}

interface UserInfo {
  id: string;
  name: string;
  email: string;
}

const EXCHANGE = 'ebooks.events';
const EXCHANGE_TYPE = 'topic';

const QUEUES = {
  USER_REGISTERED:          'notification.user.registered',
  PASSWORD_RESET:           'notification.user.password-reset-requested',
  SUBSCRIPTION_EXPIRING:    'notification.subscription.expiring',
  SUBSCRIPTION_ACTIVATED:   'notification.subscription.activated',
  ORDER_STATUS_CHANGED:     'notification.order.status-changed',
  DELIVERY_UPDATED:         'notification.delivery.updated',
  PAYMENT_CONFIRMED:        'notification.payment.confirmed',
} as const;

const ROUTING_KEYS: Record<keyof typeof QUEUES, string> = {
  USER_REGISTERED:        'user.registered',
  PASSWORD_RESET:         'user.password-reset-requested',
  SUBSCRIPTION_EXPIRING:  'subscription.expiring',
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
  ORDER_STATUS_CHANGED:   'order.status-changed',
  DELIVERY_UPDATED:       'delivery.status.updated',
  PAYMENT_CONFIRMED:      'payment.completed',
};

@Injectable()
export class RabbitMQConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQConsumerService.name);
  private connection: amqplib.ChannelModel | null = null;
  private channel: amqplib.Channel | null = null;
  private isShuttingDown = false;
  private readonly authServiceUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly smsService: SmsService,
  ) {
    this.authServiceUrl = this.config.get<string>(
      'AUTH_SERVICE_URL',
      'http://ebooks-auth-service:8081',
    );
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    await this.disconnect();
  }

  private async fetchUserInfo(userId: string): Promise<UserInfo | null> {
    try {
      const res = await fetch(`${this.authServiceUrl}/auth/internal/users/${userId}`);
      if (!res.ok) return null;
      return (await res.json()) as UserInfo;
    } catch {
      this.logger.warn(`Could not fetch user info for userId=${userId}`);
      return null;
    }
  }

  private async connect(): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672');
    try {
      this.connection = await amqplib.connect(url);
      this.channel = await this.connection.createChannel();

      this.connection.on('error', (err) => {
        this.logger.error(`RabbitMQ connection error: ${err.message}`);
        if (!this.isShuttingDown) {
          setTimeout(() => this.connect(), 5000);
        }
      });

      this.connection.on('close', () => {
        if (!this.isShuttingDown) {
          this.logger.warn('RabbitMQ connection closed. Reconnecting...');
          setTimeout(() => this.connect(), 5000);
        }
      });

      await this.channel.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

      await this.setupQueues();
      this.logger.log('RabbitMQ consumer connected and queues bound');
    } catch (err: any) {
      this.logger.error(`Failed to connect to RabbitMQ: ${err.message}`);
      if (!this.isShuttingDown) {
        setTimeout(() => this.connect(), 5000);
      }
    }
  }

  private async setupQueues(): Promise<void> {
    if (!this.channel) return;

    const ch = this.channel;

    for (const key of Object.keys(QUEUES) as Array<keyof typeof QUEUES>) {
      await ch.assertQueue(QUEUES[key], { durable: true });
      await ch.bindQueue(QUEUES[key], EXCHANGE, ROUTING_KEYS[key]);
    }

    // User registered
    await ch.consume(QUEUES.USER_REGISTERED, (msg) =>
      this.handleMessage(msg, (payload: UserRegisteredPayload) =>
        this.handleUserRegistered(payload),
      ),
    );

    // Password reset
    await ch.consume(QUEUES.PASSWORD_RESET, (msg) =>
      this.handleMessage(msg, (payload: PasswordResetPayload) =>
        this.handlePasswordReset(payload),
      ),
    );

    // Subscription expiring
    await ch.consume(QUEUES.SUBSCRIPTION_EXPIRING, (msg) =>
      this.handleMessage(msg, (payload: SubscriptionExpiringPayload) =>
        this.handleSubscriptionExpiring(payload),
      ),
    );

    // Subscription activated
    await ch.consume(QUEUES.SUBSCRIPTION_ACTIVATED, (msg) =>
      this.handleMessage(msg, (payload: SubscriptionActivatedPayload) =>
        this.handleSubscriptionActivated(payload),
      ),
    );

    // Order status changed
    await ch.consume(QUEUES.ORDER_STATUS_CHANGED, (msg) =>
      this.handleMessage(msg, (payload: OrderStatusChangedPayload) =>
        this.handleOrderStatusChanged(payload),
      ),
    );

    // Delivery updated
    await ch.consume(QUEUES.DELIVERY_UPDATED, (msg) =>
      this.handleMessage(msg, (payload: DeliveryUpdatedPayload) =>
        this.handleDeliveryUpdated(payload),
      ),
    );

    // Payment confirmed
    await ch.consume(QUEUES.PAYMENT_CONFIRMED, (msg) =>
      this.handleMessage(msg, (payload: PaymentConfirmedPayload) =>
        this.handlePaymentConfirmed(payload),
      ),
    );
  }

  private handleMessage<T>(
    msg: amqplib.ConsumeMessage | null,
    handler: (payload: T) => Promise<void>,
  ): void {
    if (!msg || !this.channel) return;

    const ch = this.channel;

    (async () => {
      try {
        const raw = msg.content.toString();
        const parsed: RabbitMQMessage<T> = JSON.parse(raw);
        const payload = parsed.data ?? (parsed as unknown as T);
        await handler(payload);
        ch.ack(msg);
      } catch (err: any) {
        this.logger.error(`Error processing message: ${err.message}`);
        ch.nack(msg, false, false);
      }
    })();
  }

  private async handleUserRegistered(payload: UserRegisteredPayload): Promise<void> {
    this.logger.log(`Handling user.registered for ${payload.email}`);
    await this.emailService.sendVerificationEmail(
      payload.email,
      payload.name,
      payload.verificationUrl,
    );
  }

  private async handlePasswordReset(payload: PasswordResetPayload): Promise<void> {
    this.logger.log(`Handling password-reset-requested for ${payload.email}`);
    await this.emailService.sendPasswordResetEmail(
      payload.email,
      payload.name,
      payload.resetUrl,
    );
  }

  private async handleSubscriptionExpiring(payload: SubscriptionExpiringPayload): Promise<void> {
    this.logger.log(`Handling subscription.expiring for user ${payload.userId}`);

    const tasks: Promise<any>[] = [
      this.notificationService.create({
        userId: payload.userId,
        type: NotificationType.SUBSCRIPTION_EXPIRING,
        title: 'Subscription Expiring Soon',
        body: `Your subscription expires in ${payload.daysLeft} day${payload.daysLeft !== 1 ? 's' : ''}. Renew to keep access.`,
        metadata: { subscriptionId: payload.subscriptionId, daysLeft: payload.daysLeft },
      }),
    ];

    const user = await this.fetchUserInfo(payload.userId);
    if (user) {
      const frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://ebooks.co.mz');
      const renewUrl = `${frontendUrl}/subscription/renew`;
      tasks.push(
        this.emailService.sendSubscriptionExpiringEmail(
          user.email,
          user.name,
          payload.daysLeft,
          renewUrl,
        ),
      );
    }

    await Promise.all(tasks);
  }

  private async handleSubscriptionActivated(payload: SubscriptionActivatedPayload): Promise<void> {
    this.logger.log(`Handling subscription.activated for user ${payload.userId}`);
    const user = await this.fetchUserInfo(payload.userId);

    const tasks: Promise<any>[] = [
      this.notificationService.create({
        userId: payload.userId,
        type: NotificationType.SUBSCRIPTION_ACTIVATED,
        title: 'Subscription Active',
        body: `Your ${payload.planName} plan is now active. Enjoy unlimited reading!`,
        metadata: {
          subscriptionId: payload.subscriptionId,
          planId: payload.planId,
          planName: payload.planName,
          expiresAt: payload.expiresAt,
        },
      }),
    ];

    if (user) {
      tasks.push(
        this.emailService.sendSubscriptionActivatedEmail(
          user.email,
          user.name,
          payload.planName,
          payload.expiresAt,
        ),
      );
    }

    await Promise.all(tasks);
  }

  private async handleOrderStatusChanged(payload: OrderStatusChangedPayload): Promise<void> {
    this.logger.log(`Handling order.status-changed for user ${payload.userId}`);

    await this.notificationService.create({
      userId: payload.userId,
      type: NotificationType.ORDER_STATUS_CHANGED,
      title: 'Order Status Updated',
      body: `Your order${payload.orderNumber ? ` #${payload.orderNumber}` : ''} is now ${payload.newStatus}.`,
      metadata: { orderId: payload.orderId, status: payload.newStatus },
    });

    const user = await this.fetchUserInfo(payload.userId);
    if (user) {
      await this.emailService.sendOrderConfirmationEmail(user.email, user.name, {
        id: payload.orderId,
        status: payload.newStatus,
        items: [],
        total: 0,
      });
    }
  }

  private async handleDeliveryUpdated(payload: DeliveryUpdatedPayload): Promise<void> {
    this.logger.log(`Handling delivery.status.updated for user ${payload.userId}`);

    const statusPt: Record<string, string> = {
      PENDING: 'pendente',
      PROCESSING: 'em processamento',
      PICKED_UP: 'recolhida',
      IN_TRANSIT: 'em trânsito',
      OUT_FOR_DELIVERY: 'em entrega',
      DELIVERED: 'entregue',
      FAILED: 'falhou',
      RETURNED: 'devolvida',
    };
    const statusLabel = statusPt[payload.status] ?? payload.status;
    const trackingRef = payload.trackingCode ?? payload.orderId.substring(0, 8).toUpperCase();

    const tasks: Promise<any>[] = [
      this.notificationService.create({
        userId: payload.userId,
        type: NotificationType.DELIVERY_UPDATE,
        title: 'Actualização de entrega',
        body: `A sua encomenda ${trackingRef} está ${statusLabel}.`,
        metadata: payload,
      }),
    ];

    const user = await this.fetchUserInfo(payload.userId);
    if (user) {
      tasks.push(
        this.emailService.sendDeliveryUpdateEmail(user.email, user.name, {
          orderId: payload.orderId,
          status: payload.status,
          estimatedDelivery: payload.estimatedDelivery,
        }),
      );
    }

    if (payload.recipientPhone) {
      const smsMessage =
        `EBooksStore: A sua encomenda ${trackingRef} está ${statusLabel}` +
        `. Mais info: ebooks.co.mz`;
      tasks.push(this.smsService.send(payload.recipientPhone, smsMessage));
    }

    await Promise.all(tasks);
  }

  private async handlePaymentConfirmed(payload: PaymentConfirmedPayload): Promise<void> {
    this.logger.log(`Handling payment.completed for user ${payload.userId}`);

    await this.notificationService.create({
      userId: payload.userId,
      type: NotificationType.PAYMENT_CONFIRMED,
      title: 'Payment Confirmed',
      body: `Your payment of ${payload.amount.toFixed(2)} ${payload.currency ?? 'MZN'} has been confirmed.`,
      metadata: payload,
    });

    const user = await this.fetchUserInfo(payload.userId);
    if (user) {
      await this.emailService.sendPaymentConfirmedEmail(user.email, user.name, {
        id: payload.paymentId,
        amount: payload.amount,
        currency: payload.currency,
        method: payload.method,
        orderId: payload.orderId,
      });
    }
  }

  private async disconnect(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (err: any) {
      this.logger.error(`Error during RabbitMQ disconnect: ${err.message}`);
    }
  }
}
