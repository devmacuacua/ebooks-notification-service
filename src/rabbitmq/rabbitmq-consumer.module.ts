import { Module } from '@nestjs/common';
import { RabbitMQConsumerService } from './rabbitmq-consumer.service';
import { EmailModule } from '../email/email.module';
import { NotificationModule } from '../notifications/notification.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [EmailModule, NotificationModule, SmsModule],
  providers: [RabbitMQConsumerService],
})
export class RabbitMQConsumerModule {}
