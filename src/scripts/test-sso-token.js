import jwt from "jsonwebtoken";

const secret = process.env.SSO_HS256_SECRET || "logionsolutions";

const token = jwt.sign(
  {
    iss: "https://lawsuitcasefinder.com",
    aud: "lawsuit-ai",
    sub: "12345",
    jti: "test-jti-001",
    username: "bhavya4397",
    email: "bhavya@logionsolutions.com",
    name: "Bhavya Trivedi",
    hasAiAccess: true,
    allowedCourtIds: [101, 205, 309],
    subscriptionStatus: "active",
    tokenVersion: 1,
    source: "casefinder-sso",
  },
  secret,
  {
    algorithm: "HS256",
    expiresIn: "3m",
    notBefore: 0,
  }
);

console.log(token);