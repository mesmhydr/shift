'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/shiftops-client';
import { fx, getHaptics, setHaptics, getSounds, setSounds, ensureNotifPermission } from '@/lib/shiftops-fx';
import { BottomNav } from '@/components/shiftops/Supervisor';
import { Home as HomeIcon, Bell, User, Coffee, UtensilsCrossed, LogOut, KeyRound, Check, Vibrate, Volume2 } from 'lucide-react';

const C = {
  bg: '#F5F5F7', text: '#1D1D1F', muted: '#8E8E93', sep: 'rgba(0,0,0,0.06)',
  blue: '#007AFF', green: '#34C759', orange: '#FF9500', red: '#FF3B30',
};

const useNow = () => {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(i); }, []);
  return n;
};

function LargeTitle({ title, subtitle }) {
  return (
    <div className="px-5 pt-4">
      <h1 className="text-[34px] font-bold tracking-tight text-[#1D1D1F]">{title}</h1>
      {subtitle && <div className="text-[15px] text-[#8E8E93] mt-1">{subtitle}</div>}
    </div>
  );
}

function HomeTab({ user }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const now = useNow();

  const load = async () => {
    try { setStatus(await api('/my/status')); } finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    const i = setInterval(load, 2000);
    return () => clearInterval(i);
  }, []);

  const act = async (fn) => { fx.tap(); try { await fn(); fx.success(); await load(); } catch (e) { fx.error(); alert(e.message); } };

  if (loading) return <div className="p-6 text-[#8E8E93]">Loading…</div>;

  if (!status?.scheduled) {
    return (
      <div>
        <LargeTitle title={`Hi, ${user.name.split(' ')[0]}`} subtitle="Today" />
        <div className="mx-4 mt-6 p-8 bg-white rounded-3xl text-center" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(142,142,147,0.12)' }}>
            <HomeIcon size={28} className="text-[#8E8E93]" />
          </div>
          <div className="text-[18px] font-semibold text-[#1D1D1F]">Not on today's roster</div>
          <div className="text-[14px] text-[#8E8E93] mt-1">You have no shift scheduled today.</div>
        </div>
      </div>
    );
  }

  const cs = status.currentStatus;
  const active = status.activeSession;
  const remaining = active?.startAt ? (() => {
    const limit = (active.type === 'lunch' ? 30 : 15) * 60 * 1000;
    const el = now - new Date(active.startAt).getTime();
    const rem = limit - el;
    const s = Math.max(0, Math.floor(Math.abs(rem) / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return { text: `${m}:${String(sec).padStart(2, '0')}`, over: rem < 0 };
  })() : null;

  const bigCardBg = cs === 'On Break' ? '#007AFF' : cs.startsWith('Pending') ? C.orange : '#34C759';

  return (
    <div>
      <LargeTitle title={`Hi, ${user.name.split(' ')[0]}`} subtitle={`${status.areaName} · Today`} />

      <div className="mx-4 mt-4 rounded-3xl p-6 text-white" style={{ background: bigCardBg }}>
        <div className="text-[15px] font-medium opacity-90">Current Status</div>
        <div className="text-[32px] font-bold mt-1">{cs}</div>
        {active && (
          <div className="mt-4">
            <div className="text-[13px] font-medium uppercase tracking-wide opacity-80">
              {active.type === 'lunch' ? 'Lunch break' : 'Tea break'}
            </div>
            {active.status === 'active' && (
              <div className="text-[48px] font-bold tabular-nums mt-1">
                {remaining.text} {remaining.over && <span className="text-[16px] font-medium">over</span>}
              </div>
            )}
            {active.status === 'pending' && (
              <div className="text-[17px] mt-2 opacity-90">Waiting for supervisor approval…</div>
            )}
            {active.status === 'pending_return' && (
              <div className="text-[17px] mt-2 opacity-90">Return awaiting approval…</div>
            )}
          </div>
        )}
      </div>

      <div className="mx-4 mt-4 space-y-2">
        {active?.status === 'active' && (
          <button onClick={() => act(() => api('/breaks/return', { method: 'POST' }))}
            className="w-full rounded-2xl py-4 text-[17px] font-semibold text-white" style={{ background: C.blue }}>
            Return to Work
          </button>
        )}

        {!active && (
          <>
            {status.lunch.status === 'Not Taken' ? (
              <button onClick={() => act(() => api('/breaks/request', { method: 'POST', body: { type: 'lunch' } }))}
                className="w-full rounded-2xl py-4 text-[17px] font-semibold text-white flex items-center justify-center gap-2" style={{ background: C.orange }}>
                <UtensilsCrossed size={20} /> Request Lunch (30 min)
              </button>
            ) : (
              <div className="w-full rounded-2xl py-4 text-[17px] font-medium text-center flex items-center justify-center gap-2 bg-white text-[#8E8E93]">
                <UtensilsCrossed size={18} /> Lunch Completed · {status.lunch.durationMin} min
              </div>
            )}
            {status.tea.status === 'Not Taken' ? (
              <button onClick={() => act(() => api('/breaks/request', { method: 'POST', body: { type: 'tea' } }))}
                className="w-full rounded-2xl py-4 text-[17px] font-semibold text-white flex items-center justify-center gap-2" style={{ background: C.green }}>
                <Coffee size={20} /> Request Tea (15 min)
              </button>
            ) : (
              <div className="w-full rounded-2xl py-4 text-[17px] font-medium text-center flex items-center justify-center gap-2 bg-white text-[#8E8E93]">
                <Coffee size={18} /> Tea Completed · {status.tea.durationMin} min
              </div>
            )}
          </>
        )}

        {active?.status === 'pending' && (
          <div className="p-4 bg-white rounded-2xl text-[14px] text-[#8E8E93] text-center">
            Your request is pending supervisor approval.
          </div>
        )}
      </div>

      <div className="mt-6 mx-4 grid grid-cols-2 gap-2">
        <div className="bg-white rounded-2xl p-4">
          <div className="text-[13px] text-[#8E8E93] font-medium">Lunch</div>
          <div className="text-[20px] font-semibold text-[#1D1D1F] mt-1">
            {status.lunch.status === 'Completed' ? `${status.lunch.durationMin} min` :
              status.lunch.status === 'Not Taken' ? 'Available' :
                status.lunch.status}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4">
          <div className="text-[13px] text-[#8E8E93] font-medium">Tea</div>
          <div className="text-[20px] font-semibold text-[#1D1D1F] mt-1">
            {status.tea.status === 'Completed' ? `${status.tea.durationMin} min` :
              status.tea.status === 'Not Taken' ? 'Available' :
                status.tea.status}
          </div>
        </div>
      </div>

      <div className="h-24" />
    </div>
  );
}

function NotificationsTab() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { notifications } = await api('/notifications');
        setList(notifications);
        await api('/notifications/read-all', { method: 'POST' });
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div>
      <LargeTitle title="Notifications" />
      <div className="mx-4 mt-4 bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        {loading && <div className="p-6 text-center text-[#8E8E93]">Loading…</div>}
        {!loading && list.length === 0 && (
          <div className="p-8 text-center">
            <Bell size={28} className="text-[#C7C7CC] mx-auto mb-2" />
            <div className="text-[15px] text-[#8E8E93]">No notifications yet</div>
          </div>
        )}
        {list.map((n, i) => (
          <div key={n.id} className="px-4 py-3" style={{ borderTop: i > 0 ? `1px solid ${C.sep}` : undefined }}>
            <div className="text-[15px] font-semibold text-[#1D1D1F]">{n.title}</div>
            <div className="text-[14px] text-[#3C3C43] mt-0.5">{n.body}</div>
            <div className="text-[12px] text-[#8E8E93] mt-1">
              {new Date(n.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
        ))}
      </div>
      <div className="h-24" />
    </div>
  );
}

function ProfileTab({ user, onLogout, refreshUser }) {
  const [showChange, setShowChange] = useState(false);
  const [cur, setCur] = useState(''); const [np, setNp] = useState(''); const [busy, setBusy] = useState(false);
  const [hap, setHap] = useState(true);
  const [snd, setSnd] = useState(true);
  useEffect(() => { setHap(getHaptics()); setSnd(getSounds()); }, []);

  const changePw = async () => {
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: np } });
      alert('Password changed');
      setShowChange(false); setCur(''); setNp('');
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const requestReset = async () => {
    if (!confirm('Send a password reset request to your supervisor?')) return;
    await api('/auth/request-password-reset', { method: 'POST' });
    alert('Request sent to supervisor.');
  };

  return (
    <div>
      <LargeTitle title="Profile" />

      <div className="mx-4 mt-4 bg-white rounded-2xl p-5 flex items-center gap-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-[22px] font-semibold" style={{ background: C.blue }}>
          {user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
        </div>
        <div>
          <div className="text-[20px] font-semibold text-[#1D1D1F]">{user.name}</div>
          <div className="text-[14px] text-[#8E8E93]">{user.role || 'Employee'}</div>
        </div>
      </div>

      <div className="mt-6 px-5 pb-2 text-[13px] uppercase tracking-wide text-[#8E8E93] font-medium">Details</div>
      <div className="mx-4 bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        <InfoRow label="Employee ID" value={user.employeeId} first />
<InfoRow label="Role" value={user.role} />
      </div>

      <div className="mt-6 px-5 pb-2 text-[13px] uppercase tracking-wide text-[#8E8E93] font-medium">Preferences</div>
      <div className="mx-4 bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        <div className="px-4 py-3.5 flex items-center gap-3">
          <Vibrate size={18} className="text-[#8E8E93]" />
          <div className="flex-1 text-[16px] text-[#1D1D1F]">Haptic Vibration</div>
          <button onClick={() => { const n = !hap; setHap(n); setHaptics(n); if (n) fx.success(); }}
            className="w-[51px] h-[31px] rounded-full relative transition"
            style={{ background: hap ? C.green : '#E5E5EA' }}>
            <span className="absolute top-[2px] left-[2px] w-[27px] h-[27px] bg-white rounded-full transition shadow"
              style={{ transform: hap ? 'translateX(20px)' : 'translateX(0)' }} />
          </button>
        </div>
        <div className="px-4 py-3.5 flex items-center gap-3" style={{ borderTop: `1px solid ${C.sep}` }}>
          <Volume2 size={18} className="text-[#8E8E93]" />
          <div className="flex-1 text-[16px] text-[#1D1D1F]">Sound Effects</div>
          <button onClick={() => { const n = !snd; setSnd(n); setSounds(n); if (n) fx.success(); }}
            className="w-[51px] h-[31px] rounded-full relative transition"
            style={{ background: snd ? C.green : '#E5E5EA' }}>
            <span className="absolute top-[2px] left-[2px] w-[27px] h-[27px] bg-white rounded-full transition shadow"
              style={{ transform: snd ? 'translateX(20px)' : 'translateX(0)' }} />
          </button>
        </div>
        <button onClick={async () => { const p = await ensureNotifPermission(); alert('Browser notifications: ' + p); }}
          className="w-full px-4 py-3.5 flex items-center gap-3 active:bg-black/5" style={{ borderTop: `1px solid ${C.sep}` }}>
          <Bell size={18} className="text-[#007AFF]" />
          <span className="text-[16px] text-[#007AFF]">Enable Browser Notifications</span>
        </button>
      </div>

      <div className="mt-6 px-5 pb-2 text-[13px] uppercase tracking-wide text-[#8E8E93] font-medium">Security</div>
      <div className="mx-4 bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        <button onClick={() => setShowChange(true)} className="w-full px-4 py-3.5 flex items-center gap-3 active:bg-black/5">
          <KeyRound size={18} className="text-[#007AFF]" />
          <span className="text-[16px] text-[#007AFF]">Change Password</span>
        </button>
        <button onClick={requestReset} className="w-full px-4 py-3.5 flex items-center gap-3 active:bg-black/5" style={{ borderTop: `1px solid ${C.sep}` }}>
          <KeyRound size={18} className="text-[#8E8E93]" />
          <span className="text-[16px] text-[#1D1D1F]">Request Password Reset</span>
        </button>
      </div>

      <div className="mx-4 mt-6">
        <button onClick={onLogout} className="w-full bg-white rounded-2xl py-3.5 text-[17px] font-semibold text-[#FF3B30] flex items-center justify-center gap-2">
          <LogOut size={18} /> Log Out
        </button>
      </div>

      <div className="h-24" />

      {showChange && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowChange(false)}>
          <div className="w-full bg-white rounded-t-3xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center justify-between border-b" style={{ borderColor: C.sep }}>
              <button onClick={() => setShowChange(false)} className="text-[17px] text-[#007AFF]">Cancel</button>
              <div className="text-[17px] font-semibold">Change Password</div>
              <button onClick={changePw} disabled={busy} className="text-[17px] font-semibold text-[#007AFF] disabled:opacity-50">Save</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="bg-white rounded-2xl overflow-hidden border" style={{ borderColor: C.sep }}>
                <input type="password" placeholder="Current password" value={cur} onChange={e => setCur(e.target.value)}
                  className="w-full px-4 py-3 outline-none text-[16px]" />
                <input type="password" placeholder="New password" value={np} onChange={e => setNp(e.target.value)}
                  className="w-full px-4 py-3 outline-none text-[16px] border-t" style={{ borderColor: C.sep }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, first }) {
  return (
    <div className="px-4 py-3 flex items-center gap-3" style={{ borderTop: first ? undefined : `1px solid ${C.sep}` }}>
      <div className="text-[15px] text-[#8E8E93] w-28">{label}</div>
      <div className="flex-1 text-[16px] text-[#1D1D1F]">{value || '—'}</div>
    </div>
  );
}

export default function Employee({ user, onLogout, refreshUser }) {
  const [tab, setTab] = useState('home');
  return (
    <div className="min-h-screen pb-20" style={{ background: C.bg }}>
      <div className="max-w-2xl mx-auto">
        {tab === 'home' && <HomeTab user={user} />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'profile' && <ProfileTab user={user} onLogout={onLogout} refreshUser={refreshUser} />}
      </div>
      <BottomNav tab={tab} setTab={setTab} items={[
        { key: 'home', label: 'Home', icon: HomeIcon },
        { key: 'notifications', label: 'Alerts', icon: Bell },
        { key: 'profile', label: 'Profile', icon: User },
      ]} />
    </div>
  );
}
