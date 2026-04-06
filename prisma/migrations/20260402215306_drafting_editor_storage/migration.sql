-- AlterTable
ALTER TABLE `draft_document_versions` ADD COLUMN `editor_json` JSON NULL,
    ADD COLUMN `unresolved_placeholders_json` JSON NULL;

-- AlterTable
ALTER TABLE `draft_documents` ADD COLUMN `editor_json` JSON NULL,
    ADD COLUMN `unresolved_placeholders_json` JSON NULL;
