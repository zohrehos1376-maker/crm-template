-- AlterTable
ALTER TABLE `leads` ADD COLUMN `support_group_platform` VARCHAR(30) NULL,
    ADD COLUMN `support_group_name` VARCHAR(120) NULL,
    ADD COLUMN `support_group_link` VARCHAR(300) NULL,
    ADD COLUMN `support_group_members` TEXT NULL;
