import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhitelistEntry {
  id: number;
  email: string;
  create_date: string;
  update_date: string;
}

export interface RolePermissions {
  // resource name (lowercase) -> { create/read/update/delete: boolean }
  [resource: string]: {
    create?: boolean;
    read?: boolean;
    update?: boolean;
    delete?: boolean;
  };
}

export interface RoleRecord {
  id: number;
  role_name: string;
  description: string;
  permissions: RolePermissions;
  create_date: string;
  update_date: string;
}

interface AdminState {
  whitelist: WhitelistEntry[];
  roles: RoleRecord[];
  sequences: {
    whitelistId: number;
    roleId: number;
  };
}

// ---------------------------------------------------------------------------
// Persistence (JSON file)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const STATE_FILE = resolve(DATA_DIR, 'admin-state.json');

// Resource types managed by BFF. Keep in sync with frontend PERMISSION_TYPES.
export const RESOURCE_TYPES = ['agent', 'dataset', 'session', 'memory'] as const;

function defaultState(): AdminState {
  const now = new Date().toISOString();
  return {
    whitelist: [],
    roles: [
      {
        id: 1,
        role_name: 'admin',
        description: 'Administrator with full permissions',
        permissions: RESOURCE_TYPES.reduce((acc, r) => {
          acc[r] = { create: true, read: true, update: true, delete: true };
          return acc;
        }, {} as RolePermissions),
        create_date: now,
        update_date: now,
      },
      {
        id: 2,
        role_name: 'user',
        description: 'Regular user with read-only permissions',
        permissions: RESOURCE_TYPES.reduce((acc, r) => {
          acc[r] = { create: true, read: true, update: false, delete: false };
          return acc;
        }, {} as RolePermissions),
        create_date: now,
        update_date: now,
      },
    ],
    sequences: {
      whitelistId: 1,
      roleId: 3,
    },
  };
}

function loadState(): AdminState {
  try {
    if (!existsSync(STATE_FILE)) {
      const state = defaultState();
      saveState(state);
      return state;
    }
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as AdminState;
    // Basic shape validation
    if (!parsed.whitelist || !parsed.roles || !parsed.sequences) {
      throw new Error('invalid state file shape');
    }
    return parsed;
  } catch (err) {
    console.error('[admin-store] Failed to load state, falling back to default:', (err as Error).message);
    const state = defaultState();
    saveState(state);
    return state;
  }
}

function saveState(state: AdminState): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[admin-store] Failed to save state:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Whitelist API
// ---------------------------------------------------------------------------

export const whitelistStore = {
  list(): WhitelistEntry[] {
    return loadState().whitelist;
  },

  create(email: string): WhitelistEntry {
    const state = loadState();
    const existing = state.whitelist.find((w) => w.email === email);
    if (existing) {
      throw new AdminStoreError(`Email already exists: ${email}`, 409);
    }
    const now = new Date().toISOString();
    const entry: WhitelistEntry = {
      id: state.sequences.whitelistId++,
      email,
      create_date: now,
      update_date: now,
    };
    state.whitelist.push(entry);
    saveState(state);
    return entry;
  },

  update(id: number, email: string): WhitelistEntry {
    const state = loadState();
    const idx = state.whitelist.findIndex((w) => w.id === id);
    if (idx === -1) {
      throw new AdminStoreError(`Whitelist entry not found: id=${id}`, 404);
    }
    const dup = state.whitelist.find((w) => w.email === email && w.id !== id);
    if (dup) {
      throw new AdminStoreError(`Email already exists: ${email}`, 409);
    }
    state.whitelist[idx].email = email;
    state.whitelist[idx].update_date = new Date().toISOString();
    saveState(state);
    return state.whitelist[idx];
  },

  deleteByEmail(email: string): boolean {
    const state = loadState();
    const before = state.whitelist.length;
    state.whitelist = state.whitelist.filter((w) => w.email !== email);
    const after = state.whitelist.length;
    if (after < before) {
      saveState(state);
      return true;
    }
    return false;
  },

  batchCreate(emails: string[]): { created: number; skipped: number } {
    const state = loadState();
    let created = 0;
    let skipped = 0;
    for (const email of emails) {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed) {
        skipped++;
        continue;
      }
      if (state.whitelist.some((w) => w.email === trimmed)) {
        skipped++;
        continue;
      }
      const now = new Date().toISOString();
      state.whitelist.push({
        id: state.sequences.whitelistId++,
        email: trimmed,
        create_date: now,
        update_date: now,
      });
      created++;
    }
    saveState(state);
    return { created, skipped };
  },
};

// ---------------------------------------------------------------------------
// Roles API
// ---------------------------------------------------------------------------

export const roleStore = {
  list(): RoleRecord[] {
    return loadState().roles;
  },

  listWithPermission(): RoleRecord[] {
    return loadState().roles;
  },

  getByName(roleName: string): RoleRecord | undefined {
    return loadState().roles.find((r) => r.role_name === roleName);
  },

  create(roleName: string, description: string): RoleRecord {
    const state = loadState();
    if (state.roles.some((r) => r.role_name === roleName)) {
      throw new AdminStoreError(`Role already exists: ${roleName}`, 409);
    }
    const now = new Date().toISOString();
    const role: RoleRecord = {
      id: state.sequences.roleId++,
      role_name: roleName,
      description,
      permissions: {},
      create_date: now,
      update_date: now,
    };
    state.roles.push(role);
    saveState(state);
    return role;
  },

  updateDescription(roleName: string, description: string): RoleRecord {
    const state = loadState();
    const role = state.roles.find((r) => r.role_name === roleName);
    if (!role) {
      throw new AdminStoreError(`Role not found: ${roleName}`, 404);
    }
    role.description = description;
    role.update_date = new Date().toISOString();
    saveState(state);
    return role;
  },

  delete(roleName: string): boolean {
    const state = loadState();
    if (roleName === 'admin') {
      throw new AdminStoreError(`Cannot delete built-in role: ${roleName}`, 400);
    }
    const before = state.roles.length;
    state.roles = state.roles.filter((r) => r.role_name !== roleName);
    const after = state.roles.length;
    if (after < before) {
      saveState(state);
      return true;
    }
    return false;
  },

  grantPermissions(roleName: string, permissions: RolePermissions): RoleRecord {
    const state = loadState();
    const role = state.roles.find((r) => r.role_name === roleName);
    if (!role) {
      throw new AdminStoreError(`Role not found: ${roleName}`, 404);
    }
    for (const [resource, actions] of Object.entries(permissions)) {
      if (!role.permissions[resource]) {
        role.permissions[resource] = {};
      }
      for (const [action, value] of Object.entries(actions)) {
        if (value) {
          role.permissions[resource][action as keyof RolePermissions[string]] = true;
        }
      }
    }
    role.update_date = new Date().toISOString();
    saveState(state);
    return role;
  },

  revokePermissions(roleName: string, permissions: RolePermissions): RoleRecord {
    const state = loadState();
    const role = state.roles.find((r) => r.role_name === roleName);
    if (!role) {
      throw new AdminStoreError(`Role not found: ${roleName}`, 404);
    }
    for (const [resource, actions] of Object.entries(permissions)) {
      if (!role.permissions[resource]) continue;
      for (const [action, value] of Object.entries(actions)) {
        if (value) {
          delete role.permissions[resource][action as keyof RolePermissions[string]];
        }
      }
      // Clean up empty resource entries
      if (Object.keys(role.permissions[resource]).length === 0) {
        delete role.permissions[resource];
      }
    }
    role.update_date = new Date().toISOString();
    saveState(state);
    return role;
  },
};

// ---------------------------------------------------------------------------
// Resources API
// ---------------------------------------------------------------------------

export const resourceStore = {
  list(): string[] {
    return [...RESOURCE_TYPES];
  },
};

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

export class AdminStoreError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
    this.name = 'AdminStoreError';
  }
}
