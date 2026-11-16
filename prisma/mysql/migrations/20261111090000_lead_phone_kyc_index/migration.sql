-- جست‌وجوی سریع مشتری با شماره و کارتابل احراز
CREATE INDEX `leads_phone_idx` ON `leads`(`phone`);
CREATE INDEX `leads_kyc_status_idx` ON `leads`(`kyc_status`);
