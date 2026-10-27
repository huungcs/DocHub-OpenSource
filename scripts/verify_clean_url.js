const http = require('http');

http.get('http://127.0.0.1:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const list = JSON.parse(d);
    const p = list.find(x => x.url.includes('localhost:3000/index.html'));
    if (!p) return console.log('Page not found');
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Page.reload'
      }));
      setTimeout(() => {
        ws.send(JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: {
            expression: `(() => {
              const dBtn = document.getElementById('btnEnterDemo');
              if (dBtn) dBtn.click();
              
              // 1. Initial state check
              const initialUrl = window.location.href;
              const initialHash = window.location.hash;
              
              // 2. Click folder "Đào tạo"
              const trainingNode = document.querySelector('[data-id="training"], [data-tree-id="training"]');
              if (trainingNode) trainingNode.click();
              
              const afterClickUrl = window.location.href;
              const afterClickHash = window.location.hash;
              const afterClickSearch = window.location.search;
              
              // 3. Click "Tất cả tài liệu"
              const allNode = document.querySelector('[data-id="all"]');
              if (allNode) allNode.click();
              
              const afterAllUrl = window.location.href;
              const afterAllHash = window.location.hash;
              
              // 4. Test setting a hash manually like #folder=training
              window.location.hash = '#folder=hr-dept';
              const hashAfterSet = window.location.hash;
              
              // Trigger popstate/cleanup
              window.dispatchEvent(new Event('popstate'));
              
              return {
                initialUrl,
                initialHash,
                afterClickUrl,
                afterClickHash,
                afterClickSearch,
                afterAllUrl,
                afterAllHash,
                hashAfterSet,
                finalUrl: window.location.href,
                finalHash: window.location.hash
              };
            })()`,
            returnByValue: true
          }
        }));
      }, 800);
    };
    ws.onmessage = msg => {
      const data = JSON.parse(msg.data);
      if (data.id === 2) {
        console.log(JSON.stringify(data?.result?.result?.value || data, null, 2));
        ws.close();
        process.exit(0);
      }
    };
  });
});
