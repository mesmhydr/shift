'use client';

import { useEffect, useMemo, useState } from 'react';
import { fx, getHaptics, setHaptics, getSounds, setSounds, ensureNotifPermission } from '@/lib/shiftops-fx';
import {
  LayoutDashboard, CalendarDays, History, Settings as SettingsIcon,
  Coffee, UtensilsCrossed, Check, X, Clock, ChevronRight, Plus, Trash2, Pencil, LogOut, KeyRound, ArrowLeft, ChevronLeft,
  Bell, Vibrate, Volume2, Eraser,
} from 'lucide-react';
import {
  approveBreak,
  clearAllHistory,
  clearHistoryForDate,
  createArea,
  createEmployee,
  deleteArea,
  deleteEmployee,
  endBreak,
  getDashboardData,
  getHistory,
  getRosterCalendar,
  getRosterForDate,
  getSettingsData,
  listAreas,
  listEmployees,
  listPasswordRequests,
  rejectBreak,
  renameArea,
  resetEmployeePassword,
  saveRoster,
  startBreak,
  updateEmployee,
  updateSettings,
} from '@/lib/shiftops/actions';

const C = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  text: '#1D1D1F',
  muted: '#8E8E93',
  sep: 'rgba(0,0,0,0.06)',
  blue: '#007AFF',
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  grey: '#C7C7CC',
};

// ------------------------ Helpers ------------------------
const fmtTime = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const fmtDateFull = (d) => new Date(d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const useNow = () => {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(i); }, []);
  return n;
};
const elapsed = (start, now) => {
  const ms = now - new Date(start).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

// ------------------------ UI Bits ------------------------
function LargeTitle({ title, right }) {
  return (
    <div className="px-5 pt-4 pb-3 flex items-end justify-between">
      <h1 className="text-[34px] font-bold tracking-tight text-[#1D1D1F]">{title}</h1>
      {right}
    </div>
  );
}

function StatCard({ label, value, color = C.blue }) {
  return (
    <div className="bg-white rounded-2xl p-4 flex-1 min-w-[110px]" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <div className="text-[13px] text-[#8E8E93] font-medium">{label}</div>
      <div className="text-[28px] font-bold mt-1" style={{ color }}>{value}</div>
    </div>
  );
}

function Section({ header, children }) {
  return (
    <div className="mt-6">
      {header && (
        <div className="px-5 pb-2 text-[13px] uppercase tracking-wide text-[#8E8E93] font-medium">{header}</div>
      )}
      <div className="mx-4 bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children, onClick, className = '' }) {
  return (
    <div
      onClick={onClick}
      className={`px-4 py-3.5 flex items-center gap-3 ${onClick ? 'active:bg-black/5 cursor-pointer' : ''} ${className}`}
      style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}
    >
      {children}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    'Working': { bg: 'rgba(52,199,89,0.12)', color: C.green },
    'On Break': { bg: 'rgba(0,122,255,0.12)', color: C.blue },
    'Pending Approval': { bg: 'rgba(255,149,0,0.12)', color: C.orange },
    'Pending Return': { bg: 'rgba(255,149,0,0.12)', color: C.orange },
  };
  const s = map[status] || { bg: 'rgba(142,142,147,0.12)', color: C.muted };
  return (
    <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

function BreakBadge({ type, info }) {
  const now = useNow();
  const icon = type === 'lunch' ? <UtensilsCrossed size={14} /> : <Coffee size={14} />;
  const label = type === 'lunch' ? 'Lunch' : 'Tea';
  const color = type === 'lunch' ? C.orange : C.green;

  if (!info || info.status === 'Not Taken') {
    return (
      <div className="flex items-center gap-1 text-[12px] text-[#8E8E93]">
        {icon}<span>{label}</span><span>·</span><span>Not taken</span>
      </div>
    );
  }
  if (info.status === 'Completed') {
    return (
      <div className="flex items-center gap-1 text-[12px] text-[#8E8E93]">
        {icon}<span>{label}</span>
        <Check size={14} className="text-[#34C759]" />
        <span>{info.durationMin} min</span>
      </div>
    );
  }
  if (info.status === 'Running') {
    return (
      <div className="flex items-center gap-1 text-[12px] font-medium" style={{ color }}>
        {icon}<span>{label}</span>
        <span className="ml-1 tabular-nums">{elapsed(info.startAt, now)}</span>
      </div>
    );
  }
  if (info.status === 'Pending') {
    return (
      <div className="flex items-center gap-1 text-[12px] font-medium" style={{ color: C.orange }}>
        {icon}<span>{label}</span><span>· Pending</span>
      </div>
    );
  }
  if (info.status === 'Pending Return') {
    return (
      <div className="flex items-center gap-1 text-[12px] font-medium" style={{ color: C.orange }}>
        {icon}<span>{label}</span><span>· Return?</span>
      </div>
    );
  }
  return null;
}

// ------------------------ Dashboard ------------------------
function DashboardTab({ areaName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const d = await getDashboardData();
      setData(d);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, []);

  const act = async (fn) => { fx.tap(); try { await fn(); fx.success(); await load(); } catch (e) { fx.error(); alert(e.message); } };

  if (loading && !data) return <div className="p-6 text-[#8E8E93]">Loading…</div>;

  const s = data?.summary || {};

  return (
    <div>
      <LargeTitle title="Today" />
      <div className="px-5 text-[15px] text-[#8E8E93] -mt-2">{fmtDateFull(new Date())} · {areaName}</div>

      <div className="px-4 mt-5 grid grid-cols-3 gap-2">
        <StatCard label="Working" value={s.working ?? 0} color={C.green} />
        <StatCard label="On Break" value={s.onBreak ?? 0} color={C.blue} />
        <StatCard label="Pending" value={s.pendingApproval ?? 0} color={C.orange} />
      </div>
      <div className="px-4 mt-2 grid grid-cols-2 gap-2">
        <StatCard label="Lunch Completed" value={s.lunchCompleted ?? 0} color={C.orange} />
        <StatCard label="Tea Completed" value={s.teaCompleted ?? 0} color={C.green} />
      </div>

      <Section header="On Shift">
        {(data?.employees || []).length === 0 && (
          <div className="p-6 text-center text-[#8E8E93] text-[14px]">No employees on today's roster. Create one in Roster.</div>
        )}
        {(data?.employees || []).map((e, idx) => (
          <div key={e.id} className="px-4 py-3.5" style={{ borderTop: idx > 0 ? '1px solid rgba(0,0,0,0.06)' : undefined }}>
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[17px] font-semibold text-[#1D1D1F]">{e.name}</span>
                  <StatusPill status={e.currentStatus} />
                </div>
                <div className="text-[13px] text-[#8E8E93] mt-0.5">{e.department} · {e.employeeRole}</div>
                <div className="flex items-center gap-4 mt-2">
                  <BreakBadge type="lunch" info={e.lunch} />
                  <BreakBadge type="tea" info={e.tea} />
                </div>
              </div>
            </div>
            <EmployeeActions e={e} act={act} />
          </div>
        ))}
      </Section>

      <div className="h-24" />
    </div>
  );
}

function EmployeeActions({ e, act }) {
  const s = e.activeSession;
  if (s?.status === 'pending') {
    return (
      <div className="mt-3 flex gap-2">
        <button onClick={() => act(() => approveBreak(s.id))}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold text-white" style={{ background: C.green }}>
          Approve {s.type === 'lunch' ? 'Lunch' : 'Tea'}
        </button>
        <button onClick={() => act(() => rejectBreak(s.id))}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold" style={{ background: '#F2F2F7', color: C.red }}>
          Reject
        </button>
      </div>
    );
  }
  if (s?.status === 'pending_return') {
    return (
      <div className="mt-3 flex gap-2">
        <button onClick={() => act(() => approveBreak(s.id))}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold text-white" style={{ background: C.green }}>
          Approve Return
        </button>
        <button onClick={() => act(() => endBreak(s.id))}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold" style={{ background: '#F2F2F7', color: C.text }}>
          Force End
        </button>
      </div>
    );
  }
  if (s?.status === 'active') {
    return (
      <div className="mt-3">
        <button onClick={() => act(() => endBreak(s.id))}
          className="w-full rounded-xl py-2 text-[15px] font-semibold" style={{ background: '#F2F2F7', color: C.text }}>
          End Break
        </button>
      </div>
    );
  }
  // No active session — show start buttons for whichever breaks are available
  const showLunch = e.lunch.status === 'Not Taken';
  const showTea = e.tea.status === 'Not Taken';
  if (!showLunch && !showTea) return null;
  return (
    <div className="mt-3 flex gap-2">
      {showLunch && (
        <button onClick={() => { if (confirm(`Start Lunch for ${e.name}?`)) act(() => startBreak(e.id, 'lunch')); }}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold" style={{ background: 'rgba(255,149,0,0.12)', color: C.orange }}>
          Start Lunch
        </button>
      )}
      {showTea && (
        <button onClick={() => { if (confirm(`Start Tea for ${e.name}?`)) act(() => startBreak(e.id, 'tea')); }}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold" style={{ background: 'rgba(52,199,89,0.12)', color: C.green }}>
          Start Tea
        </button>
      )}
    </div>
  );
}

// ------------------------ Roster ------------------------
function RosterTab({ areaId }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [calendar, setCalendar] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);

  const monthStr = `${month.y}-${String(month.m + 1).padStart(2, '0')}`;

  const loadCal = async () => {
    if (!areaId) return;
    try {
      const { dates } = await getRosterCalendar(areaId, monthStr);
      const map = {};
      dates.forEach(d => map[d.date] = d.count);
      setCalendar(map);
    } catch {}
  };

  useEffect(() => { loadCal(); }, [areaId, monthStr]);

  // Build calendar grid
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const firstDay = new Date(month.y, month.m, 1).getDay(); // 0=Sun
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const today = new Date();
  const isToday = (d) => d === today.getDate() && month.m === today.getMonth() && month.y === today.getFullYear();
  const isPast = (d) => {
    const dt = new Date(month.y, month.m, d);
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return dt < t;
  };
  const dateKey = (d) => `${month.y}-${String(month.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const shiftMonth = (delta) => {
    let y = month.y, m = month.m + delta;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setMonth({ y, m });
  };

  return (
    <div>
      <LargeTitle title="Roster" />
      <div className="px-5 -mt-2 flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="p-2 -ml-2"><ChevronLeft size={22} /></button>
        <div className="text-[17px] font-semibold text-[#1D1D1F]">
          {new Date(month.y, month.m).toLocaleDateString([], { month: 'long', year: 'numeric' })}
        </div>
        <button onClick={() => shiftMonth(1)} className="p-2 -mr-2 rotate-180"><ChevronLeft size={22} /></button>
      </div>

      <div className="mx-4 mt-4 bg-white rounded-2xl p-3" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        <div className="grid grid-cols-7 text-center text-[12px] text-[#8E8E93] font-medium mb-2">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const key = dateKey(d);
            const hasRoster = calendar[key] > 0;
            const past = isPast(d);
            const today_ = isToday(d);
            let bg = '#F2F2F7', color = C.text;
            if (past) { bg = '#F2F2F7'; color = C.grey; }
            else if (hasRoster) { bg = 'rgba(52,199,89,0.15)'; color = C.green; }
            else { bg = 'rgba(255,149,0,0.15)'; color = C.orange; }
            return (
              <button key={i} onClick={() => setSelectedDate(key)}
                className="aspect-square rounded-xl flex flex-col items-center justify-center relative active:scale-95 transition"
                style={{ background: bg, color, outline: today_ ? `2px solid ${C.blue}` : 'none', outlineOffset: -2 }}>
                <div className="text-[15px] font-semibold">{d}</div>
                {hasRoster && <div className="text-[10px] mt-0.5">{calendar[key]}</div>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-4 mt-4 p-4 bg-white rounded-2xl text-[13px] text-[#8E8E93] leading-relaxed">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'rgba(52,199,89,0.4)' }} /> Roster set</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'rgba(255,149,0,0.4)' }} /> No roster</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#E5E5EA' }} /> Past</span>
        </div>
      </div>

      {selectedDate && (
        <RosterSheet
          date={selectedDate}
          areaId={areaId}
          onClose={() => { setSelectedDate(null); loadCal(); }}
        />
      )}

      <div className="h-24" />
    </div>
  );
}

function RosterSheet({ date, areaId, onClose }) {
  const [allEmps, setAllEmps] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [emp, ros] = await Promise.all([
        listEmployees(),
        getRosterForDate(areaId, date),
      ]);
      setAllEmps(emp.employees);
      setSelected(new Set((ros.roster?.employees || []).map(e => e.id)));
      setLoading(false);
    })();
  }, [date, areaId]);

  const toggle = (id) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  const save = async () => {
    if (loading) return; // guard: don't save empty over unloaded roster
    setSaving(true);
    try {
      await saveRoster(areaId, date, Array.from(selected));
      onClose();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 flex items-center justify-between border-b" style={{ borderColor: C.sep }}>
          <button onClick={onClose} className="text-[17px] text-[#007AFF]">Cancel</button>
          <div className="text-[17px] font-semibold text-[#1D1D1F]">{fmtDateFull(date)}</div>
          <button onClick={save} disabled={saving || loading} className="text-[17px] font-semibold text-[#007AFF] disabled:opacity-50">
            {saving ? 'Saving…' : (loading ? 'Loading…' : 'Save')}
          </button>
        </div>
        <div className="px-5 pt-3 pb-1 text-[13px] uppercase tracking-wide text-[#8E8E93] font-medium">
          {selected.size} selected
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? <div className="p-6 text-center text-[#8E8E93]">Loading…</div> :
            allEmps.map((e, i) => (
              <div key={e.id} onClick={() => toggle(e.id)}
                className="px-5 py-3.5 flex items-center gap-3 active:bg-black/5 cursor-pointer"
                style={{ borderTop: i > 0 ? `1px solid ${C.sep}` : undefined }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: selected.has(e.id) ? C.blue : '#E5E5EA' }}>
                  {selected.has(e.id) && <Check size={16} color="white" />}
                </div>
                <div className="flex-1">
                  <div className="text-[16px] text-[#1D1D1F]">{e.name}</div>
                  <div className="text-[13px] text-[#8E8E93]">{e.department} · {e.employeeRole}</div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------ History ------------------------
function HistoryTab({ areaId }) {
  const [date, setDate] = useState(todayStr());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { records } = await getHistory(areaId, date);
        setRecords(records);
      } finally { setLoading(false); }
    })();
  }, [areaId, date]);

  return (
    <div>
      <LargeTitle title="History" />
      <div className="mx-4 mt-2 bg-white rounded-2xl p-3 flex items-center gap-3" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        <CalendarDays size={20} className="text-[#007AFF]" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="flex-1 bg-transparent text-[16px] outline-none text-[#1D1D1F]" />
      </div>
      <Section header={`${records.length} completed breaks`}>
        {loading && <div className="p-6 text-center text-[#8E8E93]">Loading…</div>}
        {!loading && records.length === 0 && (
          <div className="p-6 text-center text-[#8E8E93] text-[14px]">No completed breaks on this date.</div>
        )}
        {records.map((r, i) => (
          <div key={r.id} className="px-4 py-3.5" style={{ borderTop: i > 0 ? `1px solid ${C.sep}` : undefined }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[16px] font-medium text-[#1D1D1F]">{r.employeeName}</div>
                <div className="text-[13px] text-[#8E8E93]">{r.department}</div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1.5 justify-end">
                  {r.type === 'lunch' ? <UtensilsCrossed size={14} color={C.orange} /> : <Coffee size={14} color={C.green} />}
                  <span className="text-[15px] font-semibold" style={{ color: r.type === 'lunch' ? C.orange : C.green }}>
                    {r.type === 'lunch' ? 'Lunch' : 'Tea'}
                  </span>
                </div>
                <div className="text-[13px] text-[#8E8E93] mt-0.5">
                  {fmtTime(r.startAt)} – {fmtTime(r.endAt)} · <span className={r.exceeded ? 'text-[#FF3B30]' : ''}>{r.durationMin} min</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </Section>
      <div className="h-24" />
    </div>
  );
}

// ------------------------ Settings ------------------------
function SettingsTab({ user, onLogout, refreshArea }) {
  const [settings, setSettings] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [areas, setAreas] = useState([]);
  const [passReqs, setPassReqs] = useState([]);
  const [editingEmp, setEditingEmp] = useState(null);
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showAreas, setShowAreas] = useState(false);
  const [hap, setHap] = useState(true);
  const [snd, setSnd] = useState(true);

  useEffect(() => { setHap(getHaptics()); setSnd(getSounds()); }, []);

  const loadAll = async () => {
    const [s, e, a, pr] = await Promise.all([
      getSettingsData(),
      listEmployees(),
      listAreas(),
      listPasswordRequests(),
    ]);
    setSettings(s.settings); setEmployees(e.employees); setAreas(a.areas); setPassReqs(pr.requests);
  };
  useEffect(() => { loadAll(); }, []);

  const toggle = async (key) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    await updateSettings({ [key]: next[key] });
  };

  const switchArea = async (id) => {
    setSettings({ ...settings, currentAreaId: id });
    await updateSettings({ currentAreaId: id });
    refreshArea();
  };

  if (!settings) return <div className="p-6 text-[#8E8E93]">Loading…</div>;

  return (
    <div>
      <LargeTitle title="Settings" />

      <Section header="Operations">
        <ToggleRow label="Require Break Start Approval" value={settings.requireBreakStartApproval} onChange={() => toggle('requireBreakStartApproval')} />
        <ToggleRow label="Require Break Return Approval" value={settings.requireBreakReturnApproval} onChange={() => toggle('requireBreakReturnApproval')} />
        <ToggleRow label="Enable Break Time Monitoring" value={settings.enableBreakTimeMonitoring} onChange={() => toggle('enableBreakTimeMonitoring')} />
      </Section>

      <Section header="Employees">
        {employees.map((e, i) => (
          <Row key={e.id} onClick={() => setEditingEmp(e)} className={i === 0 ? '!border-t-0' : ''}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-semibold" style={{ background: C.blue }}>
              {e.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[16px] text-[#1D1D1F] truncate">{e.name}</div>
              <div className="text-[13px] text-[#8E8E93] truncate">{e.email}</div>
            </div>
            <ChevronRight size={18} className="text-[#C7C7CC]" />
          </Row>
        ))}
        <Row onClick={() => setShowAddEmp(true)}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,122,255,0.12)' }}>
            <Plus size={18} color={C.blue} />
          </div>
          <div className="flex-1 text-[16px] text-[#007AFF]">Add Employee</div>
        </Row>
      </Section>

      {passReqs.length > 0 && (
        <Section header={`Password Requests (${passReqs.length})`}>
          {passReqs.map((r, i) => (
            <div key={r.id} className="px-4 py-3.5" style={{ borderTop: i > 0 ? `1px solid ${C.sep}` : undefined }}>
              <div className="text-[16px] text-[#1D1D1F]">{r.employeeName}</div>
              <div className="text-[13px] text-[#8E8E93] mb-2">{r.employeeEmail}</div>
              <button onClick={async () => {
                const np = prompt(`Set new password for ${r.employeeName}:`);
                if (!np) return;
                try {
                  await resetEmployeePassword(r.employeeId, np, r.id);
                  await loadAll();
                } catch (e) { alert(e.message); }
              }} className="text-[15px] font-semibold text-[#007AFF]">Reset Password</button>
            </div>
          ))}
        </Section>
      )}

      <Section header="Areas">
        {areas.map((a, i) => (
          <Row key={a.id} onClick={() => switchArea(a.id)} className={i === 0 ? '!border-t-0' : ''}>
            <div className="flex-1 text-[16px] text-[#1D1D1F]">{a.name}</div>
            {settings.currentAreaId === a.id && <Check size={18} color={C.blue} />}
          </Row>
        ))}
        <Row onClick={() => setShowAreas(true)}>
          <SettingsIcon size={18} className="text-[#8E8E93]" />
          <div className="flex-1 text-[16px] text-[#007AFF]">Manage Areas</div>
          <ChevronRight size={18} className="text-[#C7C7CC]" />
        </Row>
      </Section>

      <Section header="Feedback">
        <ToggleRow label="Haptic Vibration" value={hap} onChange={() => { const n = !hap; setHap(n); setHaptics(n); if (n) fx.success(); }} />
        <ToggleRow label="Sound Effects" value={snd} onChange={() => { const n = !snd; setSnd(n); setSounds(n); if (n) fx.success(); }} />
        <Row onClick={async () => { const p = await ensureNotifPermission(); alert('Browser notifications: ' + p); }}>
          <Bell size={18} className="text-[#007AFF]" />
          <div className="flex-1 text-[16px] text-[#007AFF]">Enable Browser Notifications</div>
        </Row>
      </Section>

      <Section header="Notifications">
        <ToggleRow label="Push Notifications" value={settings.pushNotifications ?? true} onChange={() => toggle('pushNotifications')} />
        <ToggleRow label="Break Reminders" value={settings.breakReminder ?? true} onChange={() => toggle('breakReminder')} />
        <ToggleRow label="Approval Notifications" value={settings.approvalNotifications ?? true} onChange={() => toggle('approvalNotifications')} />
        <ToggleRow label="Password Requests" value={settings.passwordRequests ?? true} onChange={() => toggle('passwordRequests')} />
      </Section>

      <Section header="History">
        <Row onClick={async () => {
          if (!confirm("Clear today's history? Completed breaks will be permanently deleted.")) return;
          try {
            const t = new Date();
            const d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
            const r = await clearHistoryForDate(d);
            fx.success();
            alert(`Deleted ${r.deleted} records`);
          } catch (e) { fx.error(); alert(e.message); }
        }}>
          <Eraser size={18} className="text-[#FF3B30]" />
          <div className="flex-1 text-[16px] text-[#FF3B30]">Clear Today's History</div>
        </Row>
        <Row onClick={async () => {
          if (!confirm('Clear ALL history for this area? This cannot be undone.')) return;
          try {
            const r = await clearAllHistory();
            fx.success();
            alert(`Deleted ${r.deleted} records`);
          } catch (e) { fx.error(); alert(e.message); }
        }}>
          <Trash2 size={18} className="text-[#FF3B30]" />
          <div className="flex-1 text-[16px] text-[#FF3B30]">Clear All History (Area)</div>
        </Row>
      </Section>

      <Section header="Organization">
        <EditRow label="Organization" value={settings.organizationName} onSave={async (v) => { await updateSettings({ organizationName: v }); loadAll(); }} />
        <EditRow label="Supervisor" value={settings.supervisorName} onSave={async (v) => { await updateSettings({ supervisorName: v }); loadAll(); }} />
      </Section>

      <Section header="About">
        <Row><span className="flex-1 text-[16px]">Version</span><span className="text-[#8E8E93]">1.0.0</span></Row>
        <Row><span className="flex-1 text-[16px]">Privacy Policy</span><ChevronRight size={18} className="text-[#C7C7CC]" /></Row>
        <Row><span className="flex-1 text-[16px]">Support</span><ChevronRight size={18} className="text-[#C7C7CC]" /></Row>
      </Section>

      <div className="mx-4 mt-6">
        <button onClick={onLogout} className="w-full bg-white rounded-2xl py-3.5 text-[17px] font-semibold text-[#FF3B30] flex items-center justify-center gap-2">
          <LogOut size={18} /> Log Out
        </button>
      </div>

      <div className="h-24" />

      {editingEmp && <EmployeeEdit emp={editingEmp} onClose={() => { setEditingEmp(null); loadAll(); }} />}
      {showAddEmp && <EmployeeEdit onClose={() => { setShowAddEmp(false); loadAll(); }} />}
      {showAreas && <AreasSheet areas={areas} currentId={settings.currentAreaId} onClose={() => { setShowAreas(false); loadAll(); refreshArea(); }} />}
    </div>
  );
}

function ToggleRow({ label, value, onChange }) {
  return (
    <Row>
      <div className="flex-1 text-[16px] text-[#1D1D1F]">{label}</div>
      <button onClick={onChange}
        className="w-[51px] h-[31px] rounded-full relative transition"
        style={{ background: value ? C.green : '#E5E5EA' }}>
        <span className="absolute top-[2px] left-[2px] w-[27px] h-[27px] bg-white rounded-full transition shadow"
          style={{ transform: value ? 'translateX(20px)' : 'translateX(0)' }} />
      </button>
    </Row>
  );
}

function EditRow({ label, value, onSave }) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setV(value), [value]);
  return (
    <Row>
      <div className="flex-1 text-[16px] text-[#1D1D1F]">{label}</div>
      {editing ? (
        <>
          <input value={v} onChange={(e) => setV(e.target.value)}
            className="text-[16px] text-right outline-none bg-transparent text-[#8E8E93] w-40" />
          <button onClick={async () => { await onSave(v); setEditing(false); }} className="text-[15px] font-semibold text-[#007AFF]">Save</button>
        </>
      ) : (
        <button onClick={() => setEditing(true)} className="text-[16px] text-[#8E8E93]">{value || 'Set'}</button>
      )}
    </Row>
  );
}

function EmployeeEdit({ emp, onClose }) {
  const isNew = !emp;
  const [f, setF] = useState({
    name: emp?.name || '', email: emp?.email || '', phone: emp?.phone || '',
    department: emp?.department || '', employeeRole: emp?.employeeRole || '',
    password: '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        if (!f.password) { alert('Password required'); setBusy(false); return; }
        await createEmployee(f);
      } else {
        await updateEmployee(emp.id, f);
      }
      onClose();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete ${emp.name}? This cannot be undone.`)) return;
    await deleteEmployee(emp.id);
    onClose();
  };

  const resetPw = async () => {
    const np = prompt('New password:');
    if (!np) return;
    await resetEmployeePassword(emp.id, np);
    alert('Password reset.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 flex items-center justify-between border-b" style={{ borderColor: C.sep }}>
          <button onClick={onClose} className="text-[17px] text-[#007AFF]">Cancel</button>
          <div className="text-[17px] font-semibold">{isNew ? 'New Employee' : 'Edit Employee'}</div>
          <button onClick={save} disabled={busy} className="text-[17px] font-semibold text-[#007AFF] disabled:opacity-50">Save</button>
        </div>
        <div className="p-4 space-y-3">
          <FieldGroup>
            <Field label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
            <Field label="Email" value={f.email} onChange={(v) => setF({ ...f, email: v })} type="email" />
            {isNew && <Field label="Password" value={f.password} onChange={(v) => setF({ ...f, password: v })} type="password" />}
          </FieldGroup>
          <FieldGroup>
            <Field label="Phone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
            <Field label="Department" value={f.department} onChange={(v) => setF({ ...f, department: v })} />
            <Field label="Role" value={f.employeeRole} onChange={(v) => setF({ ...f, employeeRole: v })} />
          </FieldGroup>
          {!isNew && (
            <>
              <button onClick={resetPw} className="w-full bg-white border rounded-2xl py-3 text-[16px] font-medium text-[#007AFF] flex items-center justify-center gap-2" style={{ borderColor: C.sep }}>
                <KeyRound size={16} /> Reset Password
              </button>
              <button onClick={remove} className="w-full bg-white rounded-2xl py-3 text-[16px] font-medium text-[#FF3B30] flex items-center justify-center gap-2">
                <Trash2 size={16} /> Delete Employee
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ children }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div className="px-4 py-3 flex items-center gap-3" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="text-[15px] text-[#8E8E93] w-24">{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent outline-none text-[16px] text-[#1D1D1F]" />
    </div>
  );
}

function AreasSheet({ areas, currentId, onClose }) {
  const [list, setList] = useState(areas);
  const [newName, setNewName] = useState('');

  const add = async () => {
    if (!newName.trim()) return;
    const r = await createArea(newName.trim());
    setList([...list, r.area]);
    setNewName('');
  };
  const rename = async (a) => {
    const n = prompt('Rename area', a.name);
    if (!n) return;
    await renameArea(a.id, n);
    setList(list.map(x => x.id === a.id ? { ...x, name: n } : x));
  };
  const del = async (a) => {
    if (!confirm(`Delete area "${a.name}"?`)) return;
    try {
      await deleteArea(a.id);
      setList(list.filter(x => x.id !== a.id));
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 flex items-center justify-between border-b" style={{ borderColor: C.sep }}>
          <button onClick={onClose} className="text-[17px] text-[#007AFF]">Done</button>
          <div className="text-[17px] font-semibold">Manage Areas</div>
          <div className="w-16" />
        </div>
        <div className="p-4">
          <FieldGroup>
            {list.map((a, i) => (
              <div key={a.id} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: i > 0 ? `1px solid ${C.sep}` : undefined }}>
                <div className="flex-1 text-[16px] text-[#1D1D1F]">{a.name} {currentId === a.id && <span className="text-[13px] text-[#8E8E93]">(current)</span>}</div>
                <button onClick={() => rename(a)} className="text-[#007AFF] p-1"><Pencil size={16} /></button>
                <button onClick={() => del(a)} className="text-[#FF3B30] p-1"><Trash2 size={16} /></button>
              </div>
            ))}
          </FieldGroup>
          <div className="mt-3 flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New area name"
              className="flex-1 bg-white rounded-xl px-4 py-3 text-[16px] outline-none" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }} />
            <button onClick={add} className="rounded-xl px-4 py-3 text-white font-semibold text-[16px]" style={{ background: C.blue }}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------ Supervisor Shell ------------------------
export default function Supervisor({ user, onLogout }) {
  const [tab, setTab] = useState('dashboard');
  const [areaName, setAreaName] = useState('');
  const [areaId, setAreaId] = useState('');
  const [tick, setTick] = useState(0);

  const loadArea = async () => {
    const [{ settings, areas }] = await Promise.all([getSettingsData(), listAreas()]);
    setAreaId(settings.currentAreaId);
    const a = areas.find(x => x.id === settings.currentAreaId);
    setAreaName(a?.name || '');
  };
  useEffect(() => { loadArea(); }, [tick]);

  return (
    <div className="min-h-screen pb-20" style={{ background: C.bg }}>
      <div className="max-w-2xl mx-auto">
        {tab === 'dashboard' && <DashboardTab areaName={areaName} />}
        {tab === 'roster' && <RosterTab areaId={areaId} />}
        {tab === 'history' && <HistoryTab areaId={areaId} />}
        {tab === 'settings' && <SettingsTab user={user} onLogout={onLogout} refreshArea={() => setTick(t => t + 1)} />}
      </div>
      <BottomNav tab={tab} setTab={setTab} items={[
        { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { key: 'roster', label: 'Roster', icon: CalendarDays },
        { key: 'history', label: 'History', icon: History },
        { key: 'settings', label: 'Settings', icon: SettingsIcon },
      ]} />
    </div>
  );
}

export function BottomNav({ tab, setTab, items }) {
  return (
    <div className="fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur-xl border-t" style={{ borderColor: C.sep, paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="max-w-2xl mx-auto flex">
        {items.map(it => {
          const Icon = it.icon;
          const active = tab === it.key;
          return (
            <button key={it.key} onClick={() => { fx.tap(); setTab(it.key); }}
              className="flex-1 py-2 flex flex-col items-center gap-0.5 active:opacity-60 transition">
              <Icon size={24} color={active ? C.blue : C.muted} strokeWidth={active ? 2.4 : 2} />
              <span className="text-[10px] font-medium" style={{ color: active ? C.blue : C.muted }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
