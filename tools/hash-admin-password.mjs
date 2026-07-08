import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const password = process.argv[2] || readFileSync(0, "utf8").trim();

if (!password) {
  console.error("Usage: npm run admin:hash-password -- your-secure-password");
  process.exit(1);
}

const iterations = 210000;
const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");

console.log(`pbkdf2$sha256$${iterations}$${salt}$${hash}`);
