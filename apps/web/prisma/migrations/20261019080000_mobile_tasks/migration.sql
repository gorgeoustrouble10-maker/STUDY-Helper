ALTER TABLE "Action" ADD COLUMN "estimatedMinutes" INTEGER;
CREATE TABLE "MobilePairing" (
  "codeHash" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATETIME NOT NULL
);
CREATE TABLE "MobileSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "MobileSession_tokenHash_key" ON "MobileSession"("tokenHash");
CREATE TABLE "MobileMutation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  CONSTRAINT "MobileMutation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MobileSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
