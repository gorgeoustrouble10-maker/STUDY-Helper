import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, request as playwrightRequest } from '@playwright/test';

const directory = path.resolve('.test-data', `mobile-http-${randomUUID()}`);
mkdirSync(directory, { recursive: true });
Object.assign(process.env, { DATA_DIR: directory, DATABASE_URL: `file:${directory.replaceAll('\\', '/')}/garden.db`, SITE_URL: 'http://127.0.0.1:3012', AI_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1' });
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe', env: process.env, windowsHide: true });
const { db } = await import('../src/lib/db');
const { hashPassword } = await import('../src/lib/auth');
await db.owner.create({ data: { username: 'sync-test', passwordHash: await hashPassword('test-only-password-2026') } });
await db.$disconnect();
const logFd = openSync(path.join(directory, 'server.log'), 'a');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3012'], { env: { ...process.env, MOBILE_ALLOW_LAN_HTTP: 'true' }, stdio: ['ignore', logFd, logFd], windowsHide: true });
const baseURL = 'http://127.0.0.1:3012';
const web = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
const native = await playwrightRequest.newContext({ baseURL });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const evidence: string[] = [];
function passed(message: string) { evidence.push(message); console.log('PASS ' + message); }
try {
  const deadline = Date.now() + 90000;
  while (true) {
    if (child.exitCode !== null) throw new Error('测试服务启动失败');
    try { if ((await native.get('/api/auth/me', { timeout: 2500 })).status() === 200) break; } catch { /* starting */ }
    if (Date.now() > deadline) throw new Error('测试服务启动超时');
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  assert.equal((await native.get('/api/mobile/tasks')).status(), 401);
  assert.equal((await native.post('/api/workspace/mobile', { data: { action: 'pair' } })).status(), 401);
  assert.equal((await web.post('/api/auth/login', { data: { username: 'sync-test', password: 'test-only-password-2026' } })).status(), 200);
  const pair = (await (await web.post('/api/workspace/mobile', { data: { action: 'pair' } })).json()).data;
  assert.match(pair.code, /^\d{8}$/);
  const paired = await native.post('/api/mobile/pair', { data: { code: pair.code, label: 'HTTP 验证手机' } });
  assert.equal(paired.status(), 200);
  const connection = (await paired.json()).data;
  const headers = { Authorization: `Bearer ${connection.token}` };
  assert.equal((await native.post('/api/mobile/pair', { data: { code: pair.code, label: '重复' } })).status(), 401);
  assert.equal((await web.get('/api/mobile/tasks', { headers })).status(), 403);
  assert.equal((await native.get('/api/workspace/records', { headers })).status(), 401);
  passed('HTTP 配对一次有效；网页与手机权限隔离');
  const request = { title: '手机创建联调任务', priority: 1, estimatedMinutes: 30, clientMutationId: randomUUID() };
  const createdResponse = await native.post('/api/mobile/tasks', { headers, data: request });
  assert.equal(createdResponse.status(), 201);
  const created = (await createdResponse.json()).data;
  assert.equal((await (await native.post('/api/mobile/tasks', { headers, data: request })).json()).data.id, created.id);
  const webRecord = (await (await web.get(`/api/workspace/records/${created.id}`)).json()).data;
  assert.equal(webRecord.fields.estimatedMinutes, 30);
  const edited = await web.post(`/api/workspace/records/${created.id}`, { data: { ...webRecord, title: '电脑修改后的任务', body: '保留的私密正文', fields: { ...webRecord.fields, estimatedMinutes: 45 }, links: [] } });
  assert.equal(edited.status(), 200);
  const snapshot = (await (await native.get('/api/mobile/tasks', { headers })).json()).data;
  assert.equal(snapshot.tasks[0].title, '电脑修改后的任务'); assert.equal(snapshot.stats.totalMinutes, 45);
  assert.ok(!JSON.stringify(snapshot).includes('保留的私密正文'));
  const conflict = await native.patch(`/api/mobile/tasks/${created.id}`, { headers, data: { version: created.version, status: 'DONE' } });
  assert.equal(conflict.status(), 409); assert.ok(!JSON.stringify(await conflict.json()).includes('保留的私密正文'));
  passed('手机新增→博客可见；电脑修改→手机快照可见；冲突返回409且不泄露正文');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ storageState: await web.storageState(), viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();
  const uiErrors: string[] = [];
  page.on('pageerror', error => uiErrors.push(error.message));
  await page.goto(`${baseURL}/workspace/settings`);
  await page.getByRole('button', { name: '生成手机配对码' }).click();
  await page.getByRole('status').filter({ hasText: '配对码' }).waitFor();
  // Hide the short-lived test code in evidence images.
  await page.locator('strong').filter({ hasText: /^\d{8}$/ }).evaluateAll(elements => elements.forEach(element => { element.textContent = '已隐藏'; }));
  await page.screenshot({ path: path.join(directory, 'desktop-pairing.png'), fullPage: true });
  assert.equal(uiErrors.length, 0, uiErrors.join('\n'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => { const sidebar = document.querySelector('.workspace-sidebar')?.getBoundingClientRect(); return sidebar && sidebar.right <= 1; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '手机布局不应横向溢出');
  await page.screenshot({ path: path.join(directory, 'mobile-web-pairing.png'), fullPage: true });
  passed('电脑/手机宽度工作台可生成配对码，无页面脚本错误');
  const current = snapshot.tasks.find((t: { id: string }) => t.id === created.id);
  assert.equal((await native.delete(`/api/mobile/tasks/${created.id}`, { headers, data: { version: current.version } })).status(), 200);
  const trash = (await (await web.get('/api/workspace/records?view=trash&kind=ACTION')).json()).data;
  assert.ok(trash.list.some((r: { id: string }) => r.id === created.id));
  await web.post('/api/workspace/mobile', { data: { action: 'revoke', id: connection.sessionId } });
  assert.equal((await native.get('/api/mobile/tasks', { headers })).status(), 401);
  passed('手机删除进入博客回收站；电脑撤销连接后手机立即401');
  writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ passed: true, evidence }, null, 2));
  console.log('Evidence directory: ' + directory);
} finally {
  await browser?.close(); await web.dispose(); await native.dispose();
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }
      catch { /* taskkill may report failure after the root process has exited. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
      if (child.exitCode === null) child.kill('SIGTERM');
    }
    else child.kill('SIGTERM');
  }
  closeSync(logFd);
}
