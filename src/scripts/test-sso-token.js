import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const secret = process.env.SSO_HS256_SECRET || "logionsolutions";
const issuer = process.env.SSO_JWT_ISSUER || "https://lawsuitcasefinder.com";
const audience = process.env.SSO_JWT_AUDIENCE || "lawsuit-ai";

const now = Math.floor(Date.now() / 1000);

const allowedCourts = [
  { id: 1001, title: "India", subid: 1, subtitle: "Supreme Court" },
  { id: 1001, title: "India", subid: 2, subtitle: "Delhi" },
  { id: 1001, title: "India", subid: 3, subtitle: "Bombay" },
  { id: 1001, title: "India", subid: 4, subtitle: "Gujarat" },
  { id: 1001, title: "India", subid: 5, subtitle: "Allahabad" },
  { id: 1001, title: "India", subid: 6, subtitle: "Gauhati" },
  { id: 1001, title: "India", subid: 7, subtitle: "Punjab & Haryana" },
  { id: 1001, title: "India", subid: 8, subtitle: "Madras" },
  { id: 1001, title: "India", subid: 9, subtitle: "Andhra Pradesh" },
  { id: 1001, title: "India", subid: 10, subtitle: "Karnataka" },
  { id: 1001, title: "India", subid: 11, subtitle: "Calcutta" },
  { id: 1001, title: "India", subid: 12, subtitle: "Madhya Pradesh" },
  { id: 1001, title: "India", subid: 13, subtitle: "Kerala" },
  { id: 1001, title: "India", subid: 14, subtitle: "Patna" },
  { id: 1001, title: "India", subid: 15, subtitle: "Orissa" },
  { id: 1001, title: "India", subid: 16, subtitle: "Rajasthan" },
  { id: 1001, title: "India", subid: 17, subtitle: "Jharkhand" },
  { id: 1001, title: "India", subid: 18, subtitle: "Himachal Pradesh" },
  { id: 1001, title: "India", subid: 19, subtitle: "Jammu & Kashmir" },
  { id: 1001, title: "India", subid: 20, subtitle: "Sikkim" },
  { id: 1001, title: "India", subid: 21, subtitle: "Chhattisgarh" },
  { id: 1001, title: "India", subid: 22, subtitle: "Uttaranchal" },
  { id: 1001, title: "India", subid: 24, subtitle: "Privy Council" },
  { id: 1001, title: "India", subid: 25, subtitle: "Federal" },
  { id: 1001, title: "India", subid: 26, subtitle: "Nagpur" },
  { id: 1001, title: "India", subid: 27, subtitle: "Lahore" },
  { id: 1001, title: "India", subid: 28, subtitle: "Sindh" },
  { id: 1001, title: "India", subid: 29, subtitle: "Rangoon" },
  { id: 1001, title: "India", subid: 30, subtitle: "Peshawar" },
  { id: 1001, title: "India", subid: 40, subtitle: "Oudh" },
  { id: 1001, title: "India", subid: 82, subtitle: "Meghalaya" },
  { id: 1001, title: "India", subid: 83, subtitle: "Tripura" },
  { id: 1001, title: "India", subid: 84, subtitle: "Manipur" },
  { id: 1001, title: "India", subid: 91, subtitle: "Travancore-Cochin" },
  { id: 1001, title: "India", subid: 97, subtitle: "Saurashtra" },
  { id: 1001, title: "India", subid: 98, subtitle: "Kutch" },
  { id: 1001, title: "India", subid: 104, subtitle: "Telangana" },
  { id: 1008, title: "Tribunals and Commissions", subid: 23, subtitle: "Tribunals" },
  { id: 1008, title: "Tribunals and Commissions", subid: 49, subtitle: "Appellate Tribunal For Electricity" },
  { id: 1008, title: "Tribunals and Commissions", subid: 50, subtitle: "Authority For Advance Rulings" },
  { id: 1008, title: "Tribunals and Commissions", subid: 51, subtitle: "Armed Force Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 52, subtitle: "Competition Appellate Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 53, subtitle: "Central Sales Tax" },
  { id: 1008, title: "Tribunals and Commissions", subid: 54, subtitle: "Central Electricity Regulatory Commission" },
  { id: 1008, title: "Tribunals and Commissions", subid: 55, subtitle: "Central Information Commission" },
  { id: 1008, title: "Tribunals and Commissions", subid: 56, subtitle: "Company Law Board" },
  { id: 1008, title: "Tribunals and Commissions", subid: 57, subtitle: "Copyright Board" },
  { id: 1008, title: "Tribunals and Commissions", subid: 58, subtitle: "MRTP" },
  { id: 1008, title: "Tribunals and Commissions", subid: 59, subtitle: "EPFAT" },
  { id: 1008, title: "Tribunals and Commissions", subid: 76, subtitle: "NCDRC" },
  { id: 1008, title: "Tribunals and Commissions", subid: 77, subtitle: "Cyber Appellate Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 78, subtitle: "Intellectual Property Appellate Board" },
  { id: 1008, title: "Tribunals and Commissions", subid: 79, subtitle: "TDSAT" },
  { id: 1008, title: "Tribunals and Commissions", subid: 80, subtitle: "Debts Recovery Appellate Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 81, subtitle: "CEGAT/CESTAT" },
  { id: 1008, title: "Tribunals and Commissions", subid: 85, subtitle: "Appellate Tribunal For Foreign Exchange" },
  { id: 1008, title: "Tribunals and Commissions", subid: 86, subtitle: "Securities & Exchange Board of India" },
  { id: 1008, title: "Tribunals and Commissions", subid: 87, subtitle: "Securities Appellate Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 88, subtitle: "Central Administrative Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 89, subtitle: "Debts Recovery Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 90, subtitle: "National Green Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 92, subtitle: "Appellate Tribunal For Forfeited Property" },
  { id: 1008, title: "Tribunals and Commissions", subid: 93, subtitle: "Appellate Tribunal Under Prevention of Money Laundering" },
  { id: 1008, title: "Tribunals and Commissions", subid: 94, subtitle: "Appellate Authority for Industrial and Financial Reconstruction" },
  { id: 1008, title: "Tribunals and Commissions", subid: 96, subtitle: "Income Tax Appellate Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 99, subtitle: "West Bengal Taxation Tribunal" },
  { id: 1008, title: "Tribunals and Commissions", subid: 100, subtitle: "Trademark Registry" },
  { id: 1008, title: "Tribunals and Commissions", subid: 102, subtitle: "National Company Law Tribunal (NCLT)" },
  { id: 1008, title: "Tribunals and Commissions", subid: 103, subtitle: "National Company Law Appellate Tribunal" },
];

const payload = {
  name: process.env.SSO_TEST_NAME || "LAWSUIT",
  username: process.env.SSO_TEST_USERNAME || "akshar",
  email: process.env.SSO_TEST_EMAIL || "shroffakshar@gmail.com",
  allowedCourtIds: JSON.stringify(allowedCourts),
  subscriptionStatus: process.env.SSO_TEST_SUBSCRIPTION_STATUS || "active",
  hasAiAccess: process.env.SSO_TEST_HAS_AI_ACCESS || "true",
  jti: randomUUID(),
  nbf: now - 5,
  exp: now + 60 * 10,
  iss: issuer,
  aud: audience,
};

const token = jwt.sign(payload, secret, {
  algorithm: "HS256",
  noTimestamp: true,
});

console.log("\nSSO TEST TOKEN:\n");
console.log(token);
console.log("\nDECODED PAYLOAD:\n");
console.log(JSON.stringify(payload, null, 2));