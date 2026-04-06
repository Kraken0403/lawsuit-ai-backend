import prisma from "../lib/prisma.js";
import { normalizeText } from "../drafting/utils.js";

type SeedTemplate = {
  title: string;
  family: string;
  subtype: string;
  summary: string;
  tags: string[];
  useWhen: string[];
  notFor: string[];
  rawText: string;
  placeholders: Array<Record<string, unknown>>;
  clauseBlocks: Array<Record<string, unknown>>;
  executionRequirements: Record<string, unknown>;
  riskNotes: string[];
  sourceRef: string;
};

const templates: SeedTemplate[] = [
  {
    title: "Acknowledgement of Debt",
    family: "acknowledgement",
    subtype: "acknowledgement_of_debt",
    summary:
      "Used where a debtor acknowledges an existing debt in writing.",
    tags: ["debt", "acknowledgement", "money lent", "limitation"],
    useWhen: [
      "debtor admits liability",
      "debt needs to be acknowledged in writing",
    ],
    notFor: ["secured mortgage enforcement pleadings"],
    rawText:
      "I [debtor_name] of [debtor_address] hereby acknowledge that I am indebted to [creditor_name] of [creditor_address] in the sum of Rs. [amount] being [basis_of_debt]. Dated [date]. [signature_block]",
    placeholders: [
      { key: "debtor_name", label: "Debtor name", type: "text", required: true },
      { key: "debtor_address", label: "Debtor address", type: "address", required: true },
      { key: "creditor_name", label: "Creditor name", type: "text", required: true },
      { key: "creditor_address", label: "Creditor address", type: "address", required: true },
      { key: "amount", label: "Amount", type: "amount", required: true },
      { key: "basis_of_debt", label: "Basis of debt", type: "long_text", required: true },
      { key: "date", label: "Date", type: "date", required: true },
    ],
    clauseBlocks: [
      {
        id: "title",
        name: "Title",
        kind: "title",
        required: true,
        text: "Acknowledgement of Debt",
        variablesUsed: [],
      },
      {
        id: "body",
        name: "Body",
        kind: "liability",
        required: true,
        text: "I [debtor_name] of [debtor_address] hereby acknowledge that I am indebted to [creditor_name] of [creditor_address] in the sum of Rs. [amount] being [basis_of_debt].",
        variablesUsed: [
          "debtor_name",
          "debtor_address",
          "creditor_name",
          "creditor_address",
          "amount",
          "basis_of_debt",
        ],
      },
      {
        id: "signature",
        name: "Signature",
        kind: "signature",
        required: true,
        text: "Dated [date]\n[signature_block]",
        variablesUsed: ["date", "signature_block"],
      },
    ],
    executionRequirements: {
      witnessesRequired: false,
      registrationRequired: false,
      stampReviewRecommended: true,
    },
    riskNotes: [
      "Check limitation implications before use.",
      "Review whether the wording creates only an acknowledgement or also a promise to pay.",
    ],
    sourceRef: "V1_CH18 Form 1",
  },
  {
    title: "IOU / Simple Acknowledgement of Indebtedness",
    family: "acknowledgement",
    subtype: "iou_simple_indebtedness",
    summary:
      "Short IOU-style acknowledgement of indebtedness.",
    tags: ["iou", "indebtedness", "acknowledgement"],
    useWhen: [
      "simple acknowledgement is enough",
      "brief written evidence of indebtedness is required",
    ],
    notFor: ["detailed secured transactions"],
    rawText:
      "To [creditor_name] of [creditor_address]. I.O.U. the sum of Rs. [amount] ([amount_words]). Signed by [debtor_name] of [debtor_address] on [date].",
    placeholders: [
      { key: "creditor_name", label: "Creditor name", type: "text", required: true },
      { key: "creditor_address", label: "Creditor address", type: "address", required: true },
      { key: "amount", label: "Amount", type: "amount", required: true },
      { key: "amount_words", label: "Amount in words", type: "text", required: true },
      { key: "debtor_name", label: "Debtor name", type: "text", required: true },
      { key: "debtor_address", label: "Debtor address", type: "address", required: true },
      { key: "date", label: "Date", type: "date", required: true },
    ],
    clauseBlocks: [],
    executionRequirements: {
      witnessesRequired: false,
      registrationRequired: false,
      stampReviewRecommended: true,
    },
    riskNotes: [
      "This is a simple acknowledgement format and may not amount to a full payment agreement.",
    ],
    sourceRef: "V1_CH18 Form 3",
  },
  {
    title: "Acknowledgement of Unsecured Non-Interest Bearing Loan",
    family: "acknowledgement",
    subtype: "unsecured_loan_acknowledgement",
    summary:
      "Used where borrower acknowledges receipt of an unsecured loan and agrees to repay.",
    tags: ["loan", "unsecured", "acknowledgement", "repayment"],
    useWhen: [
      "loan is unsecured",
      "borrower acknowledges receipt and repayment obligation",
    ],
    notFor: ["mortgage-backed lending"],
    rawText:
      "I [debtor_name] of [debtor_address] hereby acknowledge that [creditor_name] of [creditor_address] has advanced to me the sum of Rs. [amount] ([amount_words]) by way of loan free of interest and I agree to repay the same on demand. Dated [date]. [signature_block]",
    placeholders: [
      { key: "debtor_name", label: "Borrower name", type: "text", required: true },
      { key: "debtor_address", label: "Borrower address", type: "address", required: true },
      { key: "creditor_name", label: "Lender name", type: "text", required: true },
      { key: "creditor_address", label: "Lender address", type: "address", required: true },
      { key: "amount", label: "Amount", type: "amount", required: true },
      { key: "amount_words", label: "Amount in words", type: "text", required: true },
      { key: "date", label: "Date", type: "date", required: true },
    ],
    clauseBlocks: [],
    executionRequirements: {
      witnessesRequired: false,
      registrationRequired: false,
      stampReviewRecommended: true,
    },
    riskNotes: [
      "Review stamp implications if this wording functions as a promissory note.",
    ],
    sourceRef: "V1_CH18 Form 4",
  },
  {
    title: "Acknowledgement of Part Payment",
    family: "acknowledgement",
    subtype: "part_payment_acknowledgement",
    summary:
      "Used to record part payment of an existing debt or pronote amount.",
    tags: ["part payment", "debt", "pronote", "acknowledgement"],
    useWhen: [
      "debtor has paid part of a larger outstanding amount",
      "part payment needs documentary record",
    ],
    notFor: ["full and final settlement documents"],
    rawText:
      "I [debtor_name] of [debtor_address] hereby acknowledge that on [date] I paid a sum of Rs. [paid_amount] in part payment of the debt of Rs. [total_debt] borrowed by me from [creditor_name] of [creditor_address] on a pronote dated [pronote_date]. [signature_block]",
    placeholders: [
      { key: "debtor_name", label: "Debtor name", type: "text", required: true },
      { key: "debtor_address", label: "Debtor address", type: "address", required: true },
      { key: "paid_amount", label: "Part payment amount", type: "amount", required: true },
      { key: "total_debt", label: "Total debt", type: "amount", required: true },
      { key: "creditor_name", label: "Creditor name", type: "text", required: true },
      { key: "creditor_address", label: "Creditor address", type: "address", required: true },
      { key: "pronote_date", label: "Pronote date", type: "date", required: true },
      { key: "date", label: "Acknowledgement date", type: "date", required: true },
    ],
    clauseBlocks: [],
    executionRequirements: {
      witnessesRequired: false,
      registrationRequired: false,
      stampReviewRecommended: false,
    },
    riskNotes: [
      "Ensure the reference instrument details are accurate.",
    ],
    sourceRef: "V1_CH18 Form 6",
  },
  {
    title: "Acknowledgement to Extend Limitation",
    family: "acknowledgement",
    subtype: "limitation_extension_acknowledgement",
    summary:
      "Letter-style acknowledgement confirming liability and inability to pay immediately.",
    tags: ["limitation", "acknowledgement", "debt", "letter"],
    useWhen: [
      "liability is acknowledged in a letter form",
      "party is unable to pay immediately but admits correctness",
    ],
    notFor: ["final settlement letters"],
    rawText:
      "Dear Sir/Madam, I acknowledge receipt of your demand regarding the sum of Rs. [amount]. I regret my inability to make payment immediately, but I acknowledge the correctness of the amount and my liability to pay the same. Dated [date]. Yours faithfully, [debtor_name]",
    placeholders: [
      { key: "amount", label: "Amount", type: "amount", required: true },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "debtor_name", label: "Debtor name", type: "text", required: true },
    ],
    clauseBlocks: [],
    executionRequirements: {
      witnessesRequired: false,
      registrationRequired: false,
      stampReviewRecommended: false,
    },
    riskNotes: [
      "Check limitation consequences before sending this letter.",
    ],
    sourceRef: "V1_CH18 Form 8",
  },
];

async function upsertSystemTemplate(template: SeedTemplate) {
  const existing = await prisma.draftTemplate.findFirst({
    where: {
      source: "SYSTEM",
      ownerUserId: null,
      title: template.title,
      family: template.family,
      subtype: template.subtype,
    },
    select: {
      id: true,
    },
  });

  const data = {
    ownerUserId: null,
    source: "SYSTEM" as const,
    title: template.title,
    family: template.family,
    subtype: template.subtype,
    summary: template.summary,
    tagsJson: template.tags,
    useWhenJson: template.useWhen,
    notForJson: template.notFor,
    precedentStrength: "STANDARD" as const,
    rawText: template.rawText,
    normalizedText: normalizeText(template.rawText),
    placeholdersJson: template.placeholders,
    clauseBlocksJson: template.clauseBlocks,
    executionRequirementsJson: template.executionRequirements,
    riskNotesJson: template.riskNotes,
    sourceRef: template.sourceRef,
    isActive: true,
  };

  if (existing) {
    await prisma.draftTemplate.update({
      where: { id: existing.id },
      data,
    });
    console.log(`Updated: ${template.title}`);
    return;
  }

  await prisma.draftTemplate.create({
    data,
  });
  console.log(`Created: ${template.title}`);
}

async function main() {
  for (const template of templates) {
    await upsertSystemTemplate(template);
  }

  console.log(`Seeded ${templates.length} drafting templates.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });