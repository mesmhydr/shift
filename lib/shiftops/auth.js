import crypto from 'crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 50000, 64, 'sha512')
    .toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;

  const [salt, hash] = stored.split(':');
  const check = crypto
    .pbkdf2Sync(password, salt, 50000, 64, 'sha512')
    .toString('hex');

  return check === hash;
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function createSupabaseRouteClient(request, response) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({
              name,
              value,
              ...options,
            });
          });
        },
      },
    }
  );
}

export function createSupabaseAdminClient() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error('Supabase auth environment variables are required');
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function getUserFromRequest() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();

  if (error || !authUser) {
    return null;
  }

  const profile = await db.query.users.findFirst({
    where: eq(users.supabaseUserId, authUser.id),
  });

  if (!profile) {
    return null;
  }

  return {
    ...profile,
    email: profile.email || authUser.email || '',
  };
}

export async function getUserProfileBySupabaseId(supabaseUserId) {
  if (!supabaseUserId) return null;

  return await db.query.users.findFirst({
    where: eq(users.supabaseUserId, supabaseUserId),
  });
}

export async function verifyCredentials(email, password) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return { ok: false };
  }

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const result = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (result.error || !result.data.user) {
    return { ok: false };
  }

  return {
    ok: true,
    user: result.data.user,
  };
}

export async function updateSupabasePassword(supabaseUserId, password) {
  const admin = createSupabaseAdminClient();

  const { error } = await admin.auth.admin.updateUserById(supabaseUserId, {
    password,
  });

  if (error) {
    throw error;
  }
}

export async function createSupabaseAccount({
  email,
  password,
  userData = {},
}) {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: userData,
  });

  if (error) {
    throw error;
  }

  return data.user;
}

export async function ensureSupabasePassword(supabaseUserId, password) {
  if (!supabaseUserId || !password) return;

  await updateSupabasePassword(supabaseUserId, password);
}