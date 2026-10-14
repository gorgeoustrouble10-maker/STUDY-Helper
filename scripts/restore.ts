import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
try {
    const source = process.argv[2], targetArg = process.argv[3];
    if (!source || !targetArg)
        throw new Error('用法：npm run restore -- 备份.zip 新的空目录');
    const target = path.resolve(targetArg);
    await mkdir(target, { recursive: true });
    if ((await readdir(target)).length)
        throw new Error('恢复目录必须为空。现有数据不会被覆盖。');
    process.env.DATA_DIR = target;
    process.env.DATABASE_URL = `file:${path.join(target, 'garden.db').replaceAll('\\', '/')}`;
    execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, stdio: 'pipe', windowsHide: true });
    const { importBackup } = await import('../src/lib/backup');
    const { db } = await import('../src/lib/db');
    try {
        const result = await importBackup(await readFile(path.resolve(source)));
        console.log(JSON.stringify({ directory: target, ...result }));
    }
    finally {
        await db.$disconnect();
    }
}
catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
