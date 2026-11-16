CREATE TABLE `branches` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `full_name` VARCHAR(191) NOT NULL,
    `role` ENUM('rep', 'manager') NOT NULL DEFAULT 'rep',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `branch_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_branch_id_idx`(`branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `leads` (
    `id` CHAR(36) NOT NULL,
    `customer_name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NULL,
    `preferred_contact` JSON NOT NULL,
    `payment_terms` VARCHAR(191) NULL,
    `delivery_type` VARCHAR(191) NULL,
    `current_car` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'جدید',
    `cancel_reason` TEXT NULL,
    `notes` TEXT NULL,
    `owner_id` CHAR(36) NOT NULL,
    `branch_id` CHAR(36) NULL,
    `price_from` BIGINT NULL,
    `price_to` BIGINT NULL,
    `next_follow_up_date` DATETIME(3) NULL,
    `next_follow_up_note` TEXT NULL,
    `sold_company` VARCHAR(191) NULL,
    `sold_model` VARCHAR(191) NULL,
    `sold_price` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `leads_owner_id_idx`(`owner_id`),
    INDEX `leads_branch_id_idx`(`branch_id`),
    INDEX `leads_status_idx`(`status`),
    INDEX `leads_created_at_idx`(`created_at`),
    INDEX `leads_next_follow_up_date_idx`(`next_follow_up_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lead_vehicles` (
    `id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `company` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `body_type` VARCHAR(191) NULL,
    `available` VARCHAR(191) NULL,
    `package` TEXT NULL,
    INDEX `lead_vehicles_lead_id_idx`(`lead_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `followups` (
    `id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `followup_date` DATETIME(3) NOT NULL,
    `content` TEXT NOT NULL,
    `outcome` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `followups_lead_id_idx`(`lead_id`),
    INDEX `followups_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lead_status_history` (
    `id` CHAR(36) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `old_status` VARCHAR(191) NULL,
    `new_status` VARCHAR(191) NOT NULL,
    `changed_by` CHAR(36) NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `lead_status_history_lead_id_idx`(`lead_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vehicle_inventory` (
    `id` CHAR(36) NOT NULL,
    `company` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `year` INTEGER NULL,
    `color` VARCHAR(191) NULL,
    `price` BIGINT NULL,
    `available` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(36) NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `settings` (
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(36) NULL,
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `session` (
    `sid` VARCHAR(191) NOT NULL,
    `sess` JSON NOT NULL,
    `expire` DATETIME(6) NOT NULL,
    INDEX `IDX_session_expire`(`expire`),
    PRIMARY KEY (`sid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users` ADD CONSTRAINT `users_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `leads` ADD CONSTRAINT `leads_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `leads` ADD CONSTRAINT `leads_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `lead_vehicles` ADD CONSTRAINT `lead_vehicles_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `followups` ADD CONSTRAINT `followups_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `followups` ADD CONSTRAINT `followups_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `lead_status_history` ADD CONSTRAINT `lead_status_history_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `lead_status_history` ADD CONSTRAINT `lead_status_history_changed_by_fkey` FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `vehicle_inventory` ADD CONSTRAINT `vehicle_inventory_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `settings` ADD CONSTRAINT `settings_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
