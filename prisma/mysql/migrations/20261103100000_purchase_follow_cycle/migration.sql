-- چرخه‌ی پیگیری بعد از خرید (۲ روز / ۵-۷ روز / هر ۲ هفته)
ALTER TABLE `leads` ADD COLUMN `last_purchase_at` DATETIME(3) NULL;
ALTER TABLE `leads` ADD COLUMN `purchase_follow_step` VARCHAR(16) NULL;
