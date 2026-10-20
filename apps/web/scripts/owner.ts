import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
let muted = false;
const output = new Writable({ write(chunk, _encoding, done) { if (!muted)
        process.stdout.write(chunk); done(); } });
const terminal = readline.createInterface({ input: process.stdin, output, terminal: true });
try {
    const existing = await db.owner.findUnique({ where: { id: 'owner' } });
    if (existing)
        throw new Error('所有者账号已存在。此命令不会覆盖已有账号。');
    const username = process.env.INIT_OWNER_USERNAME || ((await terminal.question('账号名称：')).trim());
    let password = process.env.INIT_OWNER_PASSWORD;
    if (!password) {
        process.stdout.write('密码（至少10个字符，输入隐藏）：');
        muted = true;
        password = await terminal.question('');
        muted = false;
        process.stdout.write('\n');
        process.stdout.write('再次输入密码：');
        muted = true;
        const confirmation = await terminal.question('');
        muted = false;
        process.stdout.write('\n');
        if (password !== confirmation)
            throw new Error('两次密码不一致');
    }
    if (!username || username.length > 100)
        throw new Error('账号名称无效');
    await db.owner.create({ data: { id: 'owner', username, passwordHash: await hashPassword(password) } });
    console.log('所有者账号已创建。密码不会保存到日志。');
}
catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
finally {
    terminal.close();
    await db.$disconnect();
}
