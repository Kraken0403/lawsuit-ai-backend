-- AlterTable
ALTER TABLE `firm_settings` ADD COLUMN `drafting_branding_mode` ENUM('NONE', 'HEADER_FOOTER', 'LETTERHEAD') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `drafting_default_forum` VARCHAR(120) NULL,
    ADD COLUMN `drafting_default_jurisdiction` VARCHAR(120) NULL,
    ADD COLUMN `drafting_default_tone` VARCHAR(50) NULL,
    ADD COLUMN `drafting_footer_height_px` INTEGER NULL,
    ADD COLUMN `drafting_footer_image_url` VARCHAR(500) NULL,
    ADD COLUMN `drafting_header_height_px` INTEGER NULL,
    ADD COLUMN `drafting_header_image_url` VARCHAR(500) NULL,
    ADD COLUMN `drafting_letterhead_height_px` INTEGER NULL,
    ADD COLUMN `drafting_letterhead_image_url` VARCHAR(500) NULL,
    ADD COLUMN `drafting_lock_branding` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `drafting_signature_image_url` VARCHAR(500) NULL;
