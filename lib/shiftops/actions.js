'use server';

import 'server-only';

import crypto from 'crypto';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { createSupabaseAccount, createSupabaseAdminClient, getUserFromRequest, updateSupabasePassword, verifyCredentials } from '@/lib/shiftops/auth';
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

function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function monthBounds(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return {
    start: localDateKey(start),
    end: localDateKey(end),
  };
}

function minutesBetween(startAt, endAt) {
  if (!startAt || !endAt) return null;
  return Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000));
}

function mapBreakSummary(session) {
  if (!session) return { status: 'Not Taken' };
  if (session.status === 'completed') {
    return {
      status: 'Completed',
      durationMin: session.durationMin ?? session.durationLimitMin,
    };
  }
  if (session.status === 'active') {
    return {
      status: 'Running',
      startAt: session.startAt,
      durationLimitMin: session.durationLimitMin,
    };
  }
  if (session.status === 'pending') return { status: 'Pending' };
  if (session.status === 'pending_return') return { status: 'Pending Return' };
  return { status: 'Not Taken' };
}

function summarizeEmployeeSessions(sessions) {
  const byType = { lunch: null, tea: null };
  let activeSession = null;

  for (const session of sessions) {
    if (!activeSession && ['pending', 'active', 'pending_return'].includes(session.status)) {
      activeSession = session;
    }
    if (!byType[session.type]) {
      byType[session.type] = session;
    }
  }

  return {
    lunch: mapBreakSummary(byType.lunch),
    tea: mapBreakSummary(byType.tea),
    activeSession,
    currentStatus: activeSession
      ? activeSession.status === 'active'
        ? 'On Break'
        : activeSession.status === 'pending'
          ? 'Pending Approval'
          : 'Pending Return'
      : 'Working',
  };
}

async function requireUser() {
  const user = await getUserFromRequest();
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user;
}

async function requireSupervisor() {
  const user = await requireUser();
  if (user.role !== 'supervisor') {
    throw new Error('Forbidden');
  }
  return user;
}

async function ensureOrganization(organizationId) {
  let organization = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (!organization) {
    const [created] = await db.insert(organizations).values({ name: 'ShiftOps Ops Center' }).returning();
    organization = created;
  }
  return organization;
}

async function ensureSettings(organizationId) {
  const organization = await ensureOrganization(organizationId);
  let settings = await db.query.applicationSettings.findFirst({
    where: eq(applicationSettings.organizationId, organization.id),
  });

  if (!settings) {
    const defaultArea = await db.query.areas.findFirst({
      where: eq(areas.organizationId, organization.id),
    });
    const [created] = await db.insert(applicationSettings).values({
      organizationId: organization.id,
      currentAreaId: defaultArea?.id || null,
      organizationName: organization.name,
      supervisorName: 'Supervisor',
    }).returning();
    settings = created;
  } else if (!settings.currentAreaId) {
    const defaultArea = await db.query.areas.findFirst({
      where: eq(areas.organizationId, organization.id),
    });
    if (defaultArea) {
      await db.update(applicationSettings).set({ currentAreaId: defaultArea.id }).where(eq(applicationSettings.id, settings.id));
      settings = { ...settings, currentAreaId: defaultArea.id };
    }
  }

  return { organization, settings };
}

async function loadEmployeeProfiles(organizationId) {
  const rows = await db
    .select({
      userId: users.id,
      organizationId: users.organizationId,
      supabaseUserId: users.supabaseUserId,
      email: users.email,
      role: users.role,
      name: users.name,
      phone: users.phone,
      employeeId: employees.id,
      department: employees.department,
      employeeRole: employees.employeeRole,
      active: employees.active,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(eq(users.organizationId, organizationId))
    .orderBy(asc(users.name));

  return rows.map((row) => ({
    id: row.userId,
    organizationId: row.organizationId,
    supabaseUserId: row.supabaseUserId,
    email: row.email,
    role: row.role,
    name: row.name,
    phone: row.phone || '',
    department: row.department || '',
    employeeRole: row.employeeRole || '',
    active: row.active ?? true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function getEmployeeRecordByUserId(organizationId, userId) {
  const record = await db.query.users.findFirst({
    where: and(eq(users.organizationId, organizationId), eq(users.id, userId)),
  });
  if (!record) return null;
  const employee = await db.query.employees.findFirst({
    where: eq(employees.userId, record.id),
  });
  return { user: record, employee };
}

async function getEmployeeRecordByUserIds(organizationId, userIds) {
  if (!userIds.length) return [];
  const rows = await db
    .select({
      employeeId: employees.id,
      userId: users.id,
      organizationId: users.organizationId,
      supabaseUserId: users.supabaseUserId,
      email: users.email,
      role: users.role,
      name: users.name,
      phone: users.phone,
      department: employees.department,
      employeeRole: employees.employeeRole,
      active: employees.active,
    })
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(and(eq(users.organizationId, organizationId), inArray(users.id, userIds)));

  return rows.map((row) => ({
    employeeId: row.employeeId,
    userId: row.userId,
    organizationId: row.organizationId,
    supabaseUserId: row.supabaseUserId,
    email: row.email,
    role: row.role,
    name: row.name,
    phone: row.phone || '',
    department: row.department || '',
    employeeRole: row.employeeRole || '',
    active: row.active ?? true,
  }));
}

async function loadRosterForDate(organizationId, areaId, dateKey) {
  const roster = await db.query.rosters.findFirst({
    where: and(eq(rosters.organizationId, organizationId), eq(rosters.areaId, areaId), eq(rosters.rosterDate, dateKey)),
  });

  if (!roster) {
    return { roster: null, employees: [], sessions: [] };
  }

  const assignmentRows = await db
    .select({
      rosterAssignmentId: rosterAssignments.id,
      employeeRecordId: employees.id,
      userId: users.id,
      organizationId: users.organizationId,
      supabaseUserId: users.supabaseUserId,
      email: users.email,
      role: users.role,
      name: users.name,
      phone: users.phone,
      department: employees.department,
      employeeRole: employees.employeeRole,
      active: employees.active,
    })
    .from(rosterAssignments)
    .innerJoin(employees, eq(rosterAssignments.employeeId, employees.id))
    .innerJoin(users, eq(employees.userId, users.id))
    .where(eq(rosterAssignments.rosterId, roster.id))
    .orderBy(asc(users.name));

  const employeesOnRoster = assignmentRows.map((row) => ({
    id: row.userId,
    organizationId: row.organizationId,
    supabaseUserId: row.supabaseUserId,
    email: row.email,
    role: row.role,
    name: row.name,
    phone: row.phone || '',
    department: row.department || '',
    employeeRole: row.employeeRole || '',
    active: row.active ?? true,
  }));

  const employeeRecordIds = assignmentRows.map((row) => row.employeeRecordId);
  const sessions = employeeRecordIds.length
    ? await db
      .select({
        id: breakSessions.id,
        employeeRecordId: breakSessions.employeeId,
        type: breakSessions.type,
        status: breakSessions.status,
        requestedAt: breakSessions.requestedAt,
        startAt: breakSessions.startAt,
        endAt: breakSessions.endAt,
        durationMin: breakSessions.durationMin,
        durationLimitMin: breakSessions.durationLimitMin,
        requestedByUserId: breakSessions.requestedByUserId,
        approvedByUserId: breakSessions.approvedByUserId,
      })
      .from(breakSessions)
      .where(and(eq(breakSessions.organizationId, organizationId), eq(breakSessions.date, dateKey), inArray(breakSessions.employeeId, employeeRecordIds)))
      .orderBy(desc(breakSessions.requestedAt))
    : [];

  return {
    roster: {
      id: roster.id,
      organizationId: roster.organizationId,
      areaId: roster.areaId,
      date: roster.rosterDate,
      employeeIds: employeesOnRoster.map((row) => row.id),
      employees: employeesOnRoster,
      createdAt: roster.createdAt,
      updatedAt: roster.updatedAt,
    },
    employees: employeesOnRoster,
    sessions,
  };
}

async function loadCurrentAreaContext(organizationId) {
  const { settings } = await ensureSettings(organizationId);
  const areaRows = await db.select().from(areas).where(eq(areas.organizationId, organizationId)).orderBy(asc(areas.name));
  const currentArea = areaRows.find((area) => area.id === settings.currentAreaId) || areaRows[0] || null;
  return { settings, areas: areaRows, currentArea };
}

export async function getNotificationsForCurrentUser() {
  const user = await requireUser();
  const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt));
  return { notifications: rows };
}

export async function markNotificationsRead() {
  const user = await requireUser();
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, user.id));
  return { ok: true };
}

export async function getMyStatus() {
  const user = await requireUser();
  const { currentArea } = await loadCurrentAreaContext(user.organizationId);
  if (!currentArea) {
    return { scheduled: false, areaName: '' };
  }

  const employee = await getEmployeeRecordByUserId(user.organizationId, user.id);
  if (!employee?.employee) {
    return { scheduled: false, areaName: currentArea.name };
  }

  const today = localDateKey();
  const { roster, sessions } = await loadRosterForDate(user.organizationId, currentArea.id, today);
  const isScheduled = Boolean(roster?.employees.some((row) => row.id === user.id));
  if (!isScheduled) {
    return { scheduled: false, areaName: currentArea.name };
  }

  const mySessions = sessions.filter((session) => session.employeeRecordId === employee.employee.id);
  const summary = summarizeEmployeeSessions(mySessions);
  return {
    scheduled: true,
    areaName: currentArea.name,
    currentStatus: summary.currentStatus,
    activeSession: summary.activeSession,
    lunch: summary.lunch,
    tea: summary.tea,
  };
}

export async function requestBreak(type) {
  const user = await requireUser();
  const { settings, currentArea } = await loadCurrentAreaContext(user.organizationId);
  const employee = await getEmployeeRecordByUserId(user.organizationId, user.id);
  if (!employee?.employee || !currentArea) {
    throw new Error('No active roster');
  }

  const today = localDateKey();
  const existing = await db.query.breakSessions.findFirst({
    where: and(
      eq(breakSessions.organizationId, user.organizationId),
      eq(breakSessions.employeeId, employee.employee.id),
      eq(breakSessions.date, today),
      eq(breakSessions.type, type),
    ),
  });
  if (existing && ['pending', 'active', 'pending_return'].includes(existing.status)) {
    throw new Error('Break already in progress');
  }

  const now = new Date();
  const approved = !settings.requireBreakStartApproval;
  await db.insert(breakSessions).values({
    organizationId: user.organizationId,
    rosterId: null,
    employeeId: employee.employee.id,
    areaId: currentArea.id,
    date: today,
    type,
    status: approved ? 'active' : 'pending',
    requestedAt: now,
    startAt: approved ? now : null,
    endAt: null,
    durationLimitMin: type === 'lunch' ? 30 : 15,
    durationMin: null,
    requestedByUserId: user.id,
    approvedByUserId: approved ? user.id : null,
  });
  return { ok: true };
}

export async function returnBreak() {
  const user = await requireUser();
  const { settings } = await loadCurrentAreaContext(user.organizationId);
  const employee = await getEmployeeRecordByUserId(user.organizationId, user.id);
  if (!employee?.employee) throw new Error('No active roster');

  const today = localDateKey();
  const session = await db.query.breakSessions.findFirst({
    where: and(
      eq(breakSessions.organizationId, user.organizationId),
      eq(breakSessions.employeeId, employee.employee.id),
      eq(breakSessions.date, today),
      eq(breakSessions.status, 'active'),
    ),
  });
  if (!session) throw new Error('No active break');

  const now = new Date();
  if (settings.requireBreakReturnApproval) {
    await db.update(breakSessions).set({
      status: 'pending_return',
      requestedAt: now,
      approvedByUserId: null,
      updatedAt: now,
    }).where(eq(breakSessions.id, session.id));
    return { ok: true };
  }

  await db.update(breakSessions).set({
    status: 'completed',
    endAt: now,
    durationMin: minutesBetween(session.startAt, now),
    updatedAt: now,
  }).where(eq(breakSessions.id, session.id));
  return { ok: true };
}

export async function changePassword(currentPassword, newPassword) {
  const user = await requireUser();
  const profile = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (!profile) throw new Error('User profile missing');
  const verified = await verifyCredentials(profile.email, currentPassword);
  if (!verified.ok) throw new Error('Current password is incorrect');
  await updateSupabasePassword(profile.supabaseUserId, newPassword);
  return { ok: true };
}

export async function requestPasswordReset() {
  const user = await requireUser();
  const employee = await getEmployeeRecordByUserId(user.organizationId, user.id);
  if (!employee?.employee) throw new Error('User profile missing');
  await db.insert(passwordResetRequests).values({
    organizationId: user.organizationId,
    userId: user.id,
    requestedByUserId: user.id,
    status: 'pending',
  });
  return { ok: true };
}

export async function getDashboardData() {
  const user = await requireSupervisor();
  const { currentArea } = await loadCurrentAreaContext(user.organizationId);
  if (!currentArea) {
    return { summary: { working: 0, onBreak: 0, pendingApproval: 0, lunchCompleted: 0, teaCompleted: 0 }, employees: [] };
  }

  const today = localDateKey();
  const { roster, employees: rosterEmployees, sessions } = await loadRosterForDate(user.organizationId, currentArea.id, today);
  if (!roster) {
    return { summary: { working: 0, onBreak: 0, pendingApproval: 0, lunchCompleted: 0, teaCompleted: 0 }, employees: [] };
  }

  const employeeSessions = new Map();
  for (const session of sessions) {
    const list = employeeSessions.get(session.employeeRecordId) || [];
    list.push(session);
    employeeSessions.set(session.employeeRecordId, list);
  }

  const employeesOnShift = rosterEmployees.map((employee) => {
    const profile = employeeSessions.get(employee.id) || [];
    const summary = summarizeEmployeeSessions(profile);
    return {
      ...employee,
      currentStatus: summary.currentStatus,
      lunch: summary.lunch,
      tea: summary.tea,
      activeSession: summary.activeSession,
    };
  });

  const summary = {
    working: employeesOnShift.filter((employee) => employee.currentStatus === 'Working').length,
    onBreak: employeesOnShift.filter((employee) => employee.currentStatus === 'On Break').length,
    pendingApproval: employeesOnShift.filter((employee) => employee.currentStatus !== 'Working' && employee.currentStatus !== 'On Break').length,
    lunchCompleted: employeesOnShift.filter((employee) => employee.lunch?.status === 'Completed').length,
    teaCompleted: employeesOnShift.filter((employee) => employee.tea?.status === 'Completed').length,
  };

  return { summary, employees: employeesOnShift };
}

export async function approveBreak(sessionId) {
  const user = await requireSupervisor();
  const session = await db.query.breakSessions.findFirst({ where: eq(breakSessions.id, sessionId) });
  if (!session) throw new Error('Break not found');

  const now = new Date();
  if (session.status === 'pending') {
    await db.update(breakSessions).set({
      status: 'active',
      startAt: now,
      approvedByUserId: user.id,
      updatedAt: now,
    }).where(eq(breakSessions.id, session.id));
    return { ok: true };
  }

  if (session.status === 'pending_return') {
    await db.update(breakSessions).set({
      status: 'completed',
      endAt: now,
      durationMin: minutesBetween(session.startAt, now),
      approvedByUserId: user.id,
      updatedAt: now,
    }).where(eq(breakSessions.id, session.id));
    return { ok: true };
  }

  return { ok: true };
}

export async function rejectBreak(sessionId) {
  const user = await requireSupervisor();
  const now = new Date();
  await db.update(breakSessions).set({
    status: 'rejected',
    approvedByUserId: user.id,
    updatedAt: now,
  }).where(eq(breakSessions.id, sessionId));
  return { ok: true };
}

export async function endBreak(sessionId) {
  const user = await requireSupervisor();
  const session = await db.query.breakSessions.findFirst({ where: eq(breakSessions.id, sessionId) });
  if (!session) throw new Error('Break not found');
  const now = new Date();
  await db.update(breakSessions).set({
    status: 'completed',
    endAt: now,
    durationMin: minutesBetween(session.startAt, now),
    approvedByUserId: user.id,
    updatedAt: now,
  }).where(eq(breakSessions.id, session.id));
  return { ok: true };
}

export async function startBreak(employeeUserId, type) {
  const user = await requireSupervisor();
  const { settings, currentArea } = await loadCurrentAreaContext(user.organizationId);
  const employee = await getEmployeeRecordByUserId(user.organizationId, employeeUserId);
  if (!employee?.employee || !currentArea) throw new Error('Employee not found');

  const today = localDateKey();
  const approved = !settings.requireBreakStartApproval;
  const now = new Date();
  await db.insert(breakSessions).values({
    organizationId: user.organizationId,
    rosterId: null,
    employeeId: employee.employee.id,
    areaId: currentArea.id,
    date: today,
    type,
    status: approved ? 'active' : 'pending',
    requestedAt: now,
    startAt: approved ? now : null,
    endAt: null,
    durationLimitMin: type === 'lunch' ? 30 : 15,
    durationMin: null,
    requestedByUserId: user.id,
    approvedByUserId: approved ? user.id : null,
  });
  return { ok: true };
}

export async function getRosterCalendar(areaId, monthKey) {
  const user = await requireSupervisor();
  const { start, end } = monthBounds(monthKey);
  const rows = await db.select({ date: rosters.rosterDate }).from(rosters).where(and(eq(rosters.organizationId, user.organizationId), eq(rosters.areaId, areaId), gte(rosters.rosterDate, start), lt(rosters.rosterDate, end)));
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.date, (counts.get(row.date) || 0) + 1);
  }
  return { dates: Array.from(counts.entries()).map(([date, count]) => ({ date, count })) };
}

export async function getRosterForDate(areaId, dateKey) {
  const user = await requireSupervisor();
  const { roster } = await loadRosterForDate(user.organizationId, areaId, dateKey);
  return { roster };
}

export async function saveRoster(areaId, dateKey, employeeIds) {
  const user = await requireSupervisor();
  const employeeRecords = await getEmployeeRecordByUserIds(user.organizationId, employeeIds);
  const existing = await db.query.rosters.findFirst({
    where: and(eq(rosters.organizationId, user.organizationId), eq(rosters.areaId, areaId), eq(rosters.rosterDate, dateKey)),
  });

  const rosterId = existing?.id || crypto.randomUUID();
  if (!existing) {
    await db.insert(rosters).values({
      id: rosterId,
      organizationId: user.organizationId,
      areaId,
      rosterDate: dateKey,
      createdByUserId: user.id,
    });
  }
  await db.delete(rosterAssignments).where(eq(rosterAssignments.rosterId, rosterId));
  if (employeeRecords.length > 0) {
    await db.insert(rosterAssignments).values(employeeRecords.map((employee) => ({ rosterId, employeeId: employee.employeeId })));
  }
  return { ok: true };
}

export async function getHistory(areaId, dateKey) {
  const user = await requireSupervisor();
  const rows = await db
    .select({
      id: breakSessions.id,
      type: breakSessions.type,
      status: breakSessions.status,
      requestedAt: breakSessions.requestedAt,
      startAt: breakSessions.startAt,
      endAt: breakSessions.endAt,
      durationMin: breakSessions.durationMin,
      durationLimitMin: breakSessions.durationLimitMin,
      employeeUserId: users.id,
      employeeName: users.name,
      department: employees.department,
    })
    .from(breakSessions)
    .innerJoin(employees, eq(breakSessions.employeeId, employees.id))
    .innerJoin(users, eq(employees.userId, users.id))
    .where(and(eq(breakSessions.organizationId, user.organizationId), eq(breakSessions.areaId, areaId), eq(breakSessions.date, dateKey), eq(breakSessions.status, 'completed')))
    .orderBy(desc(breakSessions.endAt));

  return {
    records: rows.map((row) => ({
      id: row.id,
      employeeId: row.employeeUserId,
      employeeName: row.employeeName,
      department: row.department || '',
      type: row.type,
      startAt: row.startAt,
      endAt: row.endAt,
      durationMin: row.durationMin ?? row.durationLimitMin,
      exceeded: Boolean(row.durationMin && row.durationLimitMin && row.durationMin > row.durationLimitMin),
    })),
  };
}

export async function clearHistoryForDate(dateKey) {
  const user = await requireSupervisor();
  const result = await db.delete(breakSessions).where(and(eq(breakSessions.organizationId, user.organizationId), eq(breakSessions.date, dateKey), eq(breakSessions.status, 'completed'))).returning({ id: breakSessions.id });
  return { deleted: result.length };
}

export async function clearAllHistory() {
  const user = await requireSupervisor();
  const result = await db.delete(breakSessions).where(and(eq(breakSessions.organizationId, user.organizationId), eq(breakSessions.status, 'completed'))).returning({ id: breakSessions.id });
  return { deleted: result.length };
}

export async function getSettingsData() {
  const user = await requireSupervisor();
  const { settings, areas: areaRows } = await loadCurrentAreaContext(user.organizationId);
  return { settings, areas: areaRows };
}

export async function updateSettings(patch) {
  const user = await requireSupervisor();
  const { settings } = await ensureSettings(user.organizationId);
  const allowed = [
    'requireBreakStartApproval',
    'requireBreakReturnApproval',
    'enableBreakTimeMonitoring',
    'organizationName',
    'supervisorName',
    'currentAreaId',
    'pushNotifications',
    'breakReminder',
    'approvalNotifications',
    'passwordRequests',
  ];
  const next = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  await db.update(applicationSettings).set(next).where(eq(applicationSettings.id, settings.id));
  return { ok: true };
}

export async function listEmployees() {
  const user = await requireSupervisor();
  return { employees: await loadEmployeeProfiles(user.organizationId) };
}

export async function createEmployee(employee) {
  const user = await requireSupervisor();
  const authUser = await createSupabaseAccount({
    email: employee.email,
    password: employee.password,
    userData: {
      role: 'employee',
      name: employee.name,
      phone: employee.phone || '',
      department: employee.department || '',
      employeeRole: employee.employeeRole || '',
    },
  });
  const [userRow] = await db.insert(users).values({
    organizationId: user.organizationId,
    supabaseUserId: authUser.id,
    email: employee.email.toLowerCase().trim(),
    role: 'employee',
    name: employee.name,
    phone: employee.phone || '',
  }).returning();

  await db.insert(employees).values({
    userId: userRow.id,
    organizationId: user.organizationId,
    department: employee.department || '',
    employeeRole: employee.employeeRole || '',
    active: true,
  });

  return { ok: true };
}

export async function updateEmployee(employeeId, patch) {
  const user = await requireSupervisor();
  const profile = await db.query.users.findFirst({
    where: and(eq(users.organizationId, user.organizationId), eq(users.id, employeeId)),
  });
  if (!profile) throw new Error('Employee not found');
  const employee = await db.query.employees.findFirst({ where: eq(employees.userId, profile.id) });
  const admin = createSupabaseAdminClient();
  const nextUser = {
    email: patch.email ? patch.email.toLowerCase().trim() : profile.email,
    user_metadata: {
      role: profile.role,
      name: patch.name ?? profile.name,
      phone: patch.phone ?? profile.phone,
      department: patch.department ?? employee?.department ?? '',
      employeeRole: patch.employeeRole ?? employee?.employeeRole ?? '',
    },
  };
  const { error } = await admin.auth.admin.updateUserById(profile.supabaseUserId, nextUser);
  if (error) throw error;

  await db.update(users).set({
    email: nextUser.email,
    name: nextUser.user_metadata.name,
    phone: nextUser.user_metadata.phone,
    updatedAt: new Date(),
  }).where(eq(users.id, profile.id));

  if (employee) {
    await db.update(employees).set({
      department: nextUser.user_metadata.department,
      employeeRole: nextUser.user_metadata.employeeRole,
      updatedAt: new Date(),
    }).where(eq(employees.id, employee.id));
  }

  if (patch.password) {
    await updateSupabasePassword(profile.supabaseUserId, patch.password);
  }
  return { ok: true };
}

export async function deleteEmployee(employeeId) {
  const user = await requireSupervisor();
  const profile = await db.query.users.findFirst({
    where: and(eq(users.organizationId, user.organizationId), eq(users.id, employeeId)),
  });
  if (!profile) throw new Error('Employee not found');
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(profile.supabaseUserId);
  if (error) throw error;
  await db.delete(users).where(eq(users.id, profile.id));
  return { ok: true };
}

export async function resetEmployeePassword(employeeId, newPassword, requestId = null) {
  const user = await requireSupervisor();
  const profile = await db.query.users.findFirst({
    where: and(eq(users.organizationId, user.organizationId), eq(users.id, employeeId)),
  });
  if (!profile) throw new Error('Employee not found');
  await updateSupabasePassword(profile.supabaseUserId, newPassword);
  if (requestId) {
    await db.update(passwordResetRequests).set({
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedByUserId: user.id,
      updatedAt: new Date(),
    }).where(eq(passwordResetRequests.id, requestId));
  }
  return { ok: true };
}

export async function listAreas() {
  const user = await requireSupervisor();
  const rows = await db.select().from(areas).where(eq(areas.organizationId, user.organizationId)).orderBy(asc(areas.name));
  return { areas: rows };
}

export async function createArea(name) {
  const user = await requireSupervisor();
  const [row] = await db.insert(areas).values({ organizationId: user.organizationId, name }).returning();
  return { area: row };
}

export async function renameArea(areaId, name) {
  const user = await requireSupervisor();
  await db.update(areas).set({ name, updatedAt: new Date() }).where(and(eq(areas.organizationId, user.organizationId), eq(areas.id, areaId)));
  return { ok: true };
}

export async function deleteArea(areaId) {
  const user = await requireSupervisor();
  await db.delete(areas).where(and(eq(areas.organizationId, user.organizationId), eq(areas.id, areaId)));
  return { ok: true };
}

export async function listPasswordRequests() {
  const user = await requireSupervisor();
  const rows = await db
    .select({
      id: passwordResetRequests.id,
      userId: passwordResetRequests.userId,
      requestedByUserId: passwordResetRequests.requestedByUserId,
      status: passwordResetRequests.status,
      requestedAt: passwordResetRequests.requestedAt,
      employeeName: users.name,
      employeeEmail: users.email,
    })
    .from(passwordResetRequests)
    .innerJoin(users, eq(passwordResetRequests.userId, users.id))
    .where(and(eq(passwordResetRequests.organizationId, user.organizationId), eq(passwordResetRequests.status, 'pending')))
    .orderBy(desc(passwordResetRequests.requestedAt));

  return {
    requests: rows.map((row) => ({
      id: row.id,
      employeeId: row.userId,
      employeeName: row.employeeName,
      employeeEmail: row.employeeEmail,
      status: row.status,
      requestedAt: row.requestedAt,
    })),
  };
}
