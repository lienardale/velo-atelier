-- AlterTable
ALTER TABLE "CheckupItem" ADD COLUMN     "reasonKeys" VARCHAR(80)[] DEFAULT ARRAY[]::VARCHAR(80)[];

-- AlterTable
ALTER TABLE "BuildListItem" ADD COLUMN     "doneReason" VARCHAR(16);
