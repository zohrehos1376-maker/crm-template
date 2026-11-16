-- معادل دو migration نسخه‌ی PostgreSQL (add_followup_message_flags و add_followup_step)
-- که فقط برای PostgreSQL نوشته شده بودند؛ این فایل MySQL را هم به همان ساختار می‌رساند.
-- فقط ستون/ایندکس اضافه می‌کند؛ هیچ داده‌ای پاک یا تغییر نمی‌کند.

-- AlterTable
ALTER TABLE `followups` ADD COLUMN `message_sent` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `step` VARCHAR(16) NULL,
    ADD COLUMN `via_social_media` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX `followups_lead_id_step_key` ON `followups`(`lead_id`, `step`);
