/*
  Warnings:

  - A unique constraint covering the columns `[user_id,case_id,assistant_message_id]` on the table `suggested_case_feedback` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updated_at` to the `suggested_case_feedback` table without a default value. This is not possible if the table is not empty.
  - Made the column `case_id` on table `suggested_case_feedback` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `suggested_case_feedback` ADD COLUMN `comment` TEXT NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `case_id` VARCHAR(64) NOT NULL;

-- CreateTable
CREATE TABLE `assistant_message_feedback` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `conversation_id` VARCHAR(191) NULL,
    `mode` VARCHAR(32) NOT NULL,
    `case_id` VARCHAR(64) NULL,
    `user_message_id` VARCHAR(191) NULL,
    `assistant_message_id` VARCHAR(191) NOT NULL,
    `reaction` ENUM('UP', 'DOWN') NULL,
    `comment` TEXT NULL,
    `fingerprint` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assistant_message_feedback_assistant_message_id_idx`(`assistant_message_id`),
    INDEX `assistant_message_feedback_case_id_idx`(`case_id`),
    UNIQUE INDEX `uq_assistant_feedback_user_message`(`user_id`, `assistant_message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `uq_suggested_case_feedback_user_case_assistant` ON `suggested_case_feedback`(`user_id`, `case_id`, `assistant_message_id`);
