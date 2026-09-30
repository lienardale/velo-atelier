-- DropIndex
DROP INDEX "BuildList_checkupId_key";

-- CreateIndex
CREATE INDEX "BuildList_checkupId_idx" ON "BuildList"("checkupId");

