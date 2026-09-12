-- Hand-written (see prisma/schema.prisma and tests/unit/db/init-migration.test.ts):
-- "User"."email" is CITEXT, so the extension must exist before any table does.
-- Prisma 7 no longer emits extension DDL (postgresqlExtensions is deprecated).
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "UserLocale" AS ENUM ('fr', 'en');

-- CreateEnum
CREATE TYPE "PartStatus" AS ENUM ('OK', 'ATTENTION', 'BROKEN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CheckupScope" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "CheckupStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "CheckupResult" AS ENUM ('OK', 'KO', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BuildListStatus" AS ENUM ('OPEN', 'DONE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BuildAction" AS ENUM ('REPLACE', 'FIX', 'CLEAN', 'ADJUST', 'INSPECT_SHOP');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT,
    "email" CITEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" VARCHAR(72),
    "locale" "UserLocale" NOT NULL DEFAULT 'fr',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "AuthAttempt" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Bike" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "answers" JSONB NOT NULL,
    "spec" JSONB NOT NULL,
    "specVersion" INTEGER NOT NULL DEFAULT 1,
    "parts" JSONB NOT NULL,
    "fit" JSONB,
    "guestLocalId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BikePartState" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bikeId" UUID NOT NULL,
    "partId" VARCHAR(64) NOT NULL,
    "status" "PartStatus" NOT NULL DEFAULT 'UNKNOWN',
    "installedAt" TIMESTAMP(3),
    "lastServicedAt" TIMESTAMP(3),
    "notes" VARCHAR(2000),
    "installed" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BikePartState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkup" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bikeId" UUID NOT NULL,
    "scope" "CheckupScope" NOT NULL,
    "status" "CheckupStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "guestKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Checkup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckupItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkupId" UUID NOT NULL,
    "stepKey" VARCHAR(160) NOT NULL,
    "partId" VARCHAR(64) NOT NULL,
    "guideSlug" VARCHAR(160) NOT NULL,
    "result" "CheckupResult" NOT NULL DEFAULT 'SKIPPED',
    "notes" VARCHAR(2000),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckupItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildList" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bikeId" UUID NOT NULL,
    "checkupId" UUID,
    "name" VARCHAR(80) NOT NULL,
    "status" "BuildListStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildListItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildListId" UUID NOT NULL,
    "checkupItemId" UUID,
    "partId" VARCHAR(64) NOT NULL,
    "action" "BuildAction" NOT NULL,
    "reasonKey" VARCHAR(80) NOT NULL,
    "guideSlug" VARCHAR(160),
    "refinement" JSONB,
    "chosenProduct" JSONB,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuthAttempt_windowStart_idx" ON "AuthAttempt"("windowStart");

-- CreateIndex
CREATE INDEX "Bike_userId_updatedAt_idx" ON "Bike"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Bike_userId_guestLocalId_key" ON "Bike"("userId", "guestLocalId");

-- CreateIndex
CREATE INDEX "BikePartState_bikeId_status_idx" ON "BikePartState"("bikeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BikePartState_bikeId_partId_key" ON "BikePartState"("bikeId", "partId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkup_guestKey_key" ON "Checkup"("guestKey");

-- CreateIndex
CREATE INDEX "Checkup_bikeId_startedAt_idx" ON "Checkup"("bikeId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "CheckupItem_checkupId_result_idx" ON "CheckupItem"("checkupId", "result");

-- CreateIndex
CREATE UNIQUE INDEX "CheckupItem_checkupId_stepKey_key" ON "CheckupItem"("checkupId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "BuildList_checkupId_key" ON "BuildList"("checkupId");

-- CreateIndex
CREATE INDEX "BuildList_bikeId_status_idx" ON "BuildList"("bikeId", "status");

-- CreateIndex
CREATE INDEX "BuildListItem_buildListId_done_sortOrder_idx" ON "BuildListItem"("buildListId", "done", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BuildListItem_buildListId_partId_action_key" ON "BuildListItem"("buildListId", "partId", "action");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bike" ADD CONSTRAINT "Bike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikePartState" ADD CONSTRAINT "BikePartState_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkup" ADD CONSTRAINT "Checkup_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckupItem" ADD CONSTRAINT "CheckupItem_checkupId_fkey" FOREIGN KEY ("checkupId") REFERENCES "Checkup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildList" ADD CONSTRAINT "BuildList_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildList" ADD CONSTRAINT "BuildList_checkupId_fkey" FOREIGN KEY ("checkupId") REFERENCES "Checkup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildListItem" ADD CONSTRAINT "BuildListItem_buildListId_fkey" FOREIGN KEY ("buildListId") REFERENCES "BuildList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildListItem" ADD CONSTRAINT "BuildListItem_checkupItemId_fkey" FOREIGN KEY ("checkupItemId") REFERENCES "CheckupItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
