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
  userId: string;
  email: string;
  name: string;
  resetUrl: string;
}

interface SubscriptionExpiringPayload {
  userId: string;
  email: string;
  name: string;
  daysLeft: number;
  renewUrl: string;
  subscriptionId: string;
}

interface OrderStatusChangedPayload {
  userId: string;
  email: string;
  name: string;
  order: {
    id: string;
    status: string;
    items: Array<{ title: string; author: string; price: number }>;
    total: number;
    createdAt?: string;
  };
}

interface DeliveryUpdatedPayload {
  userId: string;
  email: string;
  name: string;
  phone?: string;
  delivery: {
    orderId: string;
    trackingCode?: string;
    status: string;
    estimatedDelivery?: string;
    trackingUrl?: string;
    notes?: string;
  };
}

interface PaymentConfirmedPayload {
  userId: string;
  email: string;
  name: string;
  payment: {
    id: string;
    amount: number;
    currency?: string;
    method?: string;
    orderId?: string;
    date?: string;
  };
}

const EXCHANGE = 'ebooks';
const EXCHANGE_TYPE = 'topic';

const QUEUES = {
  USER_REGISTERED: 'notification.user.registered',
  PASSWORD_RESET: 'notification.user.password-reset-requested',
  SUBSCRIPTION_EXPIRING: 'notification.subscription.expiring',
  ORDER_STATUS_CHANGED: 'notification.order.status-changed',
  DELIVERY_UPDATED: 'notification.delivery.updated',
  PAYMENT_CONFIRMED: 'notification.payment.confirmed',
} as const;

@Injectable()
export class RabbitMQConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQConsumerService.name);
  private connection: amqplib.Connection | null = null;
  private channel: amqplib.Channel | null = null;
  private isShuttingDown = false;

  constructor(
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly smsService: SmsService,
  ) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    await this.disconnect();
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

    // User registered
    await ch.assertQueue(QUEUES.USER_REGISTERED, { durable: true });
    await ch.bindQueue(QUEUES.USER_REGISTERED, EXCHANGE, QUEUES.USER_REGISTERED);
    await ch.consume(QUEUES.USER_REGISTERED, (msg) =>
      this.handleMessage(msg, (payload: UserRegisteredPayload) =>
        this.handleUserRegistered(payload),
      ),
    );

    // Password reset
    await ch.assertQueue(QUEUES.PASSWORD_RESET, { durable: true });
    await ch.bindQueue(QUEUES.PASSWORD_RESET, EXCHANGE, QUEUES.PASSWORD_RESET);
    await ch.consume(QUEUES.PASSWORD_RESET, (msg) =>
      this.handleMessage(msg, (payload: PasswordResetPayload) =>
        this.handlePasswordReset(payload),
      ),
    );

    // Subscription expiring
    await ch.assertQueue(QUEUES.SUBSCRIPTION_EXPIRING, { durable: true });
    await ch.bindQueue(QUEUES.SUBSCRIPTION_EXPIRING, EXCHANGE, QUEUES.SUBSCRIPTION_EXPIRING);
    await ch.consume(QUEUES.SUBSCRIPTION_EXPIRING, (msg) =>
      this.handleMessage(msg, (payload: SubscriptionExpiringPayload) =>
        this.handleSubscriptionExpiring(payload),
      ),
    );

    // Order status changed
    await ch.assertQueue(QUEUES.ORDER_STATUS_CHANGED, { durable: true });
    await ch.bindQueue(QUEUES.ORDER_STATUS_CHANGED, EXCHANGE, QUEUES.ORDER_STATUS_CHANGED);
    await ch.consume(QUEUES.ORDER_STATUS_CHANGED, (msg) =>
      this.handleMessage(msg, (payload: OrderStatusChangedPayload) =>
        this.handleOrderStatusChanged(payload),
      ),
    );

    // Delivery updated
    await ch.assertQueue(QUEUES.DELIVERY_UPDATED, { durable: true });
    await ch.bindQueue(QUEUES.DELIVERY_UPDATED, EXCHANGE, QUEUES.DELIVERY_UPDATED);
    await ch.consume(QUEUES.DELIVERY_UPDATED, (msg) =>
      this.handleMessage(msg, (payload: DeliveryUpdatedPayload) =>
        this.handleDeliveryUpdated(payload),
      ),
    );

    // Payment confirmed
    await ch.assertQueue(QUEUES.PAYMENT_CONFIRMED, { durable: true });
    await ch.bindQueue(QUEUES.PAYMENT_CONFIRMED, EXCHANGE, QUEUES.PAYMENT_CONFIRMED);
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
        // Nack without requeue to avoid infinite loop; dead-letter queue can handle it
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
    await Promise.all([
      this.emailService.sendSubscriptionExpiringEmail(
        payload.email,
        payload.name,
        payload.daysLeft,
        payload.renewUrl,
      ),
      this.notificationService.create({
        userId: payload.userId,
        type: NotificationType.SUBSCRIPTION_EXPIRING,
        title: 'Subscription Expiring Soon',
        body: `Your subscription expires in ${payload.daysLeft} day${payload.daysLeft !== 1 ? 's' : ''}. Renew to keep access.`,
        metadata: { subscriptionId: payload.subscriptionId, daysLeft: payload.daysLeft },
      }),
    ]);
  }

  private async handleOrderStatusChanged(payload: OrderStatusChangedPayload): Promise<void> {
    this.logger.log(`Handling order.status-changed for user ${payload.userId}`);
    await Promise.all([
      this.emailService.sendOrderConfirmationEmail(
        payload.email,
        payload.name,
        payload.order,
      ),
      this.notificationService.create({
        userId: payload.userId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'Order Status Updated',
        body: `Your order #${payload.order.id.substring(0, 8).toUpperCase()} is now ${payload.order.status}.`,
        metadata: { orderId: payload.order.id, status: payload.order.status },
      }),
    ]);
  }

  private async handleDeliveryUpdated(payload: DeliveryUpdatedPayload): Promise<void> {
    this.logger.log(`Handling delivery.updated for user ${payload.userId}`);

    const statusPt: Record<string, string> = {
      CREATED: 'criada',
      PICKING: 'em recolha',
      IN_TRANSIT: 'em trânsito',
      OUT_FOR_DELIVERY: 'em entrega',
      DELIVERED: 'entregue',
      FAILED: 'falhou',
      RETURNED: 'devolvida',
    };
    const statusLabel = statusPt[payload.delivery.status] ?? payload.delivery.status;
    const trackingRef = payload.delivery.trackingCode ?? payload.delivery.orderId.substring(0, 8).toUpperCase();

    const tasks: Promise<any>[] = [
      this.emailService.sendDeliveryUpdateEmail(
        payload.email,
        payload.name,
        payload.delivery,
      ),
      this.notificationService.create({
        userId: payload.userId,
        type: NotificationType.DELIVERY_UPDATE,
        title: 'Actualização de entrega',
        body: `A sua encomenda ${trackingRef} está ${statusLabel}.`,
        metadata: payload.delivery,
      }),
    ];

    if (payload.phone) {
      const smsMessage =
        `EBooksStore: A sua encomenda ${trackingRef} está ${statusLabel}` +
        (payload.delivery.notes ? ` — ${payload.delivery.notes}` : '') +
        `. Mais info: ebooks.co.mz`;
      tasks.push(this.smsService.send(payload.phone, smsMessage));
    }

    await Promise.all(tasks);
  }

  private async handlePaymentConfirmed(payload: PaymentConfirmedPayload): Promise<void> {
    this.logger.log(`Handling payment.confirmed for user ${payload.userId}`);
    await Promise.all([
      this.emailService.sendPaymentConfirmedEmail(
        payload.email,
        payload.name,
        payload.payment,
      ),
      this.notificationService.create({
        userId: payload.userId,
        type: NotificationType.PAYMENT_CONFIRMED,
        title: 'Payment Confirmed',
        body: `Your payment of $${payload.payment.amount.toFixed(2)} has been confirmed.`,
        metadata: payload.payment,
      }),
    ]);
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
