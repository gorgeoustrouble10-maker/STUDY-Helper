import { execFileSync,spawn } from 'node:child_process';
execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'inherit'});
execFileSync(process.execPath,['--import','tsx','scripts/seed.ts'],{stdio:'inherit'});
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0'],{stdio:'inherit'});
process.on('SIGTERM',()=>child.kill('SIGTERM'));process.on('SIGINT',()=>child.kill('SIGINT'));child.on('exit',code=>process.exit(code||0));
