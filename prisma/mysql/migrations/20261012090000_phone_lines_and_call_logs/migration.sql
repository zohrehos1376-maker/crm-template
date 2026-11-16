-- CreateTable
CREATE TABLE `phone_lines` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `branch` VARCHAR(120) NULL,
    `sim_number` VARCHAR(32) NULL,
    `token_hash` VARCHAR(128) NULL,
    `pairing_code` VARCHAR(16) NULL,
    `pairing_expires_at` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_seen_at` DATETIME(3) NULL,
    `app_version` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `phone_lines_token_hash_key`(`token_hash`),
    UNIQUE INDEX `phone_lines_pairing_code_key`(`pairing_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `call_logs` (
    `id` CHAR(36) NOT NULL,
    `phone_line_id` CHAR(36) NOT NULL,
    `external_id` VARCHAR(64) NOT NULL,
    `phone_raw` VARCHAR(64) NOT NULL,
    `phone_normalized` VARCHAR(32) NOT NULL,
    `direction` VARCHAR(16) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `duration_sec` INTEGER NOT NULL DEFAULT 0,
    `lead_id` CHAR(36) NULL,
    `operator_user_id` CHAR(36) NULL,
    `caller_name` VARCHAR(191) NULL,
    `heard_from` VARCHAR(64) NULL,
    `note` TEXT NULL,
    `follow_up_at` DATETIME(3) NULL,
    `log_status` VARCHAR(16) NOT NULL DEFAULT 'UNLOGGED',
    `callback_done` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `call_logs_phone_normalized_idx`(`phone_normalized`),
    INDEX `call_logs_lead_id_idx`(`lead_id`),
    INDEX `call_logs_started_at_idx`(`started_at`),
    INDEX `call_logs_operator_user_id_idx`(`operator_user_id`),
    UNIQUE INDEX `call_logs_phone_line_id_external_id_key`(`phone_line_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `call_logs` ADD CONSTRAINT `call_logs_phone_line_id_fkey` FOREIGN KEY (`phone_line_id`) REFERENCES `phone_lines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `call_logs` ADD CONSTRAINT `call_logs_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `call_logs` ADD CONSTRAINT `call_logs_operator_user_id_fkey` FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

