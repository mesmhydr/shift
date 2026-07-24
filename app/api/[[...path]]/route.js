import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/shiftops/db';
import { hashPassword, verifyPassword, newToken, getUserFromRequest } from '@/lib/shiftops/auth';
import { todayStr } from "@/lib/date";
import { londonNow } from "@/lib/date";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BREAK_DURATIONS = { lunch: 30, tea: 15 }; // minutes

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function ensureSeed() {
  const db = await getDb();
  const existing = await db.collection('users').findOne({ role: 'supervisor' });
  if (existing) return { seeded: false };

  const areaId = uuidv4();
  await db.collection('areas').insertOne({ id: areaId, name: 'Lobby', createdAt: new Date() });

  const supervisorId = uuidv4();
  await db.collection('users').insertOne({
    id: supervisorId,
    email: 'admin@shiftops.io',
    password: hashPassword('admin123'),
    name: 'Alex Morgan',
    role: 'supervisor',
    phone: '+1 555 0100',
    department: 'Operations',
    employeeRole: 'Duty Supervisor',
    createdAt: new Date(),
  });

  const employees = [
    { name: 'Sarah Chen', email: 'sarah@shiftops.io', department: 'Guest Services', employeeRole: 'Agent' },
    { name: 'John Reyes', email: 'john@shiftops.io', department: 'Guest Services', employeeRole: 'Senior Agent' },
    { name: 'Michael Park', email: 'michael@shiftops.io', department: 'Ground Ops', employeeRole: 'Agent' },
    { name: 'David Kumar', email: 'david@shiftops.io', department: 'Ground Ops', employeeRole: 'Team Lead' },
    { name: 'Emma Wright', email: 'emma@shiftops.io', department: 'Guest Services', employeeRole: 'Agent' },
  ];
  const empIds = [];
  for (const e of employees) {
    const id = uuidv4();
    empIds.push(id);
    await db.collection('users').insertOne({
      id,
      email: e.email,
      password: hashPassword('emp123'),
      name: e.name,
      role: 'employee',
      phone: '+1 555 0' + (100 + empIds.length),
      department: e.department,
      employeeRole: e.employeeRole,
      createdAt: new Date(),
    });
  }

  // Today's roster
  await db.collection('rosters').insertOne({
    id: uuidv4(),
    areaId,
    date: todayStr(),
    employeeIds: empIds,
    createdAt: new Date(),
  });

  // Settings
  await db.collection('settings').insertOne({
    id: 'global',
    requireBreakStartApproval: true,
    requireBreakReturnApproval: false,
    enableBreakTimeMonitoring: true,
    organizationName: 'ShiftOps Ops Center',
    supervisorName: 'Alex Morgan',
    currentAreaId: areaId,
    pushNotifications: true,
    breakReminder: true,
    approvalNotifications: true,
    passwordRequests: true,
  });

  return { seeded: true };
}

async function getSettings() {
  const db = await getDb();
  let s = await db.collection('settings').findOne({ id: 'global' });
  if (!s) {
    const area = await db.collection('areas').findOne({});
    s = {
      id: 'global',
      requireBreakStartApproval: true,
      requireBreakReturnApproval: false,
      enableBreakTimeMonitoring: true,
      organizationName: 'ShiftOps',
      supervisorName: 'Supervisor',
      currentAreaId: area?.id || null,
    };
    await db.collection('settings').insertOne(s);
  }
  return s;
}

async function notify(userId, title, body, meta = {}) {
  const db = await getDb();
  await db.collection('notifications').insertOne({
    id: uuidv4(),
    userId,
    title,
    body,
    meta,
    read: false,
    createdAt: new Date(),
  });
}

async function notifySupervisors(title, body, meta = {}) {
  const db = await getDb();
  const sups = await db.collection('users').find({ role: 'supervisor' }).toArray();
  for (const s of sups) await notify(s.id, title, body, meta);
}

async function computeEmployeeStatus(employeeId, areaId, date) {
  const db = await getDb();
  // Consider ALL sessions for this employee today (any area) so switching areas
  // doesn't allow duplicate breaks.
  const sessions = await db.collection('break_sessions')
    .find({ employeeId, date })
    .toArray();

  // Pick the "authoritative" session per type: prefer non-rejected; among those,
  // prefer active states over completed.
  const pickForType = (type) => {
    const list = sessions.filter(s => s.type === type);
    if (list.length === 0) return null;
    const nonRejected = list.filter(s => s.status !== 'rejected');
    if (nonRejected.length > 0) {
      const prio = { active: 0, pending: 1, pending_return: 2, completed: 3 };
      nonRejected.sort((a, b) => (prio[a.status] ?? 99) - (prio[b.status] ?? 99));
      return nonRejected[0];
    }
    return null; // all rejected => treat as not taken
  };

  const lunch = pickForType('lunch');
  const tea = pickForType('tea');

  const active = sessions.find(s => ['pending', 'active', 'pending_return'].includes(s.status));

  let currentStatus = 'Working';
  if (active) {
    if (active.status === 'pending') currentStatus = 'Pending Approval';
    else if (active.status === 'active') currentStatus = 'On Break';
    else if (active.status === 'pending_return') currentStatus = 'Pending Return';
  }

  const summarize = (s) => {
    if (!s) return { status: 'Not Taken' };
    if (s.status === 'completed') return { status: 'Completed', durationMin: s.durationMin, durationSec: s.durationSec, startAt: s.startAt, endAt: s.endAt };
    if (s.status === 'rejected') return { status: 'Not Taken' };
    if (s.status === 'pending') return { status: 'Pending', sessionId: s.id, type: s.type };
    if (s.status === 'active') return { status: 'Running', sessionId: s.id, startAt: s.startAt, type: s.type };
    if (s.status === 'pending_return') return { status: 'Pending Return', sessionId: s.id, startAt: s.startAt, type: s.type };
    return { status: 'Not Taken' };
  };

  return {
    currentStatus,
    lunch: summarize(lunch),
    tea: summarize(tea),
    activeSession: active || null,
  };
}

async function handle(request, params, method) {
  await ensureSeed();
  const parts = (params.path || []);
  const p0 = parts[0];
  const p1 = parts[1];
  const p2 = parts[2];
  const url = new URL(request.url);
  const q = Object.fromEntries(url.searchParams);
  let body = {};
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    try { body = await request.json(); } catch { body = {}; }
  }
  const db = await getDb();

  // ---------- PUBLIC ----------
  if (p0 === 'ping' && method === 'GET') return json({ ok: true, ts: Date.now() });

  if (p0 === 'seed' && method === 'POST') {
    const r = await ensureSeed();
    return json(r);
  }

  // ---------- AUTH ----------
  if (p0 === 'auth' && p1 === 'login' && method === 'POST') {
    const { email, password } = body;
    if (!email || !password) return json({ error: 'Email and password required' }, 400);
    const user = await db.collection('users').findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !verifyPassword(password, user.password)) {
      return json({ error: 'Invalid credentials' }, 401);
    }
    const token = newToken();
    await db.collection('sessions').insertOne({
      token, userId: user.id, createdAt: new Date(),
    });
    return json({
      token,
      user: { ...user, password: undefined, _id: undefined },
    });
  }

  // Everything below requires auth
  const me = await getUserFromRequest(request);

  if (p0 === 'auth' && p1 === 'me' && method === 'GET') {
    if (!me) return json({ error: 'Unauthorized' }, 401);
    return json({ user: { ...me, _id: undefined } });
  }

  if (!me) return json({ error: 'Unauthorized' }, 401);

  if (p0 === 'auth' && p1 === 'logout' && method === 'POST') {
    const auth = request.headers.get('authorization');
    const token = auth?.replace(/^Bearer\s+/i, '').trim();
    if (token) await db.collection('sessions').deleteOne({ token });
    return json({ ok: true });
  }

  if (p0 === 'auth' && p1 === 'change-password' && method === 'POST') {
    const { currentPassword, newPassword } = body;
    const user = await db.collection('users').findOne({ id: me.id });
    if (!verifyPassword(currentPassword, user.password)) return json({ error: 'Current password is incorrect' }, 400);
    if (!newPassword || newPassword.length < 4) return json({ error: 'New password too short' }, 400);
    await db.collection('users').updateOne({ id: me.id }, { $set: { password: hashPassword(newPassword) } });
    return json({ ok: true });
  }

  if (p0 === 'auth' && p1 === 'request-password-reset' && method === 'POST') {
    await db.collection('password_requests').insertOne({
      id: uuidv4(), employeeId: me.id, status: 'pending', requestedAt: new Date(),
    });
    await notifySupervisors('Password Reset Request', `${me.name} requested a password reset`, { employeeId: me.id });
    return json({ ok: true });
  }

  // ---------- SETTINGS ----------
  if (p0 === 'settings' && method === 'GET') {
    const s = await getSettings();
    return json({ settings: s });
  }
  if (p0 === 'settings' && method === 'PATCH') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    await db.collection('settings').updateOne({ id: 'global' }, { $set: body }, { upsert: true });
    const s = await getSettings();
    return json({ settings: s });
  }

  // ---------- AREAS ----------
  if (p0 === 'areas' && method === 'GET') {
    const areas = await db.collection('areas').find({}).toArray();
    return json({ areas: areas.map(a => ({ id: a.id, name: a.name })) });
  }
  if (p0 === 'areas' && !p1 && method === 'POST') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const id = uuidv4();
    await db.collection('areas').insertOne({ id, name: body.name || 'New Area', createdAt: new Date() });
    return json({ id, name: body.name || 'New Area' });
  }
  if (p0 === 'areas' && p1 && method === 'PATCH') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    await db.collection('areas').updateOne({ id: p1 }, { $set: { name: body.name } });
    return json({ ok: true });
  }
  if (p0 === 'areas' && p1 && method === 'DELETE') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const count = await db.collection('areas').countDocuments({});
    if (count <= 1) return json({ error: 'Cannot delete the last area' }, 400);
    await db.collection('areas').deleteOne({ id: p1 });
    return json({ ok: true });
  }

  // ---------- EMPLOYEES ----------
  if (p0 === 'employees' && method === 'GET') {
    const emps = await db.collection('users').find({ role: 'employee' }).toArray();
    return json({
      employees: emps.map(e => ({
        id: e.id, name: e.name, email: e.email, phone: e.phone,
        department: e.department, employeeRole: e.employeeRole,
      })),
    });
  }
  if (p0 === 'employees' && !p1 && method === 'POST') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const { name, email, password, phone, department, employeeRole } = body;
    if (!name || !email || !password) return json({ error: 'Name, email, password required' }, 400);
    const existing = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
    if (existing) return json({ error: 'Email already exists' }, 400);
    const id = uuidv4();
    await db.collection('users').insertOne({
      id, name, email: email.toLowerCase().trim(),
      password: hashPassword(password),
      phone: phone || '', department: department || '', employeeRole: employeeRole || '',
      role: 'employee', createdAt: new Date(),
    });
    return json({ id });
  }
  if (p0 === 'employees' && p1 && method === 'PATCH') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const upd = {};
    ['name', 'email', 'phone', 'department', 'employeeRole'].forEach(k => {
      if (body[k] !== undefined) upd[k] = body[k];
    });
    await db.collection('users').updateOne({ id: p1, role: 'employee' }, { $set: upd });
    return json({ ok: true });
  }
  if (p0 === 'employees' && p1 && method === 'DELETE') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    await db.collection('users').deleteOne({ id: p1, role: 'employee' });
    // Remove from rosters
    await db.collection('rosters').updateMany({}, { $pull: { employeeIds: p1 } });
    return json({ ok: true });
  }
  if (p0 === 'employees' && p1 && p2 === 'reset-password' && method === 'POST') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const { newPassword, requestId } = body;
    if (!newPassword || newPassword.length < 4) return json({ error: 'Password too short' }, 400);
    await db.collection('users').updateOne({ id: p1 }, { $set: { password: hashPassword(newPassword) } });
    if (requestId) {
      await db.collection('password_requests').updateOne({ id: requestId }, { $set: { status: 'resolved', resolvedAt: new Date() } });
    }
    await notify(p1, 'Password Reset', 'Your password was reset by your supervisor.');
    return json({ ok: true });
  }

  // ---------- PASSWORD REQUESTS ----------
  if (p0 === 'password-requests' && method === 'GET') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const reqs = await db.collection('password_requests').find({ status: 'pending' }).sort({ requestedAt: -1 }).toArray();
    const emps = await db.collection('users').find({ id: { $in: reqs.map(r => r.employeeId) } }).toArray();
    const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
    return json({
      requests: reqs.map(r => ({
        id: r.id, employeeId: r.employeeId,
        employeeName: empMap[r.employeeId]?.name || 'Unknown',
        employeeEmail: empMap[r.employeeId]?.email,
        requestedAt: r.requestedAt,
      })),
    });
  }

  // ---------- ROSTERS ----------
  if (p0 === 'rosters' && p1 === 'calendar' && method === 'GET') {
    const { areaId, month } = q; // month = YYYY-MM
    if (!areaId || !month) return json({ error: 'areaId and month required' }, 400);
    const rosters = await db.collection('rosters').find({
      areaId,
      date: { $regex: `^${month}` },
    }).toArray();
    return json({
      dates: rosters.map(r => ({ date: r.date, count: r.employeeIds.length })),
    });
  }
  if (p0 === 'rosters' && method === 'GET') {
    const { areaId, date } = q;
    if (!areaId || !date) return json({ error: 'areaId and date required' }, 400);
    const roster = await db.collection('rosters').findOne({ areaId, date });
    if (!roster) return json({ roster: null });
    const emps = await db.collection('users').find({ id: { $in: roster.employeeIds } }).toArray();
    return json({
      roster: {
        id: roster.id, areaId, date,
        employees: emps.map(e => ({
          id: e.id, name: e.name, department: e.department, employeeRole: e.employeeRole,
        })),
      },
    });
  }
  if (p0 === 'rosters' && !p1 && method === 'POST') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const { areaId, date, employeeIds } = body;
    if (!areaId || !date || !Array.isArray(employeeIds)) return json({ error: 'Invalid' }, 400);
    const existing = await db.collection('rosters').findOne({ areaId, date });
    if (existing) {
      await db.collection('rosters').updateOne({ id: existing.id }, { $set: { employeeIds } });
      return json({ id: existing.id });
    }
    const id = uuidv4();
    await db.collection('rosters').insertOne({ id, areaId, date, employeeIds, createdAt: new Date() });
    return json({ id });
  }
  if (p0 === 'rosters' && p1 && method === 'DELETE') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    await db.collection('rosters').deleteOne({ id: p1 });
    return json({ ok: true });
  }

  // ---------- DASHBOARD ----------
  if (p0 === 'dashboard' && method === 'GET') {
    const settings = await getSettings();
    const areaId = q.areaId || settings.currentAreaId;
    const date = q.date || todayStr();

    
const roster = await db.collection("rosters").findOne({ areaId, date });

const allRosters = await db
  .collection("rosters")
  .find({ areaId })
  .toArray();

    if (!areaId) return json({ error: 'No area' }, 400);
    const empIds = roster ? roster.employeeIds : [];
    const emps = await db.collection('users').find({ id: { $in: empIds } }).toArray();
    const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
    const rows = [];
    for (const eid of empIds) {
      const st = await computeEmployeeStatus(eid, areaId, date);
      const e = empMap[eid];
      if (!e) continue;
      rows.push({
        id: e.id, name: e.name, department: e.department, employeeRole: e.employeeRole,
        currentStatus: st.currentStatus, lunch: st.lunch, tea: st.tea,
        activeSession: st.activeSession ? {
          id: st.activeSession.id, type: st.activeSession.type, status: st.activeSession.status,
          startAt: st.activeSession.startAt,
        } : null,
      });
    }
    // Summary
    const summary = {
      working: rows.filter(r => r.currentStatus === 'Working').length,
      onBreak: rows.filter(r => r.currentStatus === 'On Break').length,
      pendingApproval: rows.filter(r => r.currentStatus === 'Pending Approval' || r.currentStatus === 'Pending Return').length,
      lunchCompleted: rows.filter(r => r.lunch.status === 'Completed').length,
      teaCompleted: rows.filter(r => r.tea.status === 'Completed').length,
    };
    return json({ areaId, date, summary, employees: rows });
  }

  // ---------- EMPLOYEE SELF STATUS ----------
  if (p0 === 'my' && p1 === 'status' && method === 'GET') {
    const settings = await getSettings();
    const date = todayStr();
    // Find employee's roster for today
    const rosters = await db.collection('rosters').find({ date, employeeIds: me.id }).toArray();
    if (rosters.length === 0) {
      return json({ scheduled: false });
    }
    const roster = rosters[0];
    const st = await computeEmployeeStatus(me.id, roster.areaId, date);
    const area = await db.collection('areas').findOne({ id: roster.areaId });
    return json({
      scheduled: true, areaId: roster.areaId, areaName: area?.name || '',
      currentStatus: st.currentStatus,
      lunch: st.lunch, tea: st.tea,
      activeSession: st.activeSession ? {
        id: st.activeSession.id, type: st.activeSession.type, status: st.activeSession.status,
        startAt: st.activeSession.startAt,
      } : null,
      settings: {
        requireBreakStartApproval: settings.requireBreakStartApproval,
        requireBreakReturnApproval: settings.requireBreakReturnApproval,
      },
    });
  }

  // ---------- BREAKS ----------
  // Employee requests break
  if (p0 === 'breaks' && p1 === 'request' && method === 'POST') {
    const { type } = body;
    if (!['lunch', 'tea'].includes(type)) return json({ error: 'Invalid type' }, 400);
    const date = todayStr();
    const roster = await db.collection('rosters').findOne({ date, employeeIds: me.id });
    if (!roster) return json({ error: 'You are not on today\'s roster' }, 400);
    const areaId = roster.areaId;
    // Check existing (any area today) - block if any non-rejected same-type session exists
    const existing = await db.collection('break_sessions').findOne({ employeeId: me.id, date, type, status: { $ne: 'rejected' } });
    if (existing) return json({ error: `${type} already used` }, 400);
    // Active break in progress (any type, any area)
    const active = await db.collection('break_sessions').findOne({ employeeId: me.id, date, status: { $in: ['pending', 'active', 'pending_return'] } });
    if (active) return json({ error: 'You already have an active break' }, 400);
    const settings = await getSettings();
    const id = uuidv4();
    const requireApproval = settings.requireBreakStartApproval;
    const now = new Date();
    await db.collection('break_sessions').insertOne({
      id, employeeId: me.id, areaId, date, type,
      status: requireApproval ? 'pending' : 'active',
      requestedAt: now,
      startAt: requireApproval ? null : now,
      durationLimitMin: BREAK_DURATIONS[type],
      createdAt: now,
    });
    await notifySupervisors(
      requireApproval ? 'Break Requested' : 'Break Started',
      `${me.name} — ${type === 'lunch' ? 'Lunch' : 'Tea'}${requireApproval ? ' (awaiting approval)' : ''}`,
      { employeeId: me.id, sessionId: id, type }
    );
    return json({ id, status: requireApproval ? 'pending' : 'active' });
  }

  // Supervisor manually starts break for employee
  if (p0 === 'breaks' && p1 === 'start' && method === 'POST') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const { employeeId, type } = body;
    if (!['lunch', 'tea'].includes(type)) return json({ error: 'Invalid type' }, 400);
    const date = todayStr();
    const roster = await db.collection('rosters').findOne({ date, employeeIds: employeeId });
    if (!roster) return json({ error: 'Employee not on roster' }, 400);
    const areaId = roster.areaId;
    const existing = await db.collection('break_sessions').findOne({ employeeId, date, type, status: { $ne: 'rejected' } });
    if (existing) return json({ error: `${type} already used` }, 400);
    const active = await db.collection('break_sessions').findOne({ employeeId, date, status: { $in: ['pending', 'active', 'pending_return'] } });
    if (active) return json({ error: 'Employee already on a break' }, 400);
    const id = uuidv4();
    const now = new Date();
    await db.collection('break_sessions').insertOne({
      id, employeeId, areaId, date, type,
      status: 'active',
      startAt: now, requestedAt: now,
      durationLimitMin: BREAK_DURATIONS[type],
      createdAt: now,
    });
    await notify(employeeId, 'Break Started', `Your ${type} break has started.`);
    return json({ id });
  }

  // Supervisor approves
  if (p0 === 'breaks' && p1 && p2 === 'approve' && method === 'POST') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const sess = await db.collection('break_sessions').findOne({ id: p1 });
    if (!sess) return json({ error: 'Not found' }, 404);
    if (sess.status === 'pending') {
      await db.collection('break_sessions').updateOne({ id: p1 }, { $set: { status: 'active', startAt: new Date() } });
      await notify(sess.employeeId, 'Break Approved', `Your ${sess.type} break was approved.`);
    } else if (sess.status === 'pending_return') {
      const endAt = new Date();
const durationSec = Math.floor((endAt - new Date(sess.startAt)) / 1000);
const durationMin = Math.floor(durationSec / 60);

await db.collection('break_sessions').updateOne(
  { id: p1 },
  {
    $set: {
      status: 'completed',
      endAt,
      durationMin,
      durationSec,
    },
  }
);
      await notify(sess.employeeId, 'Return Approved', 'Welcome back to work.');
    }
    return json({ ok: true });
  }

  // Supervisor rejects
  if (p0 === 'breaks' && p1 && p2 === 'reject' && method === 'POST') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const sess = await db.collection('break_sessions').findOne({ id: p1 });
    if (!sess) return json({ error: 'Not found' }, 404);
    await db.collection('break_sessions').updateOne({ id: p1 }, { $set: { status: 'rejected', endAt: new Date() } });
    await notify(sess.employeeId, 'Break Rejected', `Your ${sess.type} break was rejected.`);
    return json({ ok: true });
  }

  // Employee return
  if (p0 === 'breaks' && p1 === 'return' && method === 'POST') {
    const date = todayStr();
    const active = await db.collection('break_sessions').findOne({ employeeId: me.id, date, status: { $in: ['active', 'pending_return'] } });
    if (!active) return json({ error: 'No active break' }, 400);
    if (active.status === 'pending_return') return json({ error: 'Return already requested' }, 400);
    const settings = await getSettings();
    if (settings.requireBreakReturnApproval) {
      await db.collection('break_sessions').updateOne({ id: active.id }, { $set: { status: 'pending_return' } });
      await notifySupervisors('Return Request', `${me.name} is requesting to return from ${active.type}.`, { employeeId: me.id, sessionId: active.id });
      return json({ status: 'pending_return' });
    }
    const endAt = new Date();
    const durationSec = Math.floor((endAt - new Date(active.startAt)) / 1000);
    const durationMin = Math.floor(durationSec / 60);
    await db.collection('break_sessions').updateOne({ id: active.id }, { $set: {
  status: 'completed',
  endAt,
  durationMin,
  durationSec,
} });
    await notifySupervisors('Employee Returned', `${me.name} returned from ${active.type} (${durationMin} min).`, { employeeId: me.id });
    return json({ status: 'completed', durationMin });
  }

  // Supervisor manual end
  if (p0 === 'breaks' && p1 && p2 === 'end' && method === 'POST') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const sess = await db.collection('break_sessions').findOne({ id: p1 });
    if (!sess) return json({ error: 'Not found' }, 404);
    if (!['active', 'pending_return'].includes(sess.status)) return json({ error: 'Not active' }, 400);
    const endAt = new Date();
const durationSec = Math.floor((endAt - new Date(sess.startAt)) / 1000);
const durationMin = Math.floor(durationSec / 60);

await db.collection('break_sessions').updateOne(
  { id: p1 },
  {
    $set: {
      status: 'completed',
      endAt,
      durationMin,
      durationSec,
    },
  }
);await notify(sess.employeeId, 'Break Ended', 'Your break was ended by the supervisor.');
    return json({ ok: true });
  }

  // ---------- HISTORY ----------
  if (p0 === 'history' && method === 'GET') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const settings = await getSettings();
    const areaId = q.areaId || settings.currentAreaId;
    const date = q.date || todayStr();
    const sessions = await db.collection('break_sessions')
      .find({ areaId, date, status: 'completed' })
      .sort({ endAt: -1 })
      .toArray();
    const emps = await db.collection('users').find({ id: { $in: sessions.map(s => s.employeeId) } }).toArray();
    const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
    return json({
      records: sessions.map(s => ({
  id: s.id,
  employeeName: empMap[s.employeeId]?.name || 'Unknown',
  department: empMap[s.employeeId]?.department || '',
  type: s.type,
  startAt: s.startAt,
  endAt: s.endAt,
  durationMin: s.durationMin,
  durationSec: s.durationSec,
  exceeded: s.durationMin > BREAK_DURATIONS[s.type],
})),
    });
  }

  // Delete history (all completed breaks for area+date, or all for area)
  if (p0 === 'history' && method === 'DELETE') {
    if (me.role !== 'supervisor') return json({ error: 'Forbidden' }, 403);
    const settings = await getSettings();
    const areaId = q.areaId || settings.currentAreaId;
    const filter = { areaId, status: 'completed' };
    if (q.date) filter.date = q.date;
    if (q.all !== '1' && !q.date) return json({ error: 'Specify date or all=1' }, 400);
    const r = await db.collection('break_sessions').deleteMany(filter);
    return json({ deleted: r.deletedCount });
  }

  // ---------- NOTIFICATIONS ----------
  if (p0 === 'notifications' && method === 'GET') {
    const list = await db.collection('notifications').find({ userId: me.id }).sort({ createdAt: -1 }).limit(100).toArray();
    return json({
      notifications: list.map(n => ({
        id: n.id, title: n.title, body: n.body, read: n.read, createdAt: n.createdAt,
      })),
    });
  }
  if (p0 === 'notifications' && p1 === 'read-all' && method === 'POST') {
    await db.collection('notifications').updateMany({ userId: me.id, read: false }, { $set: { read: true } });
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

export async function GET(request, ctx) { return handle(request, await ctx.params, 'GET'); }
export async function POST(request, ctx) { return handle(request, await ctx.params, 'POST'); }
export async function PATCH(request, ctx) { return handle(request, await ctx.params, 'PATCH'); }
export async function PUT(request, ctx) { return handle(request, await ctx.params, 'PUT'); }
export async function DELETE(request, ctx) { return handle(request, await ctx.params, 'DELETE'); }
