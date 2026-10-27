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
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
      }));
      setTimeout(() => {
        ws.send(JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: {
            expression: `(() => {
              window.dispatchEvent(new Event('resize'));
              if (typeof syncNavigation === 'function') syncNavigation();
              const dBtn = document.getElementById('btnEnterDemo');
              if (dBtn) dBtn.click();
              const nav = document.getElementById('navDialog');
              const sidebar = document.getElementById('sidebar');
              if (nav && sidebar && sidebar.parentElement !== nav) nav.append(sidebar);
              if (nav && !nav.open) nav.showModal();
              const sb = document.querySelector('.sidebar-bottom');
              const fn = document.querySelector('.sidebar-footnote');
              const span = fn ? fn.querySelector('span') : null;
              const btn = fn ? fn.querySelector('.text-button') : null;
              return {
                dialogOpen: nav ? nav.open : false,
                sbInNav: nav && sb ? nav.contains(sb) : false,
                sbHeight: sb ? sb.getBoundingClientRect().height : null,
                fnHeight: fn ? fn.getBoundingClientRect().height : null,
                spanTop: span ? span.getBoundingClientRect().top : null,
                btnTop: btn ? btn.getBoundingClientRect().top : null,
                spanHeight: span ? span.getBoundingClientRect().height : null,
                btnHeight: btn ? btn.getBoundingClientRect().height : null,
                alignItems: fn ? getComputedStyle(fn).alignItems : null,
                spanLineHeight: span ? getComputedStyle(span).lineHeight : null,
                btnLineHeight: btn ? getComputedStyle(btn).lineHeight : null,
                btnPadding: btn ? getComputedStyle(btn).padding : null
              };
            })()`,
            returnByValue: true
          }
        }));
      }, 600);
    };
    ws.onmessage = msg => {
      const data = JSON.parse(msg.data);
      if (data.id === 2) {
        console.log(JSON.stringify(data?.result?.result?.value || data, null, 2));
        ws.send(JSON.stringify({ id: 3, method: 'Emulation.clearDeviceMetricsOverride' }));
        setTimeout(() => { ws.close(); process.exit(0); }, 200);
      }
    };
  });
});
