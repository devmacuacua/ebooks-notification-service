import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { NotificationModule } from './notifications/notification.module';
import { EmailModule } from './email/email.module';
import { RabbitMQConsumerModule } from './rabbitmq/rabbitmq-consumer.module';
import { HealthController } from './health.controller';
import { SmsModule } from './sms/sms.module';

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
    PrismaModule,
    EmailModule,
    NotificationModule,
    RabbitMQConsumerModule,
    SmsModule,
  ],
})
export class AppModule {}
