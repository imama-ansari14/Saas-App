-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "primaryDomain" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'pilot',
    "metaAdAccountId" TEXT,
    "metaTokenEnc" TEXT,
    "metaPixelId" TEXT,
    "capiTokenEnc" TEXT,
    "capiTestCode" TEXT,
    "capiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sendConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "sendDelivered" BOOLEAN NOT NULL DEFAULT true,
    "sendReturned" BOOLEAN NOT NULL DEFAULT true,
    "deliveredSource" TEXT NOT NULL DEFAULT 'website',
    "confirmTags" TEXT NOT NULL DEFAULT 'confirmed,order confirmed,whatsapp confirmed',
    "confirmOnBooking" BOOLEAN NOT NULL DEFAULT true,
    "postexTokenEnc" TEXT,
    "leopardsKeyEnc" TEXT,
    "leopardsPassEnc" TEXT,
    "webPixelId" TEXT,
    "backfillDone" BOOLEAN NOT NULL DEFAULT false,
    "backfillCursor" TEXT,
    "backfillSince" TIMESTAMP(3),
    "lastOrderSyncAt" TIMESTAMP(3),
    "lastCourierSyncAt" TIMESTAMP(3),
    "lastMetaSyncAt" TIMESTAMP(3),
    "metaBackfillDone" BOOLEAN NOT NULL DEFAULT false,
    "lastCapiRunAt" TIMESTAMP(3),
    "lastStatusRunAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "isCod" BOOLEAN NOT NULL DEFAULT true,
    "financialStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "tags" TEXT[],
    "city" TEXT,
    "cityLabel" TEXT,
    "countryCode" TEXT DEFAULT 'pk',
    "itemCount" INTEGER NOT NULL DEFAULT 1,
    "phoneHash" TEXT,
    "emailHash" TEXT,
    "fnHash" TEXT,
    "lnHash" TEXT,
    "externalIdHash" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "landingPage" TEXT,
    "fbclid" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "userAgent" TEXT,
    "clientIp" TEXT,
    "sourceUrl" TEXT,
    "trackingNumbers" TEXT[],
    "trackingCompany" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'NOT_DISPATCHED',
    "statusAt" TIMESTAMP(3),
    "courier" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT,
    "courier" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "orderRef" TEXT,
    "rawStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "statusAt" TIMESTAMP(3),
    "codAmount" DOUBLE PRECISION,
    "city" TEXT,
    "settled" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'api',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdDaily" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "adsetId" TEXT,
    "adsetName" TEXT,
    "adId" TEXT NOT NULL,
    "adName" TEXT NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL,
    "purchases" DOUBLE PRECISION NOT NULL,
    "purchaseValue" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutSignal" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "fbp" TEXT,
    "fbc" TEXT,
    "userAgent" TEXT,
    "pageUrl" TEXT,
    "clientId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapiEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "sentAt" TIMESTAMP(3),
    "response" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "detail" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "Order_shopId_createdAt_idx" ON "Order"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_shopId_name_idx" ON "Order"("shopId", "name");

-- CreateIndex
CREATE INDEX "Order_shopId_status_idx" ON "Order"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopId_shopifyId_key" ON "Order"("shopId", "shopifyId");

-- CreateIndex
CREATE INDEX "Shipment_shopId_orderRef_idx" ON "Shipment"("shopId", "orderRef");

-- CreateIndex
CREATE INDEX "Shipment_shopId_status_idx" ON "Shipment"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shopId_courier_trackingNumber_key" ON "Shipment"("shopId", "courier", "trackingNumber");

-- CreateIndex
CREATE INDEX "AdDaily_shopId_date_idx" ON "AdDaily"("shopId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdDaily_shopId_date_adId_key" ON "AdDaily"("shopId", "date", "adId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSignal_shopId_shopifyId_key" ON "CheckoutSignal"("shopId", "shopifyId");

-- CreateIndex
CREATE INDEX "CapiEvent_shopId_status_idx" ON "CapiEvent"("shopId", "status");

-- CreateIndex
CREATE INDEX "CapiEvent_shopId_createdAt_idx" ON "CapiEvent"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CapiEvent_shopId_eventId_key" ON "CapiEvent"("shopId", "eventId");

-- CreateIndex
CREATE INDEX "JobRun_shopId_startedAt_idx" ON "JobRun"("shopId", "startedAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdDaily" ADD CONSTRAINT "AdDaily_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSignal" ADD CONSTRAINT "CheckoutSignal_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapiEvent" ADD CONSTRAINT "CapiEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
