-- AlterTable
ALTER TABLE `leads` ADD COLUMN `kyc_reason` TEXT NULL,
    ADD COLUMN `kyc_reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `kyc_reviewed_by` CHAR(36) NULL,
    ADD COLUMN `kyc_submitted_at` DATETIME(3) NULL,
    ADD COLUMN `kyc_token` VARCHAR(64) NULL,
    ADD COLUMN `kyc_token_expires_at` DATETIME(3) NULL,
    ADD COLUMN `national_id` VARCHAR(16) NULL;

-- CreateTable
CREATE TABLE `lead_audits` (
    `id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `action` VARCHAR(32) NOT NULL,
    `summary` VARCHAR(191) NULL,
    `changes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_audits_lead_id_created_at_idx`(`lead_id`, `created_at`),
    INDEX `lead_audits_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_tasks` (
    `id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `assignee_id` CHAR(36) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `topic` VARCHAR(64) NOT NULL,
    `note` TEXT NULL,
    `due_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `done_at` DATETIME(3) NULL,
    `done_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_tasks_assignee_id_status_due_at_idx`(`assignee_id`, `status`, `due_at`),
    INDEX `lead_tasks_lead_id_idx`(`lead_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_reports` (
    `id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NULL,
    `phone` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `details` TEXT NULL,
    `note` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `resolution` TEXT NULL,
    `created_by` CHAR(36) NOT NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_reports_status_created_at_idx`(`status`, `created_at`),
    INDEX `sales_reports_created_by_created_at_idx`(`created_by`, `created_at`),
    INDEX `sales_reports_lead_id_idx`(`lead_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_scripts` (
    `id` CHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'script',
    `topic` VARCHAR(64) NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` TEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sales_scripts_kind_is_active_sort_order_idx`(`kind`, `is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sms_logs` (
    `id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NULL,
    `phone` VARCHAR(32) NOT NULL,
    `topic` VARCHAR(64) NULL,
    `body` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `provider_ref` VARCHAR(191) NULL,
    `error` VARCHAR(191) NULL,
    `user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sms_logs_lead_id_idx`(`lead_id`),
    INDEX `sms_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_documents` (
    `id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `mime` VARCHAR(64) NOT NULL,
    `size` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `kyc_documents_lead_id_idx`(`lead_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `leads_kyc_token_key` ON `leads`(`kyc_token`);

-- AddForeignKey
ALTER TABLE `lead_audits` ADD CONSTRAINT `lead_audits_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_tasks` ADD CONSTRAINT `lead_tasks_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_reports` ADD CONSTRAINT `sales_reports_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sms_logs` ADD CONSTRAINT `sms_logs_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_documents` ADD CONSTRAINT `kyc_documents_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

