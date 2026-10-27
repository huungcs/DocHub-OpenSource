const http = require('http');
const fs = require('fs');
const path = require('path');

http.get('http://127.0.0.1:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const list = JSON.parse(d);
    const p = list.find(x => x.url.includes('localhost:3000/index.html'));
    if (!p) return console.log('Page not found');
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    ws.onopen = () => {
      const svg = fs.readFileSync('src/assets/og-image.svg', 'utf8');
      const dataUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
      
      ws.send(JSON.stringify({
        id: 1,
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false }
      }));
      
      setTimeout(() => {
        ws.send(JSON.stringify({
          id: 2,
          method: 'Page.navigate',
          params: { url: dataUri }
        }));
      }, 300);
    };
    ws.onmessage = msg => {
      const data = JSON.parse(msg.data);
      if (data.id === 2) {
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 3,
            method: 'Page.captureScreenshot',
            params: { format: 'png' }
          }));
        }, 500);
      }
      if (data.id === 3) {
        const buf = Buffer.from(data.result.data, 'base64');
        fs.mkdirSync('src/assets', { recursive: true });
        fs.mkdirSync('dist/assets', { recursive: true });
        fs.writeFileSync('src/assets/og-image.png', buf);
        fs.writeFileSync('dist/assets/og-image.png', buf);
        console.log('Saved og-image.png successfully, size:', buf.length);
        // Restore navigation
        ws.send(JSON.stringify({
          id: 4,
          method: 'Page.navigate',
          params: { url: 'http://localhost:3000/index.html' }
        }));
        ws.send(JSON.stringify({ id: 5, method: 'Emulation.clearDeviceMetricsOverride' }));
        setTimeout(() => { ws.close(); process.exit(0); }, 300);
      }
    };
  });
});
