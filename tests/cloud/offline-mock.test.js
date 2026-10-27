const test = require('node:test');
const assert = require('node:assert/strict');

// Mock DocHub local storage & offline fallback engine
class OfflineWorkspaceManager {
  constructor(initialData = null) {
    this.storage = new Map();
    this.connected = false;
    this.isDriveConnected = false;
    this.data = initialData || {
      workspace: { id: 'ws_local', name: 'Không gian mẫu' },
      folders: [{ id: 'all', name: 'Tất cả tài liệu' }],
      documents: []
    };
  }

  async loadWorkspace() {
    // Offline: tải từ bộ nhớ cục bộ
    const cached = this.storage.get('dochub_workspace');
    if (cached) {
      this.data = JSON.parse(cached);
    }
    return { data: this.data, source: cached ? 'local_cache' : 'default_sample' };
  }

  async saveWorkspace(newData) {
    this.data = newData;
    this.storage.set('dochub_workspace', JSON.stringify(newData));
    return { success: true, persistedTo: 'local_storage', cloudSynced: false };
  }

  async uploadFile(file) {
    if (!this.connected) {
      // Khi offline, lưu tạm dạng tệp cục bộ
      const doc = {
        id: 'doc_' + Date.now(),
        name: file.name,
        bytes: file.size || 0,
        source: 'local_offline',
        driveFileId: null
      };
      this.data.documents.push(doc);
      await this.saveWorkspace(this.data);
      return { success: true, doc, offline: true };
    }
    throw new Error('Cloud upload unavailable offline');
  }
}

test('Cloud Offline - Workspace loads sample/cached data without errors', async () => {
  const manager = new OfflineWorkspaceManager();
  const res = await manager.loadWorkspace();

  assert.strictEqual(res.source, 'default_sample');
  assert.strictEqual(res.data.workspace.name, 'Không gian mẫu');
  assert.strictEqual(manager.connected, false);
  assert.strictEqual(manager.isDriveConnected, false);
});

test('Cloud Offline - Saves locally without throwing network errors', async () => {
  const manager = new OfflineWorkspaceManager();
  const updated = {
    ...manager.data,
    workspace: { id: 'ws_local', name: 'Không gian cá nhân đã sửa' }
  };

  const saveRes = await manager.saveWorkspace(updated);
  assert.strictEqual(saveRes.success, true);
  assert.strictEqual(saveRes.cloudSynced, false);

  const loadRes = await manager.loadWorkspace();
  assert.strictEqual(loadRes.data.workspace.name, 'Không gian cá nhân đã sửa');
  assert.strictEqual(loadRes.source, 'local_cache');
});

test('Cloud Offline - Uploading file stores locally and flags offline', async () => {
  const manager = new OfflineWorkspaceManager();
  const file = { name: 'TaiLieuOffline.pdf', size: 2048 };

  const uploadRes = await manager.uploadFile(file);
  assert.strictEqual(uploadRes.success, true);
  assert.strictEqual(uploadRes.offline, true);
  assert.strictEqual(uploadRes.doc.driveFileId, null);
  assert.strictEqual(manager.data.documents.length, 1);
});
