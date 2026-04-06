-- CreateTable
CREATE TABLE `draft_document_versions` (
    `id` VARCHAR(191) NOT NULL,
    `draft_document_id` VARCHAR(191) NOT NULL,
    `version_number` INTEGER NOT NULL,
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
    `created_by_user_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_draft_document_versions_doc_created`(`draft_document_id`, `created_at`),
    UNIQUE INDEX `uq_draft_document_version`(`draft_document_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `draft_document_versions` ADD CONSTRAINT `draft_document_versions_draft_document_id_fkey` FOREIGN KEY (`draft_document_id`) REFERENCES `draft_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
