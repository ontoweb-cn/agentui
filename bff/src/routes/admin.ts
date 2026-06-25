import { Hono } from 'hono';
import {
  AdminStoreError,
  resourceStore,
  roleStore,
  whitelistStore,
  type RolePermissions,
} from '../services/admin-store';

export const adminRoutes = new Hono();

// Standard response envelope matching Intellect Admin format:
// { code: 0, message: string, data: T }
function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

// ---------------------------------------------------------------------------
// Whitelist routes
// ---------------------------------------------------------------------------

adminRoutes.get('/whitelist', (c) => {
  const list = whitelistStore.list();
  return c.json(ok({ total: list.length, white_list: list }));
});

adminRoutes.post('/whitelist/add', async (c) => {
  try {
    const body = await c.req.json();
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!email) {
      return c.json(fail(400, 'email is required'), 400);
    }
    const entry = whitelistStore.create(email);
    return c.json(ok(entry, 'Whitelist entry created'));
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});

adminRoutes.put('/whitelist/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) {
      return c.json(fail(400, 'invalid id'), 400);
    }
    const body = await c.req.json();
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!email) {
      return c.json(fail(400, 'email is required'), 400);
    }
    const entry = whitelistStore.update(id, email);
    return c.json(ok(entry, 'Whitelist entry updated'));
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});

adminRoutes.delete('/whitelist/:email', (c) => {
  try {
    const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
    if (!email) {
      return c.json(fail(400, 'email is required'), 400);
    }
    const deleted = whitelistStore.deleteByEmail(email);
    if (!deleted) {
      return c.json(fail(404, `Email not found: ${email}`), 404);
    }
    return c.json(ok(null, 'Whitelist entry deleted'));
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});

// Batch import from uploaded Excel/CSV file. We accept multipart form data
// with a `file` field. Parsing is intentionally lightweight: we extract
// email-like tokens from the file content.
adminRoutes.post('/whitelist/batch', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json(fail(400, 'file is required'), 400);
    }
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder().decode(bytes);
    // Naive email extraction: matches user@domain.tld patterns in raw text.
    // Works for both .xlsx (will pick up sharedStrings) and .csv.
    const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
    const matches = text.match(emailRegex) ?? [];
    const result = whitelistStore.batchCreate(matches);
    return c.json(
      ok(result, `Imported ${result.created} entries (${result.skipped} skipped)`),
    );
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});

// ---------------------------------------------------------------------------
// Roles routes
// ---------------------------------------------------------------------------

adminRoutes.get('/roles', (c) => {
  const roles = roleStore.list();
  return c.json(ok({ roles, total: roles.length }));
});

adminRoutes.get('/roles_with_permission', (c) => {
  const roles = roleStore.listWithPermission();
  return c.json(ok({ roles, total: roles.length }));
});

adminRoutes.get('/roles/resource', (c) => {
  const resourceTypes = resourceStore.list();
  return c.json(ok({ resource_types: resourceTypes }));
});

adminRoutes.post('/roles', async (c) => {
  try {
    const body = await c.req.json();
    const roleName = String(body?.role_name ?? '').trim();
    const description = String(body?.description ?? '').trim();
    if (!roleName) {
      return c.json(fail(400, 'role_name is required'), 400);
    }
    const role = roleStore.create(roleName, description);
    return c.json(ok(role, 'Role created'));
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});

adminRoutes.put('/roles/:roleName', async (c) => {
  try {
    const roleName = c.req.param('roleName');
    const body = await c.req.json();
    const description = String(body?.description ?? '').trim();
    const role = roleStore.updateDescription(roleName, description);
    return c.json(ok(role, 'Role updated'));
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});

adminRoutes.delete('/roles/:roleName', (c) => {
  try {
    const roleName = c.req.param('roleName');
    const deleted = roleStore.delete(roleName);
    if (!deleted) {
      return c.json(fail(404, `Role not found: ${roleName}`), 404);
    }
    return c.json(ok(null, 'Role deleted'));
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});

adminRoutes.get('/roles/:roleName/permissions', (c) => {
  try {
    const roleName = c.req.param('roleName');
    const role = roleStore.getByName(roleName);
    if (!role) {
      return c.json(fail(404, `Role not found: ${roleName}`), 404);
    }
    return c.json(ok(role));
  } catch (err) {
    return c.json(fail(500, (err as Error).message), 500);
  }
});

adminRoutes.post('/roles/:roleName/permission', async (c) => {
  try {
    const roleName = c.req.param('roleName');
    const body = await c.req.json();
    // Accept either `new_permissions` (frontend assign) or inline permissions
    const permissions = (body?.new_permissions ?? body) as RolePermissions;
    if (!permissions || typeof permissions !== 'object') {
      return c.json(fail(400, 'permissions object is required'), 400);
    }
    const role = roleStore.grantPermissions(roleName, permissions);
    return c.json(ok(role, 'Permissions granted'));
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});

adminRoutes.delete('/roles/:roleName/permission', async (c) => {
  try {
    const roleName = c.req.param('roleName');
    const body = await c.req.json();
    // Accept either `revoke_permissions` (frontend revoke) or inline permissions
    const permissions = (body?.revoke_permissions ?? body) as RolePermissions;
    if (!permissions || typeof permissions !== 'object') {
      return c.json(fail(400, 'permissions object is required'), 400);
    }
    const role = roleStore.revokePermissions(roleName, permissions);
    return c.json(ok(role, 'Permissions revoked'));
  } catch (err) {
    if (err instanceof AdminStoreError) {
      return c.json(fail(err.code, err.message), err.code as 400);
    }
    return c.json(fail(500, (err as Error).message), 500);
  }
});
