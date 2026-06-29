import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { NotificationModule } from './notifications/notification.module';
import { EmailModule } from './email/email.module';
import { RabbitMQConsumerModule } from './rabbitmq/rabbitmq-consumer.module';
import { HealthController } from './health.controller';
import { SmsModule } from './sms/sms.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 30,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    EmailModule,
    NotificationModule,
    RabbitMQConsumerModule,
    SmsModule,
    SchedulerModule,
  ],
})
export class AppModule {}
