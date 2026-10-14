-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Domain" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "group" TEXT NOT NULL DEFAULT '个人成长',
    "focus" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Domain_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Course" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "semester" TEXT NOT NULL DEFAULT '',
    "chapters" TEXT NOT NULL DEFAULT '',
    "criteria" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Course_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "outcome" TEXT NOT NULL DEFAULT '',
    "criteria" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT '构想',
    "nextStep" TEXT NOT NULL DEFAULT '',
    "milestones" TEXT NOT NULL DEFAULT '',
    "decisions" TEXT NOT NULL DEFAULT '',
    "weeklyCommitment" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Project_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Action" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "plannedAt" DATETIME,
    "dueAt" DATETIME,
    "remindAt" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "important" BOOLEAN,
    "urgent" BOOLEAN,
    "blocker" TEXT NOT NULL DEFAULT '',
    "repeat" TEXT NOT NULL DEFAULT 'NONE',
    "parentId" TEXT,
    "previousId" TEXT,
    "todayFocus" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATETIME,
    CONSTRAINT "Action_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Issue" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "observation" TEXT NOT NULL DEFAULT '',
    "impact" TEXT NOT NULL DEFAULT '',
    "hypothesis" TEXT NOT NULL DEFAULT '',
    "experiment" TEXT NOT NULL DEFAULT '',
    "checkAt" DATETIME,
    "result" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Issue_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Resource" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL DEFAULT '',
    "resourceType" TEXT NOT NULL DEFAULT '网站',
    "assessment" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Resource_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT '周复盘',
    "expected" TEXT NOT NULL DEFAULT '',
    "actual" TEXT NOT NULL DEFAULT '',
    "adjustment" TEXT NOT NULL DEFAULT '',
    "snapshots" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "Review_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Person" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL DEFAULT '人物',
    "organization" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "experiences" TEXT NOT NULL DEFAULT '',
    "followUpAt" DATETIME,
    CONSTRAINT "Person_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Item" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "location" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "maintenanceAt" DATETIME,
    CONSTRAINT "Item_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "openingCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    CONSTRAINT "Account_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "category" TEXT NOT NULL DEFAULT '其他',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("recordId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Budget" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL DEFAULT '其他',
    "period" TEXT NOT NULL,
    "limitCents" INTEGER NOT NULL,
    CONSTRAINT "Budget_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Channel" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL DEFAULT '博客',
    "url" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    CONSTRAINT "Channel_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Publication" (
    "recordId" TEXT NOT NULL PRIMARY KEY,
    "publicationType" TEXT NOT NULL DEFAULT 'article',
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '{}',
    "selectedAssets" TEXT NOT NULL DEFAULT '[]',
    "currentVersionId" TEXT,
    CONSTRAINT "Publication_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishedVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicationId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishedVersion_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication" ("recordId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'related',
    CONSTRAINT "RecordLink_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordLink_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "RecordTag" (
    "recordId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("recordId", "tagId"),
    CONSTRAINT "RecordTag_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishedAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    CONSTRAINT "PublishedAsset_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PublishedVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Revision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Revision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'owner',
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Record_kind_deletedAt_archivedAt_idx" ON "Record"("kind", "deletedAt", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Action_previousId_key" ON "Action"("previousId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_slug_key" ON "Publication"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RecordLink_fromId_toId_relation_key" ON "RecordLink"("fromId", "toId", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedAsset_storageKey_key" ON "PublishedAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Owner_username_key" ON "Owner"("username");
