const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('node:stream');
const { createApi } = require('../../src/server/organization-api');

const projectRoot = path.join(__dirname, '..', '..');
const templateHtml = fs.readFileSync(path.join(projectRoot, 'src', 'app', 'index.template.html'), 'utf8');

function mockRequest(url, headers = {}, method = 'GET', payload = null) {
  const req = Readable.from([]);
  Object.assign(req, { url, headers, method, body: payload });
  return req;
}

function mockResponse() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(value) {
      if (value) {
        try { this.data = JSON.parse(value); } catch (_) { this.data = value; }
      }
    }
  };
}

const orgId = '11111111-1111-1111-1111-111111111111';

test('Invite API: GET action=invite-code retrieves the organization invite code', async () => {
  const api = createApi({
    SUPABASE_URL: 'https://test',
    SUPABASE_SERVICE_ROLE_KEY: 'service'
  }, async (url) => {
    if (url.includes('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ id: 'member-user' }) };
    if (url.includes('organization_members')) return { ok: true, status: 200, json: async () => ([{ organization_role: 'member' }]) };
    if (url.includes('organizations?id=eq.' + orgId + '&select=invite_code')) {
      return { ok: true, status: 200, json: async () => ([{ invite_code: 'b484299e4a0c' }]) };
    }
    if (url.includes('organizations?id=eq.' + orgId)) {
      return { ok: true, status: 200, json: async () => ([{ id: orgId, owner_id: 'owner-user', name: 'Test Org' }]) };
    }
    throw new Error('Unexpected request URL: ' + url);
  });

  const res = mockResponse();
  await api(mockRequest('/api/organization?action=invite-code&organization=' + orgId, { authorization: 'Bearer jwt' }), res);

  assert.equal(res.statusCode, undefined);
  assert.deepEqual(res.data, { inviteCode: 'b484299e4a0c' });
});

test('Invite API: POST action=invite-reset resets invite code when requester is owner or admin', async () => {
  let patchBody = null;
  const api = createApi({
    SUPABASE_URL: 'https://test',
    SUPABASE_SERVICE_ROLE_KEY: 'service'
  }, async (url, opts = {}) => {
    if (url.includes('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ id: 'owner-user' }) };
    if (url.includes('organization_members')) return { ok: true, status: 200, json: async () => ([{ organization_role: 'owner' }]) };
    if (url.includes('organizations?id=eq.' + orgId) && opts.method === 'PATCH') {
      patchBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ([]) };
    }
    if (url.includes('organizations?id=eq.' + orgId)) {
      return { ok: true, status: 200, json: async () => ([{ id: orgId, owner_id: 'owner-user', name: 'Test Org' }]) };
    }
    throw new Error('Unexpected request URL: ' + url);
  });

  const res = mockResponse();
  await api(mockRequest('/api/organization?action=invite-reset&organization=' + orgId, { authorization: 'Bearer jwt' }, 'POST'), res);

  assert.equal(res.statusCode, undefined);
  assert.ok(res.data.inviteCode, 'Must return new inviteCode');
  assert.equal(typeof res.data.inviteCode, 'string');
  assert.equal(res.data.inviteCode.length, 12);
  assert.equal(patchBody.invite_code, res.data.inviteCode);
});

test('Invite API: POST action=invite-reset rejects member with 403', async () => {
  const api = createApi({
    SUPABASE_URL: 'https://test',
    SUPABASE_SERVICE_ROLE_KEY: 'service'
  }, async (url) => {
    if (url.includes('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ id: 'regular-member' }) };
    if (url.includes('organization_members')) return { ok: true, status: 200, json: async () => ([{ organization_role: 'member' }]) };
    if (url.includes('organizations?id=eq.' + orgId)) {
      return { ok: true, status: 200, json: async () => ([{ id: orgId, owner_id: 'owner-user', name: 'Test Org' }]) };
    }
    throw new Error('Unexpected request URL: ' + url);
  });

  const res = mockResponse();
  await api(mockRequest('/api/organization?action=invite-reset&organization=' + orgId, { authorization: 'Bearer jwt' }, 'POST'), res);

  assert.equal(res.statusCode, 403);
});

test('Document Share Link: UI template includes direct share copy actions and URL handlers', () => {
  // Context menu item for copying document link
  assert.ok(templateHtml.includes('data-action="copy-doc-link"'), 'copy-doc-link action must be present');
  assert.ok(templateHtml.includes('Sao chép liên kết xem'), 'Menu label for copying doc link must be present');

  // Preview dialog has Copy Link button
  assert.ok(templateHtml.includes('data-action="copy-doc-link"') && templateHtml.includes('Sao chép link'), 'Preview dialog must have copy link button');

  // Mobile hides text on copy link buttons to keep only the icon
  assert.ok(templateHtml.includes('studio-copy span{display:none') || templateHtml.includes('studio-copy span {display:none'), 'Mobile copy link button must hide text label');

  // getDocFromUrl function exists
  assert.ok(templateHtml.includes('function getDocFromUrl()'), 'getDocFromUrl helper must exist');
  assert.ok(templateHtml.includes('checkAndOpenRequestedDoc()'), 'checkAndOpenRequestedDoc helper must exist');

  // Visual pulse styling for shared document highlighting
  assert.ok(templateHtml.includes('.doc-highlight'), 'doc-highlight CSS class must be defined');
  assert.ok(templateHtml.includes('@keyframes docPulse'), 'docPulse animation must be defined');
});

test('Invite Link: UI template includes invite link management in members settings', () => {
  // usersPage renders invite link section
  assert.ok(templateHtml.includes('Liên kết mời vào Không gian làm việc'), 'Invite link section header must exist');
  assert.ok(templateHtml.includes('data-action="copy-invite-link"'), 'copy-invite-link button must exist');
  assert.ok(templateHtml.includes('data-action="reset-invite-link"'), 'reset-invite-link button must exist');

  // Auth gateway adapts welcome message when ?invite= is in URL
  assert.ok(templateHtml.includes("sessionStorage.setItem('dochub_pending_invite'"), 'Invite code must be preserved in sessionStorage across OAuth redirect');
  assert.ok(templateHtml.includes('Lời mời tham gia Không gian'), 'Gateway must adapt heading for invited users');
});

test('Media viewer initializes with copyDocLink bridge', () => {
  assert.ok(templateHtml.includes('copyDocLink,stream:'), 'DocHubMedia.init must include copyDocLink bridge');
});
