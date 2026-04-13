/*
  Warnings:

  - A unique constraint covering the columns `[external_user_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `users` ADD COLUMN `allowed_court_ids_json` JSON NULL,
    ADD COLUMN `auth_provider` VARCHAR(50) NOT NULL DEFAULT 'local',
    ADD COLUMN `external_user_id` VARCHAR(120) NULL,
    ADD COLUMN `has_ai_access` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `subscription_status` VARCHAR(50) NULL,
    ADD COLUMN `username` VARCHAR(120) NULL,
    MODIFY `email` VARCHAR(320) NULL,
    MODIFY `password_hash` VARCHAR(255) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_external_user_id_key` ON `users`(`external_user_id`);
