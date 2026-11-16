-- AlterTable
ALTER TABLE `club_members` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `customer_code` VARCHAR(32) NULL,
    ADD COLUMN `customer_status` VARCHAR(64) NULL,
    ADD COLUMN `first_purchase_date` DATETIME(3) NULL,
    ADD COLUMN `national_id` VARCHAR(16) NULL,
    ADD COLUMN `national_id_status` VARCHAR(64) NULL,
    ADD COLUMN `warnings` TEXT NULL;

-- CreateTable
CREATE TABLE `club_purchases` (
    `id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `invoice_no` VARCHAR(32) NULL,
    `date` DATETIME(3) NULL,
    `sale_type` VARCHAR(32) NOT NULL,
    `brand` VARCHAR(64) NULL,
    `model` VARCHAR(128) NULL,
    `vehicle` VARCHAR(191) NULL,
    `year` INTEGER NULL,
    `color` VARCHAR(64) NULL,
    `vin` VARCHAR(64) NULL,
    `amount` BIGINT NULL,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `club_purchases_member_id_idx`(`member_id`),
    INDEX `club_purchases_vin_idx`(`vin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `club_members_customer_code_key` ON `club_members`(`customer_code`);

-- AddForeignKey
ALTER TABLE `club_purchases` ADD CONSTRAINT `club_purchases_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `club_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

