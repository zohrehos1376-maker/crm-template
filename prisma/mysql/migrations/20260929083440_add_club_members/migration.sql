-- CreateTable
CREATE TABLE `club_members` (
    `id` CHAR(36) NOT NULL,
    `customer_name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `purchase_date` DATETIME(3) NULL,
    `purchased_model` VARCHAR(191) NULL,
    `birth_date` DATETIME(3) NULL,
    `rep_name` VARCHAR(191) NULL,
    `owner_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `club_members_owner_id_idx`(`owner_id`),
    INDEX `club_members_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

