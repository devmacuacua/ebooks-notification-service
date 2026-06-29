CREATE TYPE "NotificationType" AS ENUM (
    'SUBSCRIPTION_EXPIRING',
    'SUBSCRIPTION_EXPIRED',
    'SUBSCRIPTION_ACTIVATED',
    'ORDER_STATUS_CHANGED',
    'DELIVERY_UPDATE',
    'NEW_BOOK',
    'PAYMENT_CONFIRMED',
    'PAYMENT_FAILED'
);

CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "notifications" (
    "id"        UUID             NOT NULL DEFAULT gen_random_uuid(),
    "userId"    TEXT             NOT NULL,
    "type"      "NotificationType" NOT NULL,
    "title"     TEXT             NOT NULL,
    "body"      TEXT             NOT NULL,
    "isRead"    BOOLEAN          NOT NULL DEFAULT false,
    "metadata"  JSONB,
    "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

CREATE TABLE "email_logs" (
    "id"       UUID         NOT NULL DEFAULT gen_random_uuid(),
    "to"       TEXT         NOT NULL,
    "subject"  TEXT         NOT NULL,
    "template" TEXT         NOT NULL,
    "status"   "EmailStatus" NOT NULL,
    "sentAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error"    TEXT,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_devices" (
    "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
    "userId"    TEXT         NOT NULL,
    "token"     TEXT         NOT NULL,
    "platform"  TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");
CREATE INDEX "push_devices_userId_idx" ON "push_devices"("userId");
