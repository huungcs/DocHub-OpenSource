const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bridgeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'integrations', 'supabase', 'cloud-bridge.js'),
  'utf8'
);

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

async function createHarness({ googleEnabled, session }) {
  const events = [];
  const calls = { oauth: null, signOut: null, drive: 0, reload: 0, rpc: [] };
  let authCallback = null;
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: callback => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signInWithOAuth: async options => {
      calls.oauth = options;
      return { data: { provider: 'google', url: 'https://example.test/oauth' }, error: null };
    },
    signOut: async options => {
      calls.signOut = options;
      return { error: null };
    }
  };
  const client = {
    auth,
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (name === 'dochub_bootstrap_organization') {
        return { data: [{ organization_id: 'org-1', organization_role: 'owner' }], error: null };
      }
      if (name === 'dochub_can_folder_action') return { data: true, error: null };
      return { data: null, error: null };
    },
    from: table => ({
      then(resolve) { return Promise.resolve({data:table==='organization_folders'?[{folder_uid:'all',parent_uid:null,name:'Root',deleted_at:null}]:[],error:null}).then(resolve); },
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async () => ({ error: null }),
      delete() { return this; },
      match: async () => ({ error: null })
    })
  };
  const context = {
    console,
    Blob,
    AbortController,
    Error,
    JSON,
    Promise,
    clearTimeout,
    setTimeout,
    sessionStorage: createStorage(),
    fetch: async () => ({
      ok: true,
      json: async () => ({ external: { google: googleEnabled } })
    }),
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    document: {
      dispatchEvent: event => { events.push(event); return true; }
    },
    indexedDB: { open: () => { throw new Error('IndexedDB should not be used by auth tests'); } },
    window: {
      DOCHUB_CONFIG: {
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'public-anon-key',
        GOOGLE_DRIVE_FOLDER_NAME: 'DocHub Test',
        DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.file'
      },
      supabase: { createClient: () => client },
      DocHubDrive: {
        getOrCreateMirroredFolder: async token => {calls.drive+=1;assert.strictEqual(token,'provider-token');return {id:'drive-folder-id'};},
        reconcileFolder: async () => ({id:'drive-folder-id'}),
        getOrCreateAppFolder: async token => {
          calls.drive += 1;
          assert.strictEqual(token, 'provider-token');
          return 'drive-folder-id';
        }
      },
      location: {
        origin: 'http://localhost:3000',
        pathname: '/',
        search: '',
        reload: () => { calls.reload += 1; }
      }
    }
  };
  vm.runInNewContext(bridgeSource, context, { filename: 'dochub-cloud-bridge.js' });
  await context.window.DocHubAPI.ready;
  await new Promise(resolve => setTimeout(resolve, 0));
  return { api: context.window.DocHubAPI, authCallback, calls, events };
}

(async () => {
  const signedIn = await createHarness({
    googleEnabled: true,
    session: { user: { id: 'user-1', email: 'user@example.com' }, provider_token: 'provider-token' }
  });
  assert.strictEqual(signedIn.api.connected, true);
  assert.strictEqual(signedIn.api.isDriveConnected, true);
  assert.strictEqual(signedIn.api.authStatus, 'ready');
  assert.strictEqual(signedIn.api.organization.id, 'org-1');
  assert.strictEqual(signedIn.api.organization.role, 'owner');
  assert.strictEqual(signedIn.api.authorizationStatus, 'ready');
  assert.strictEqual(await signedIn.api.authorize('all', 'manage'), true);
  assert.ok(signedIn.calls.rpc.some(call => call.name === 'dochub_bootstrap_organization'));
  assert.strictEqual(signedIn.calls.drive, 1);
  assert.strictEqual(await signedIn.api.loadState(), null);
  assert.strictEqual(signedIn.api.workspaceLoadStatus, 'not_found');

  const signedOut = await createHarness({ googleEnabled: true, session: null });
  assert.strictEqual(signedOut.api.connected, false);
  assert.strictEqual(signedOut.api.authStatus, 'signed_out');
  await signedOut.api.loginWithGoogle();
  assert.strictEqual(signedOut.calls.oauth.provider, 'google');
  assert.strictEqual(signedOut.calls.oauth.options.redirectTo, 'http://localhost:3000/');
  assert.match(signedOut.calls.oauth.options.scopes, /drive\.file/);
  assert.strictEqual(signedOut.calls.oauth.options.queryParams.access_type, 'offline');
  assert.strictEqual(signedOut.calls.oauth.options.queryParams.prompt, undefined);
  await signedOut.api.loginWithGoogle({ reconnectDrive: true });
  assert.strictEqual(signedOut.calls.oauth.options.queryParams.prompt, 'consent');
  await signedOut.api.loginWithGoogle();
  assert.strictEqual(signedOut.calls.oauth.options.queryParams.prompt, undefined);

  const missingProvider = await createHarness({ googleEnabled: false, session: null });
  assert.strictEqual(missingProvider.api.googleProviderEnabled, false);
  assert.strictEqual(missingProvider.api.authStatus, 'configuration_required');
  await assert.rejects(() => missingProvider.api.loginWithGoogle(), /bật Google Provider/);

  console.log('Auth bridge tests passed: session restore, OAuth request, provider validation.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
