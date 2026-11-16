-- عنوان دلخواه نقش کاربر (فقط نمایشی؛ دسترسی‌ها جدا تعیین می‌شوند)
ALTER TABLE `users` ADD COLUMN `role_title` VARCHAR(40) NULL;
