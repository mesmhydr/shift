import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!databaseUrl || !supabaseUrl || !serviceRoleKey) {
  throw new Error('DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required');
}

const sql = postgres(databaseUrl);
const supabase = createClient(supabaseUrl, serviceRoleKey);

function uuid() {
  return crypto.randomUUID();
}

async function main() {
  const orgId = uuid();
  const areaId = uuid();

  await sql.begin(async (tx) => {
    await tx`insert into organizations (id, name) values (${orgId}, 'ShiftOps Ops Center')`;
    await tx`
      insert into areas (id, organization_id, name)
      values (${areaId}, ${orgId}, 'Lobby')
    `;
    await tx`
      insert into application_settings (
        id, organization_id, current_area_id, require_break_start_approval,
        require_break_return_approval, enable_break_time_monitoring, push_notifications,
        break_reminder, approval_notifications, password_requests, organization_name,
        supervisor_name
      ) values (
        ${uuid()}, ${orgId}, ${areaId}, true, false, true, true, true, true, true,
        'ShiftOps Ops Center', 'Alex Morgan'
      )
    `;
  });

  const supervisor = {
    email: 'admin@shiftops.com',
    password: 'admin123',
    name: 'Alex Morgan',
    role: 'supervisor',
    phone: '+1 555 0100',
    department: 'Operations',
    employeeRole: 'Duty Supervisor',
  };

  const { data, error } = await supabase.auth.admin.createUser({
    email: supervisor.email,
    password: supervisor.password,
    email_confirm: true,
    user_metadata: {
      role: supervisor.role,
      name: supervisor.name,
      phone: supervisor.phone,
      department: supervisor.department,
      employeeRole: supervisor.employeeRole,
    },
  });
  if (error) throw error;

  const userId = uuid();
  await sql`
    insert into users (id, organization_id, supabase_user_id, email, role, name, phone)
    values (${userId}, ${orgId}, ${data.user.id}, ${supervisor.email}, ${supervisor.role}, ${supervisor.name}, ${supervisor.phone})
  `;

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
