-- CreateTable
CREATE TABLE `suggested_case_feedback` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `case_id` VARCHAR(64) NULL,
    `fingerprint` VARCHAR(500) NULL,
    `feedback` VARCHAR(16) NOT NULL,
    `user_message_id` VARCHAR(191) NULL,
    `assistant_message_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `suggested_case_feedback_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `suggested_case_feedback_case_id_idx`(`case_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `suggested_case_feedback` ADD CONSTRAINT `suggested_case_feedback_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suggested_case_feedback` ADD CONSTRAINT `suggested_case_feedback_user_message_id_fkey` FOREIGN KEY (`user_message_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suggested_case_feedback` ADD CONSTRAINT `suggested_case_feedback_assistant_message_id_fkey` FOREIGN KEY (`assistant_message_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
