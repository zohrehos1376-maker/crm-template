-- CreateTable
CREATE TABLE `pipelines` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closed_at` DATETIME(3) NULL,
    INDEX `pipelines_created_by_idx`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CreateTable
CREATE TABLE `pipeline_items` (
    `id` CHAR(36) NOT NULL,
    `pipeline_id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `stage` VARCHAR(16) NOT NULL DEFAULT 'message',
    `message_sent` BOOLEAN NOT NULL DEFAULT false,
    `result` VARCHAR(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `pipeline_items_lead_id_idx`(`lead_id`),
    UNIQUE INDEX `pipeline_items_pipeline_id_lead_id_key`(`pipeline_id`, `lead_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CreateTable
CREATE TABLE `pipeline_item_logs` (
    `id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `stage` VARCHAR(16) NOT NULL,
    `note` TEXT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `pipeline_item_logs_item_id_idx`(`item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- AddForeignKey
ALTER TABLE `pipelines` ADD CONSTRAINT `pipelines_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `pipeline_items` ADD CONSTRAINT `pipeline_items_pipeline_id_fkey` FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `pipeline_items` ADD CONSTRAINT `pipeline_items_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `pipeline_item_logs` ADD CONSTRAINT `pipeline_item_logs_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `pipeline_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `pipeline_item_logs` ADD CONSTRAINT `pipeline_item_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
