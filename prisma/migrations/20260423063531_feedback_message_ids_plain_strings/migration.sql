-- DropForeignKey
ALTER TABLE `suggested_case_feedback` DROP FOREIGN KEY `suggested_case_feedback_assistant_message_id_fkey`;

-- DropForeignKey
ALTER TABLE `suggested_case_feedback` DROP FOREIGN KEY `suggested_case_feedback_user_message_id_fkey`;

-- DropIndex
DROP INDEX `suggested_case_feedback_assistant_message_id_fkey` ON `suggested_case_feedback`;

-- DropIndex
DROP INDEX `suggested_case_feedback_user_message_id_fkey` ON `suggested_case_feedback`;
