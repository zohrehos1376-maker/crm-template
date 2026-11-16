-- AlterTable
ALTER TABLE `leads` ADD COLUMN `kyc_reject_notified_at` DATETIME(3) NULL,
    ADD COLUMN `first_purchase_at` DATETIME(3) NULL;
