import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['supervisor', 'employee']);
export const breakType = pgEnum('break_type', ['lunch', 'tea']);
export const breakStatus = pgEnum('break_status', ['pending', 'active', 'pending_return', 'completed', 'rejected']);
export const passwordRequestStatus = pgEnum('password_request_status', ['pending', 'resolved', 'rejected']);

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  supabaseUserId: uuid('supabase_user_id').notNull().unique(),
  email: text('email').notNull(),
  role: userRole('role').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgEmailIdx: uniqueIndex('users_org_email_unique').on(table.organizationId, table.email),
  orgRoleIdx: index('users_org_role_idx').on(table.organizationId, table.role),
}));

export const employees = pgTable('employees', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  department: text('department').notNull().default(''),
  employeeRole: text('employee_role').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const areas = pgTable('areas', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgNameIdx: uniqueIndex('areas_org_name_unique').on(table.organizationId, table.name),
}));

export const rosters = pgTable('rosters', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  areaId: uuid('area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
  rosterDate: date('roster_date').notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueRoster: uniqueIndex('rosters_unique_day').on(table.organizationId, table.areaId, table.rosterDate),
  rosterDateIdx: index('rosters_date_idx').on(table.organizationId, table.rosterDate),
}));

export const rosterAssignments = pgTable('roster_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  rosterId: uuid('roster_id').notNull().references(() => rosters.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueAssignment: uniqueIndex('roster_assignments_unique').on(table.rosterId, table.employeeId),
  employeeIdx: index('roster_assignments_employee_idx').on(table.employeeId),
}));

export const breakSessions = pgTable('break_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  rosterId: uuid('roster_id').references(() => rosters.id, { onDelete: 'set null' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  areaId: uuid('area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  type: breakType('type').notNull(),
  status: breakStatus('status').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  durationLimitMin: integer('duration_limit_min').notNull(),
  durationMin: integer('duration_min'),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  employeeDateIdx: index('break_sessions_employee_date_idx').on(table.employeeId, table.date),
  areaDateIdx: index('break_sessions_area_date_idx').on(table.areaId, table.date),
  statusIdx: index('break_sessions_status_idx').on(table.status),
}));

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  meta: jsonb('meta').notNull().default({}),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('notifications_user_idx').on(table.userId),
  createdIdx: index('notifications_created_idx').on(table.createdAt),
}));

export const passwordResetRequests = pgTable('password_reset_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  status: passwordRequestStatus('status').notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('password_reset_requests_user_idx').on(table.userId),
  statusIdx: index('password_reset_requests_status_idx').on(table.status),
}));

export const applicationSettings = pgTable('application_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  currentAreaId: uuid('current_area_id').references(() => areas.id, { onDelete: 'set null' }),
  requireBreakStartApproval: boolean('require_break_start_approval').notNull().default(true),
  requireBreakReturnApproval: boolean('require_break_return_approval').notNull().default(false),
  enableBreakTimeMonitoring: boolean('enable_break_time_monitoring').notNull().default(true),
  pushNotifications: boolean('push_notifications').notNull().default(true),
  breakReminder: boolean('break_reminder').notNull().default(true),
  approvalNotifications: boolean('approval_notifications').notNull().default(true),
  passwordRequests: boolean('password_requests').notNull().default(true),
  organizationName: text('organization_name').notNull().default('ShiftOps'),
  supervisorName: text('supervisor_name').notNull().default('Supervisor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
