-- برچسب‌های دلخواه مشتری (چند مقدار) — در MySQL به‌صورت آرایه‌ی JSON نگهداری می‌شود.
ALTER TABLE `leads` ADD COLUMN `tags` JSON NULL;
