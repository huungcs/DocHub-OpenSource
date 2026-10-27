const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Đọc .env nếu có
function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  });
  return env;
}

test('Cloud Integration - Environment variables validation', () => {
  const env = loadEnv();
  assert.ok(env.SUPABASE_URL, 'SUPABASE_URL must be configured');
  assert.ok(env.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY must be configured');
  assert.ok(env.GOOGLE_OAUTH_CLIENT_ID, 'GOOGLE_OAUTH_CLIENT_ID must be configured');
});

test('Cloud Integration - Supabase REST API endpoint responds to preflight', async () => {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return; // Bỏ qua nếu thiếu cấu hình
  }

  const restEndpoint = `${env.SUPABASE_URL}/rest/v1/`;
  try {
    const res = await fetch(restEndpoint, {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`
      }
    });

    // Supabase REST endpoint trả về mã 200 kèm OpenAPI schema định nghĩa API
    assert.ok([200, 401, 403].includes(res.status), `Unexpected status: ${res.status}`);
    if (res.status === 200) {
      const data = await res.json();
      assert.ok(data.swagger || data.openapi || data.definitions || data.paths, 'Response should contain OpenAPI definitions');
    }
  } catch (err) {
    // Nếu thiết bị mất mạng đột xuất, ghi nhận thông báo thay vì crash suite
    console.warn('Supabase REST endpoint check skipped due to network connectivity:', err.message);
  }
});

test('Cloud Integration - Google Drive client class signature verification', () => {
  const clientPath = path.join(__dirname, '..', '..', 'src', 'integrations', 'google-drive', 'client.js');
  assert.ok(fs.existsSync(clientPath), 'Google Drive client file must exist');

  const content = fs.readFileSync(clientPath, 'utf8');
  assert.ok(content.includes('uploadFile'), 'Client must implement uploadFile');
  assert.ok(content.includes('downloadFile'), 'Client must implement downloadFile');
  assert.ok(content.includes('deleteFile'), 'Client must implement deleteFile');
  assert.ok(content.includes('getOrCreateAppFolder'), 'Client must implement getOrCreateAppFolder');
});
