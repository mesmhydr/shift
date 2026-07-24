import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  applicationSettings,
  areas,
  breakSessions,
  employees,
  notifications,
  organizations,
  passwordResetRequests,
  rosterAssignments,
  rosters,
  users,
} from '@/lib/db/schema';

let cachedOrganization = null;

async function getOrganization() {
  if (cachedOrganization) return cachedOrganization;
  const existing = await db.query.organizations.findFirst();
  if (existing) {
    cachedOrganization = existing;
    return existing;
  }
  const [created] = await db.insert(organizations).values({ name: 'ShiftOps Ops Center' }).returning();
  cachedOrganization = created;
  return created;
}

async function getSettingsRow() {
  const organization = await getOrganization();
  let row = await db.query.applicationSettings.findFirst({
    where: eq(applicationSettings.organizationId, organization.id),
  });
  if (row) return { ...row, organizationId: organization.id };

  const defaultArea = await db.query.areas.findFirst({
    where: eq(areas.organizationId, organization.id),
  });

  const [created] = await db.insert(applicationSettings).values({
    organizationId: organization.id,
    currentAreaId: defaultArea?.id || null,
    organizationName: organization.name,
    supervisorName: 'Supervisor',
  }).returning();

  return { id: 'global', ...created, organizationId: organization.id };
}

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (expected.$in) return expected.$in.some((item) => String(item) === String(actual));
    if (expected.$ne !== undefined) return String(actual) !== String(expected.$ne);
    if (expected.$regex) return new RegExp(expected.$regex).test(String(actual ?? ''));
  }
  if (Array.isArray(actual)) return actual.some((item) => String(item) === String(expected));
  return String(actual ?? '') === String(expected ?? '');
}

function matchesFilter(row, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => matchesValue(row[key], expected));
}

function sortRows(rows, sortSpec = {}) {
  const entries = Object.entries(sortSpec);
  if (entries.length === 0) return rows;
  return [...rows].sort((left, right) => {
    for (const [key, direction] of entries) {
      const a = left[key];
      const b = right[key];
      if (String(a) === String(b)) continue;
      const comparison = String(a ?? '').localeCompare(String(b ?? ''));
      return direction < 0 ? -comparison : comparison;
    }
    return 0;
  });
}

function cursor(rows) {
  let working = rows;
  return {
    sort(sortSpec) {
      working = sortRows(working, sortSpec);
      return this;
    },
    limit(count) {
      working = working.slice(0, count);
      return this;
    },
    async toArray() {
      return working;
    },
  };
}

async function loadUsers() {
  const [userRows, employeeRows] = await Promise.all([
    db.select().from(users),
    db.select().from(employees),
  ]);
  const employeeMap = new Map(employeeRows.map((row) => [row.userId, row]));
  return userRows.map((row) => {
    const employee = employeeMap.get(row.id);
    return {
      id: row.id,
      organizationId: row.organizationId,
      supabaseUserId: row.supabaseUserId,
      email: row.email,
      role: row.role,
      name: row.name,
      phone: row.phone || '',
      department: employee?.department || '',
      employeeRole: employee?.employeeRole || '',
      active: employee?.active ?? true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

async function loadAreas() {
  return db.select().from(areas);
}

async function loadSettings() {
  return [await getSettingsRow()];
}

async function loadRosters() {
  const [rosterRows, assignmentRows, userRows] = await Promise.all([
    db.select().from(rosters),
    db.select().from(rosterAssignments),
    loadUsers(),
  ]);
  const employeeMap = new Map(userRows.filter((row) => row.role === 'employee').map((row) => [row.id, row]));
  const assignmentsByRoster = new Map();
  for (const assignment of assignmentRows) {
    const list = assignmentsByRoster.get(assignment.rosterId) || [];
    list.push(assignment.employeeId);
    assignmentsByRoster.set(assignment.rosterId, list);
  }
  return rosterRows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    areaId: row.areaId,
    date: row.rosterDate,
    employeeIds: assignmentsByRoster.get(row.id) || [],
    employees: (assignmentsByRoster.get(row.id) || []).map((employeeId) => employeeMap.get(employeeId)).filter(Boolean),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function loadBreakSessions() {
  return db.select().from(breakSessions);
}

async function loadNotifications() {
  return db.select().from(notifications);
}

async function loadPasswordRequests() {
  return db.select().from(passwordResetRequests);
}

async function loadCollection(name) {
  switch (name) {
    case 'users': return loadUsers();
    case 'areas': return loadAreas();
    case 'settings': return loadSettings();
    case 'rosters': return loadRosters();
    case 'break_sessions': return loadBreakSessions();
    case 'notifications': return loadNotifications();
    case 'password_requests': return loadPasswordRequests();
    default: return [];
  }
}

async function upsertRosterEmployeeIds(rosterId, employeeIds) {
  await db.delete(rosterAssignments).where(eq(rosterAssignments.rosterId, rosterId));
  if (!employeeIds?.length) return;
  await db.insert(rosterAssignments).values(
    employeeIds.map((employeeId) => ({ rosterId, employeeId }))
  );
}

async function findMatchingRow(name, filter) {
  const rows = await loadCollection(name);
  return rows.find((row) => matchesFilter(row, filter)) || null;
}

async function updateRows(name, filter, update) {
  const rows = await loadCollection(name);
  const matched = rows.filter((row) => matchesFilter(row, filter));
  if (matched.length === 0) return 0;
  const set = update?.$set || {};

  switch (name) {
    case 'users': {
      for (const row of matched) {
        const userPatch = {};
        ['email', 'name', 'phone', 'role'].forEach((key) => {
          if (set[key] !== undefined) userPatch[key] = set[key];
        });
        if (Object.keys(userPatch).length > 0) {
          await db.update(users).set(userPatch).where(eq(users.id, row.id));
        }
        const employeePatch = {};
        ['department', 'employeeRole', 'active'].forEach((key) => {
          if (set[key] !== undefined) employeePatch[key] = set[key];
        });
        if (Object.keys(employeePatch).length > 0) {
          const employeeRow = await db.query.employees.findFirst({ where: eq(employees.userId, row.id) });
          if (employeeRow) {
            await db.update(employees).set(employeePatch).where(eq(employees.id, employeeRow.id));
          }
        }
      }
      return matched.length;
    }
    case 'areas': {
      for (const row of matched) {
        if (set.name !== undefined) {
          await db.update(areas).set({ name: set.name }).where(eq(areas.id, row.id));
        }
      }
      return matched.length;
    }
    case 'settings': {
      const settings = await getSettingsRow();
      const patch = {};
      ['requireBreakStartApproval', 'requireBreakReturnApproval', 'enableBreakTimeMonitoring', 'organizationName', 'supervisorName', 'currentAreaId', 'pushNotifications', 'breakReminder', 'approvalNotifications', 'passwordRequests'].forEach((key) => {
        if (set[key] !== undefined) patch[key] = set[key];
      });
      if (Object.keys(patch).length > 0) {
        await db.update(applicationSettings).set(patch).where(eq(applicationSettings.organizationId, settings.organizationId));
      }
      return matched.length;
    }
    case 'rosters': {
      for (const row of matched) {
        const patch = {};
        if (set.areaId !== undefined) patch.areaId = set.areaId;
        if (set.date !== undefined) patch.rosterDate = set.date;
        if (Object.keys(patch).length > 0) {
          await db.update(rosters).set(patch).where(eq(rosters.id, row.id));
        }
        if (set.employeeIds !== undefined) {
          await upsertRosterEmployeeIds(row.id, set.employeeIds);
        }
      }
      return matched.length;
    }
    case 'break_sessions': {
      for (const row of matched) {
        const patch = {};
        ['status', 'startAt', 'endAt', 'durationMin', 'requestedAt', 'durationLimitMin', 'approvedByUserId', 'requestedByUserId', 'employeeId', 'areaId', 'date', 'type', 'rosterId'].forEach((key) => {
          if (set[key] !== undefined) patch[key] = set[key];
        });
        if (Object.keys(patch).length > 0) {
          await db.update(breakSessions).set(patch).where(eq(breakSessions.id, row.id));
        }
      }
      return matched.length;
    }
    case 'notifications': {
      for (const row of matched) {
        const patch = {};
        if (set.read !== undefined) patch.read = set.read;
        if (Object.keys(patch).length > 0) {
          await db.update(notifications).set(patch).where(eq(notifications.id, row.id));
        }
      }
      return matched.length;
    }
    case 'password_requests': {
      for (const row of matched) {
        const patch = {};
        ['status', 'resolvedAt', 'resolvedByUserId'].forEach((key) => {
          if (set[key] !== undefined) patch[key] = set[key];
        });
        if (Object.keys(patch).length > 0) {
          await db.update(passwordResetRequests).set(patch).where(eq(passwordResetRequests.id, row.id));
        }
      }
      return matched.length;
    }
    default:
      return 0;
  }
}

async function deleteMatchingRows(name, filter) {
  const rows = await loadCollection(name);
  const matched = rows.filter((row) => matchesFilter(row, filter));
  if (matched.length === 0) return 0;

  switch (name) {
    case 'users':
      for (const row of matched) {
        await db.delete(users).where(eq(users.id, row.id));
      }
      return matched.length;
    case 'areas':
      for (const row of matched) {
        await db.delete(areas).where(eq(areas.id, row.id));
      }
      return matched.length;
    case 'rosters':
      for (const row of matched) {
        await db.delete(rosters).where(eq(rosters.id, row.id));
      }
      return matched.length;
    case 'break_sessions':
      for (const row of matched) {
        await db.delete(breakSessions).where(eq(breakSessions.id, row.id));
      }
      return matched.length;
    case 'notifications':
      for (const row of matched) {
        await db.delete(notifications).where(eq(notifications.id, row.id));
      }
      return matched.length;
    case 'password_requests':
      for (const row of matched) {
        await db.delete(passwordResetRequests).where(eq(passwordResetRequests.id, row.id));
      }
      return matched.length;
    default:
      return 0;
  }
}

async function insertDocument(name, doc) {
  const organization = await getOrganization();
  const now = new Date();
  switch (name) {
    case 'areas': {
      const row = {
        id: doc.id || uuidv4(),
        organizationId: doc.organizationId || organization.id,
        name: doc.name || 'New Area',
      };
      await db.insert(areas).values(row);
      return { insertedId: row.id };
    }
    case 'users': {
      const userId = doc.id || uuidv4();
      const userRow = {
        id: userId,
        organizationId: doc.organizationId || organization.id,
        supabaseUserId: doc.supabaseUserId,
        email: String(doc.email || '').toLowerCase().trim(),
        role: doc.role || 'employee',
        name: doc.name || '',
        phone: doc.phone || '',
      };
      await db.insert(users).values(userRow);
      if (userRow.role === 'employee') {
        await db.insert(employees).values({
          userId: userId,
          organizationId: userRow.organizationId,
          department: doc.department || '',
          employeeRole: doc.employeeRole || '',
          active: doc.active ?? true,
        });
      }
      return { insertedId: userId };
    }
    case 'settings': {
      const existing = await getSettingsRow();
      const patch = {
        id: 'global',
        currentAreaId: doc.currentAreaId ?? existing.currentAreaId ?? null,
        requireBreakStartApproval: doc.requireBreakStartApproval ?? existing.requireBreakStartApproval,
        requireBreakReturnApproval: doc.requireBreakReturnApproval ?? existing.requireBreakReturnApproval,
        enableBreakTimeMonitoring: doc.enableBreakTimeMonitoring ?? existing.enableBreakTimeMonitoring,
        pushNotifications: doc.pushNotifications ?? existing.pushNotifications,
        breakReminder: doc.breakReminder ?? existing.breakReminder,
        approvalNotifications: doc.approvalNotifications ?? existing.approvalNotifications,
        passwordRequests: doc.passwordRequests ?? existing.passwordRequests,
        organizationName: doc.organizationName ?? existing.organizationName,
        supervisorName: doc.supervisorName ?? existing.supervisorName,
      };
      await db.update(applicationSettings).set(patch).where(eq(applicationSettings.organizationId, existing.organizationId));
      return { insertedId: 'global' };
    }
    case 'rosters': {
      const rosterId = doc.id || uuidv4();
      const row = {
        id: rosterId,
        organizationId: doc.organizationId || organization.id,
        areaId: doc.areaId,
        rosterDate: doc.date,
        createdByUserId: doc.createdByUserId || null,
      };
      await db.insert(rosters).values(row);
      await upsertRosterEmployeeIds(rosterId, Array.isArray(doc.employeeIds) ? doc.employeeIds : []);
      return { insertedId: rosterId };
    }
    case 'break_sessions': {
      const sessionId = doc.id || uuidv4();
      await db.insert(breakSessions).values({
        id: sessionId,
        organizationId: doc.organizationId || organization.id,
        rosterId: doc.rosterId || null,
        employeeId: doc.employeeId,
        areaId: doc.areaId,
        date: doc.date,
        type: doc.type,
        status: doc.status,
        requestedAt: doc.requestedAt || now,
        startAt: doc.startAt || null,
        endAt: doc.endAt || null,
        durationLimitMin: doc.durationLimitMin,
        durationMin: doc.durationMin || null,
        requestedByUserId: doc.requestedByUserId || null,
        approvedByUserId: doc.approvedByUserId || null,
      });
      return { insertedId: sessionId };
    }
    case 'notifications': {
      const notificationId = doc.id || uuidv4();
      await db.insert(notifications).values({
        id: notificationId,
        organizationId: doc.organizationId || organization.id,
        userId: doc.userId,
        title: doc.title,
        body: doc.body,
        meta: doc.meta || {},
        read: doc.read ?? false,
      });
      return { insertedId: notificationId };
    }
    case 'password_requests': {
      const requestId = doc.id || uuidv4();
      await db.insert(passwordResetRequests).values({
        id: requestId,
        organizationId: doc.organizationId || organization.id,
        userId: doc.employeeId || doc.userId,
        requestedByUserId: doc.requestedByUserId || null,
        status: doc.status || 'pending',
        requestedAt: doc.requestedAt || now,
        resolvedAt: doc.resolvedAt || null,
        resolvedByUserId: doc.resolvedByUserId || null,
      });
      return { insertedId: requestId };
    }
    default:
      return { insertedId: doc.id || uuidv4() };
  }
}

function collection(name) {
  return {
    find(filter = {}) {
      let rowsPromise = loadCollection(name).then((rows) => rows.filter((row) => matchesFilter(row, filter)));
      return {
        sort(sortSpec) {
          rowsPromise = rowsPromise.then((rows) => sortRows(rows, sortSpec));
          return this;
        },
        limit(count) {
          rowsPromise = rowsPromise.then((rows) => rows.slice(0, count));
          return this;
        },
        async toArray() {
          return rowsPromise;
        },
      };
    },
    async findOne(filter = {}) {
      return findMatchingRow(name, filter);
    },
    async insertOne(doc) {
      return insertDocument(name, doc);
    },
    async updateOne(filter = {}, update = {}, options = {}) {
      const matched = await updateRows(name, filter, update);
      if (matched === 0 && options.upsert) {
        await insertDocument(name, { ...filter, ...(update.$set || {}) });
      }
      return { matchedCount: matched };
    },
    async updateMany(filter = {}, update = {}) {
      if (name === 'rosters' && update.$pull?.employeeIds !== undefined) {
        const rows = await loadCollection(name);
        const matched = rows.filter((row) => matchesFilter(row, filter));
        for (const row of matched) {
          await db.delete(rosterAssignments).where(and(eq(rosterAssignments.rosterId, row.id), eq(rosterAssignments.employeeId, update.$pull.employeeIds)));
        }
        return { matchedCount: matched.length };
      }
      if (name === 'notifications' && update.$set?.read !== undefined) {
        const rows = await loadCollection(name);
        const matched = rows.filter((row) => matchesFilter(row, filter));
        if (matched.length > 0) {
          await db.update(notifications).set({ read: update.$set.read }).where(and(eq(notifications.userId, filter.userId), eq(notifications.read, filter.read ?? false)));
        }
        return { matchedCount: matched.length };
      }
      return { matchedCount: await updateRows(name, filter, update) };
    },
    async deleteOne(filter = {}) {
      return { deletedCount: await deleteMatchingRows(name, filter) };
    },
    async deleteMany(filter = {}) {
      return { deletedCount: await deleteMatchingRows(name, filter) };
    },
    async countDocuments(filter = {}) {
      const rows = await loadCollection(name);
      return rows.filter((row) => matchesFilter(row, filter)).length;
    },
  };
}

export async function getDb() {
  return {
    collection,
  };
}
