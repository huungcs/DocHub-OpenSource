const http = require('http');
const fs = require('fs');
const path = require('path');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(path.join(__dirname,'.env'))) process.loadEnvFile(path.join(__dirname,'.env'));
const organizationApi=require('./src/server/organization-api').createApi();

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  if(req.url.split('?')[0]==='/api/organization'){organizationApi(req,res);return;}
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

  let safeUrl;
  try {
    safeUrl = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  if (safeUrl === '/' || safeUrl === '') safeUrl = '/index.html';

  const filePath = path.resolve(ROOT, `.${safeUrl}`);
  const relativePath = path.relative(ROOT, filePath);

  // Chỉ phục vụ tệp đã build trong dist và chặn path traversal.
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\nDocHub Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`Nguồn phục vụ: ${ROOT}`);
  console.log(`Giao diện chính: http://localhost:${PORT}/index.html\n`);
});
