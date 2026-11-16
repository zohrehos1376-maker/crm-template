-- عکس فرم همکاری سایت روی خود سایت می‌ماند؛ CRM فقط آدرسش را نگه می‌دارد.
ALTER TABLE `kyc_documents` ADD COLUMN `source_url` VARCHAR(1000) NULL;
-- مدرکِ لینکی فایل روی دیسک ندارد، پس نام فایل می‌تواند خالی باشد
ALTER TABLE `kyc_documents` MODIFY `file_name` VARCHAR(191) NOT NULL DEFAULT '';
