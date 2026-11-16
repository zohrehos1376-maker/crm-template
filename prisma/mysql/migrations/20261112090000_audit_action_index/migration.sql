-- گزارشات فروش: خواندن سریع فاکتورها بر اساس نوع رویداد
CREATE INDEX `lead_audits_action_created_at_idx` ON `lead_audits`(`action`, `created_at`);
