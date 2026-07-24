'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { fx, ensureNotifPermission } from '@/lib/shiftops-fx';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@shiftops.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReset, setShowReset] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    fx.tap();
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      fx.success();
      // Prompt for notification permission on successful login (user gesture)
      ensureNotifPermission();
      await onLogin();
    } catch (err) {
      fx.error();
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F5F5F7' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1D1D1F]">ShiftOps</h1>
          <p className="text-[15px] text-[#8E8E93] mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-transparent outline-none text-[17px] text-[#1D1D1F] placeholder:text-[#8E8E93]"
              autoComplete="email"
              required
            />
          </div>
          <div className="px-4 py-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-transparent outline-none text-[17px] text-[#1D1D1F] placeholder:text-[#8E8E93]"
              autoComplete="current-password"
              required
            />
          </div>
        </form>

        {error && (
          <div className="mt-3 text-[14px] text-[#FF3B30] text-center">{error}</div>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full mt-4 rounded-xl py-3.5 text-[17px] font-semibold text-white disabled:opacity-50 active:opacity-80 transition"
          style={{ background: '#007AFF' }}
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        <button
          type="button"
          onClick={() => setShowReset(!showReset)}
          className="w-full mt-3 text-[15px] text-[#007AFF] text-center"
        >
          Forgot Password?
        </button>

        {showReset && (
          <div className="mt-4 p-4 bg-white rounded-2xl text-[14px] text-[#8E8E93] leading-relaxed">
            Contact your supervisor to reset your password. Or sign in and request a reset from your profile.
          </div>
        )}

      </div>
    </div>
  );
}
