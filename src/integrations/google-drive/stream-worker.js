/* DocHub Google Drive range-stream worker.
 * Tokens live only in worker memory and are never embedded in media URLs.
 */
'use strict';

const STREAM_PREFIX = '/__dochub_drive_stream__/';
const streams = new Map();

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'DOCHUB_STREAM_REGISTER' && data.key && data.fileId && data.googleToken) {
    streams.set(data.key, {
      fileId: String(data.fileId),
      googleToken: String(data.googleToken),
      organizationId:data.organizationId||null,
      mime: String(data.mime || 'application/octet-stream'),
      expiresAt: Date.now() + 55 * 60 * 1000
    });
    event.ports?.[0]?.postMessage({ ok: true });
  } else if (data.type === 'DOCHUB_STREAM_RELEASE' && data.key) {
    streams.delete(data.key);
    event.ports?.[0]?.postMessage({ ok: true });
  }
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(STREAM_PREFIX)) return;
  event.respondWith(streamFromDrive(event.request, url));
});

async function streamFromDrive(request, url) {
  const key = url.pathname.slice(STREAM_PREFIX.length).split('/')[0];
  const stream = streams.get(key);
  if (!stream || stream.expiresAt <= Date.now()) {
    streams.delete(key);
    return new Response('Phiên phát video đã hết hạn. Hãy mở lại tài liệu.', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  const headers = new Headers({ Authorization: `Bearer ${stream.googleToken}` });
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);

  try {
    const driveResponse = await fetch(
      stream.organizationId?`/api/organization?action=asset&organization=${encodeURIComponent(stream.organizationId)}&id=${encodeURIComponent(stream.fileId)}`:`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(stream.fileId)}?alt=media`,
      { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'follow' }
    );
    const responseHeaders = new Headers(driveResponse.headers);
    if (!responseHeaders.get('Content-Type')) responseHeaders.set('Content-Type', stream.mime);
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', 'private, no-store');
    responseHeaders.delete('Content-Disposition');
    return new Response(request.method === 'HEAD' ? null : driveResponse.body, {
      status: driveResponse.status,
      statusText: driveResponse.statusText,
      headers: responseHeaders
    });
  } catch (_) {
    return new Response('Không thể kết nối Google Drive.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}
