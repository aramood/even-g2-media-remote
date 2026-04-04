import { spawn } from 'node:child_process';
import readline from 'node:readline';
import qrcodeTerminal from 'qrcode-terminal';
import { bin as cloudflaredBin } from 'cloudflared';

const port = process.env.PORT ?? '5173';
const localUrl = `http://127.0.0.1:${port}`;

console.log(`Starting Cloudflare Quick Tunnel for ${localUrl}`);

const child = spawn(
  cloudflaredBin,
  ['tunnel', '--url', localUrl, '--no-autoupdate'],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  },
);

let printedQr = false;

function printQr(url) {
  if (printedQr) {
    return;
  }

  printedQr = true;
  console.log(`Tunnel URL: ${url}`);
  console.log('');
  console.log(`QR target: ${url}`);
  qrcodeTerminal.generate(url, { small: true });
  console.log('');
  console.log('Keep this window open while testing on the phone.');
}

function handleLine(line) {
  if (!line.trim()) {
    return;
  }

  console.log(line);

  const match = line.match(/https:\/\/[^\s]+trycloudflare\.com/);
  if (match) {
    printQr(match[0]);
  }
}

const stdoutRl = readline.createInterface({ input: child.stdout });
stdoutRl.on('line', handleLine);

const stderrRl = readline.createInterface({ input: child.stderr });
stderrRl.on('line', handleLine);

child.on('error', (error) => {
  console.error(`Cloudflare tunnel error: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  console.log(`Tunnel exited. code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  child.kill();
});

process.on('SIGTERM', () => {
  child.kill();
});
