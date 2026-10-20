import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
const port = process.env.PORT || '3002';
const addresses = Object.values(networkInterfaces()).flat().filter(item => item?.family === 'IPv4' && !item.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)).map(item => item.address);
console.log(`电脑工作台：http://127.0.0.1:${port}/workspace/settings`);
for (const address of addresses) console.log(`手机连接地址：http://${address}:${port}`);
console.log('仅供可信局域网开发。手机与电脑需连接同一 Wi-Fi；不要将端口转发到公网。');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '0.0.0.0', '--port', port], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, MOBILE_ALLOW_LAN_HTTP: 'true' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
