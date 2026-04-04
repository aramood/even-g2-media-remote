import qrcodeTerminal from 'qrcode-terminal';

const url = process.argv[2];

if (!url) {
  console.error('Usage: npm run qr:url -- "https://example.com"');
  process.exit(1);
}

console.log(`QR target: ${url}`);
qrcodeTerminal.generate(url, { small: true });
