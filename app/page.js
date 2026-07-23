'use client';

import { useEffect, useState } from 'react';
import { api, getToken, setToken } from '@/lib/shiftops-client';
import { ensureNotifPermission, showBrowserNotif, fx } from '@/lib/shiftops-fx';
import Login from '@/components/shiftops/Login';
import Supervisor from '@/components/shiftops/Supervisor';
import Employee from '@/components/shiftops/Employee';

const LAST_NOTIF_KEY = 'shiftops_last_notif';

function useNotificationWatcher(user) {
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const check = async () => {
      try {
        const { notifications } = await api('/notifications');
        if (cancelled) return;
        const lastId = window.localStorage.getItem(LAST_NOTIF_KEY);
        // Find notifications newer than lastId (they come sorted desc)
        const newOnes = [];
        for (const n of notifications) {
          if (n.id === lastId) break;
          newOnes.push(n);
        }
        if (newOnes.length && lastId) {
          for (const n of newOnes.reverse()) {
            showBrowserNotif(n.title, n.body);
          }
          fx.notify();
        }
        if (notifications[0]) {
          window.localStorage.setItem(LAST_NOTIF_KEY, notifications[0].id);
        }
      } catch {}
    };
    check();
    const i = setInterval(check, 4000);
    return () => { cancelled = true; clearInterval(i); };
  }, [user?.id]);
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  const loadMe = async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try {
      const { user } = await api('/auth/me');
      setUser(user);
      // Prompt for notification permission on first login
      ensureNotifPermission();
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api('/seed', { method: 'POST' }).catch(() => {});
    loadMe();
  }, []);

  useNotificationWatcher(user);

  const handleLogout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setToken(null);
    setUser(null);
    if (typeof window !== 'undefined') window.localStorage.removeItem(LAST_NOTIF_KEY);
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
