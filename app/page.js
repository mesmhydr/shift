'use client';

import { useEffect, useState } from 'react';
import { api, getToken, setToken } from '@/lib/shiftops-client';
import Login from '@/components/shiftops/Login';
import Supervisor from '@/components/shiftops/Supervisor';
import Employee from '@/components/shiftops/Employee';

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  const loadMe = async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try {
      const { user } = await api('/auth/me');
      setUser(user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // ensure seed
    api('/seed', { method: 'POST' }).catch(() => {});
    loadMe();
  }, []);

  const handleLogout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setToken(null);
    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F5F5F7' }}>
        <div className="text-[#8E8E93] text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) return <Login onLogin={loadMe} />;
  if (user.role === 'supervisor') return <Supervisor user={user} onLogout={handleLogout} />;
  return <Employee user={user} onLogout={handleLogout} refreshUser={loadMe} />;
}
