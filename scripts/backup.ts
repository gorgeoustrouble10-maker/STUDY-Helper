import { exportBackup } from '../src/lib/backup';
import { db } from '../src/lib/db';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
try {
    const target = path.resolve(process.argv[2] || `backups/garden-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await exportBackup(true));
    console.log(`备份已保存：${target}`);
}
finally {
    await db.$disconnect();
}
