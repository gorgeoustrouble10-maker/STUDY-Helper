import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const directory = path.resolve(process.env.DATA_DIR || '.data');
const source = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : path.join(directory, 'garden.db');
const backupDir = path.resolve('backups', `before-mobile-${new Date().toISOString().replace(/[:.]/g, '-')}`);
let before;
await fs.mkdir(path.dirname(source), { recursive: true });
try {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('数据库检查失败，已停止迁移');
    before = db.prepare('SELECT COUNT(*) AS count FROM Record').get().count;
    await fs.mkdir(backupDir, { recursive: true });
    await db.backup(path.join(backupDir, 'garden.db'));
  } finally { db.close(); }
  const check = new Database(path.join(backupDir, 'garden.db'), { readonly: true });
  try { if (check.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份校验失败'); } finally { check.close(); }
  console.log('迁移前数据库已备份并通过检查：' + backupDir);
} catch (error) {
  if (error.code !== 'SQLITE_CANTOPEN') throw error;
  console.log('没有现有数据库，将初始化新数据库。');
}
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'inherit', env: process.env, windowsHide: true });
const db = new Database(source, { readonly: true });
try {
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('迁移后数据库检查失败');
  if (!db.pragma('table_info(Action)').some(column => column.name === 'estimatedMinutes')) throw new Error('缺少任务估时字段');
  const after = db.prepare('SELECT COUNT(*) AS count FROM Record').get().count;
  console.log('本地同步数据库准备完成。原记录数：' + (before ?? 0) + '；当前记录数：' + after + '。');
} finally { db.close(); }
