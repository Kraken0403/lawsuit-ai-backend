-- DropForeignKey
ALTER TABLE `conversations` DROP FOREIGN KEY `conversations_user_id_fkey`;

-- DropIndex
DROP INDEX `conversations_user_id_updated_at_idx` ON `conversations`;

-- AlterTable
ALTER TABLE `conversations` ADD COLUMN `chat_mode` ENUM('JUDGMENT', 'DRAFTING_STUDIO', 'ARGUMENT') NOT NULL DEFAULT 'JUDGMENT';

-- AlterTable
ALTER TABLE `prompt_runs` ADD COLUMN `chat_mode` ENUM('JUDGMENT', 'DRAFTING_STUDIO', 'ARGUMENT') NULL;

-- CreateTable
CREATE TABLE `firm_settings` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `firmName` VARCHAR(200) NULL,
    `advocate_name` VARCHAR(200) NULL,
    `enrollment_number` VARCHAR(100) NULL,
    `address` TEXT NULL,
    `email` VARCHAR(320) NULL,
    `phone` VARCHAR(50) NULL,
    `website` VARCHAR(255) NULL,
    `logo_url` VARCHAR(500) NULL,
    `header_text` TEXT NULL,
    `footer_text` TEXT NULL,
    `signature_text` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `firm_settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `draft_templates` (
    `id` VARCHAR(191) NOT NULL,
    `owner_user_id` VARCHAR(191) NULL,
    `source` ENUM('SYSTEM', 'FIRM', 'SESSION_UPLOAD') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `family` VARCHAR(64) NOT NULL,
    `subtype` VARCHAR(120) NULL,
    `jurisdiction` VARCHAR(120) NULL,
    `forum` VARCHAR(120) NULL,
    `language` VARCHAR(50) NULL,
    `tags_json` JSON NULL,
    `use_when_json` JSON NULL,
    `not_for_json` JSON NULL,
    `summary` TEXT NULL,
    `precedent_strength` ENUM('STRONG', 'STANDARD', 'BASIC', 'LEGACY') NOT NULL DEFAULT 'STANDARD',
    `raw_text` LONGTEXT NOT NULL,
    `normalized_text` LONGTEXT NULL,
    `placeholders_json` JSON NULL,
    `clause_blocks_json` JSON NULL,
    `execution_requirements_json` JSON NULL,
    `risk_notes_json` JSON NULL,
    `source_ref` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `draft_templates_source_family_subtype_is_active_idx`(`source`, `family`, `subtype`, `is_active`),
    INDEX `draft_templates_owner_user_id_source_is_active_idx`(`owner_user_id`, `source`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `draft_documents` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NULL,
    `title` VARCHAR(255) NOT NULL,
    `family` VARCHAR(64) NOT NULL,
    `subtype` VARCHAR(120) NULL,
    `strategy` VARCHAR(64) NULL,
    `match_level` VARCHAR(32) NULL,
    `source_template_ids_json` JSON NULL,
    `input_data_json` JSON NULL,
    `drafting_plan_json` JSON NULL,
    `draft_markdown` LONGTEXT NULL,
    `draft_html` LONGTEXT NULL,
    `export_pdf_url` VARCHAR(500) NULL,
    `export_docx_url` VARCHAR(500) NULL,
    `status` ENUM('DRAFT', 'FINAL', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `draft_documents_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `draft_documents_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `draft_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `conversation_id` VARCHAR(191) NULL,
    `template_id` VARCHAR(191) NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(120) NOT NULL,
    `storage_url` VARCHAR(500) NOT NULL,
    `extracted_text` LONGTEXT NULL,
    `parsed_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `draft_attachments_user_id_conversation_id_created_at_idx`(`user_id`, `conversation_id`, `created_at`),
    INDEX `draft_attachments_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `conversations_user_id_chat_mode_updated_at_idx` ON `conversations`(`user_id`, `chat_mode`, `updated_at`);

-- CreateIndex
CREATE INDEX `prompt_runs_chat_mode_created_at_idx` ON `prompt_runs`(`chat_mode`, `created_at`);

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `firm_settings` ADD CONSTRAINT `firm_settings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `draft_templates` ADD CONSTRAINT `draft_templates_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `draft_documents` ADD CONSTRAINT `draft_documents_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `draft_documents` ADD CONSTRAINT `draft_documents_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `draft_attachments` ADD CONSTRAINT `draft_attachments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `draft_attachments` ADD CONSTRAINT `draft_attachments_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `draft_attachments` ADD CONSTRAINT `draft_attachments_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `draft_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
