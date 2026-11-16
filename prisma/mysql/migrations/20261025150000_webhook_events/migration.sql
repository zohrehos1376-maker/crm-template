-- CreateTable
CREATE TABLE `webhook_events` (
    `id` VARCHAR(120) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `lead_id` CHAR(36) NULL,
    `summary` VARCHAR(191) NULL,
    `payload` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_events_source_created_at_idx`(`source`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

