-- CreateTable
CREATE TABLE `CaseSummary` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(64) NOT NULL,
    `fileName` VARCHAR(64) NULL,
    `title` TEXT NULL,
    `citation` VARCHAR(255) NULL,
    `summaryType` VARCHAR(32) NOT NULL,
    `sourceType` VARCHAR(32) NOT NULL DEFAULT 'qdrant',
    `sourceHash` VARCHAR(64) NOT NULL,
    `modelName` VARCHAR(100) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ready',
    `sectionsJson` JSON NOT NULL,
    `renderedMarkdown` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_case_summary_case_type`(`caseId`, `summaryType`),
    UNIQUE INDEX `uq_case_summary_case_type_hash`(`caseId`, `summaryType`, `sourceHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
