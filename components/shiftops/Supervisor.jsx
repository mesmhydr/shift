'use client';
import Image from "next/image";
import ExcelJS from "exceljs";
import { todayStr, londonNow } from "@/lib/date";
import { saveAs } from "file-saver";
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/shiftops-client';
import { fx, getHaptics, setHaptics, getSounds, setSounds, ensureNotifPermission } from '@/lib/shiftops-fx';
import {
  LayoutDashboard, CalendarDays, History, Settings as SettingsIcon,
  Coffee, UtensilsCrossed, Check, X, Clock, ChevronRight, Plus, Trash2, Pencil, LogOut, ArrowLeft, ChevronLeft,
  Bell, Vibrate, Volume2, Eraser,
} from 'lucide-react';

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
const useNow = (offset = 0) => {
  const [n, setN] = useState(Date.now() - offset);
  useEffect(() => {
    setN(Date.now() - offset);
    const i = setInterval(() => setN(Date.now() - offset), 1000);
    return () => clearInterval(i);
  }, [offset]);
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

function BreakBadge({ type, info, now }) {
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
        {icon}
        <span>{label}</span>
        <Check size={14} className="text-[#34C759]" />
        <span>
          {info.durationSec != null
            ? `${Math.floor(info.durationSec / 60)}m ${info.durationSec % 60}s`
            : `${info.durationMin} min`}
        </span>
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
  const [offset, setOffset] = useState(0);

  const now = useNow(offset);

  const load = async () => {
    try {
      const d = await api('/dashboard');
      if (d.serverTime) setOffset(Date.now() - new Date(d.serverTime).getTime());
      setData(d);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, []);

  const act = async (fn) => { fx.tap(); try { await fn(); fx.success(); await load(); } catch (e) { fx.error(); alert(e.message); } };

  if (loading && !data) {
    return (
      <div className="flex h-[calc(100vh-80px)] flex-col items-center justify-center bg-[#F5F5F7]">
        {/* Logo */}
        <div
          className="mb-5 flex h-20 w-20 animate-pulse items-center justify-center rounded-3xl bg-white shadow-sm"
        >
          <Image
            src="/icon.svg"
            alt="ShiftOps"
            width={48}
            height={48}
            priority
          />
        </div>

        {/* App Name */}
        <h1 className="text-[30px] font-bold tracking-tight text-[#1D1D1F]">
          ShiftOps
        </h1>

        {/* Subtitle */}
        <p className="mt-2 text-[15px] text-[#8E8E93]">
          Preparing things for you...
        </p>

        {/* Animated dots */}
        <div className="mt-8 flex gap-2">
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-[#007AFF]"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-[#007AFF]"
            style={{ animationDelay: "15ms" }}
          />
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-[#007AFF]"
            style={{ animationDelay: "30ms" }}
          />
        </div>
      </div>
    );
  }
  const s = data?.summary || {};

  return (
    <div>
      <LargeTitle title="Today" />
      <div className="px-5 text-[15px] text-[#8E8E93] -mt-2">
        {fmtDateFull(londonNow())} ·{" "}
        {londonNow().toLocaleTimeString("en-GB", {
          timeZone: "Europe/London",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false, // change to true if you want 9:42 PM instead of 21:42
        })}{" "}
        · {areaName}
      </div>
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
                <div className="text-[13px] text-[#8E8E93] mt-0.5">{e.username} · {e.role}</div>
                <div className="flex items-center gap-4 mt-2">
                  <BreakBadge type="lunch" info={e.lunch} now={now} />
                  <BreakBadge type="tea" info={e.tea} now={now} />
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
        <button onClick={() => act(() => api(`/breaks/${s.id}/approve`, { method: 'POST' }))}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold text-white" style={{ background: C.green }}>
          Approve {s.type === 'lunch' ? 'Lunch' : 'Tea'}
        </button>
        <button onClick={() => act(() => api(`/breaks/${s.id}/reject`, { method: 'POST' }))}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold" style={{ background: '#F2F2F7', color: C.red }}>
          Reject
        </button>
      </div>
    );
  }
  if (s?.status === 'pending_return') {
    return (
      <div className="mt-3 flex gap-2">
        <button onClick={() => act(() => api(`/breaks/${s.id}/approve`, { method: 'POST' }))}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold text-white" style={{ background: C.green }}>
          Approve Return
        </button>
        <button onClick={() => act(() => api(`/breaks/${s.id}/end`, { method: 'POST' }))}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold" style={{ background: '#F2F2F7', color: C.text }}>
          Force End
        </button>
      </div>
    );
  }
  if (s?.status === 'active') {
    return (
      <div className="mt-3">
        <button onClick={() => act(() => api(`/breaks/${s.id}/end`, { method: 'POST' }))}
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
        <button onClick={() => { if (confirm(`Start Lunch for ${e.name}?`)) act(() => api('/breaks/start', { method: 'POST', body: { employeeId: e.id, type: 'lunch' } })); }}
          className="flex-1 rounded-xl py-2 text-[15px] font-semibold" style={{ background: 'rgba(255,149,0,0.12)', color: C.orange }}>
          Start Lunch
        </button>
      )}
      {showTea && (
        <button onClick={() => { if (confirm(`Start Tea for ${e.name}?`)) act(() => api('/breaks/start', { method: 'POST', body: { employeeId: e.id, type: 'tea' } })); }}
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
      const { dates } = await api(`/rosters/calendar?areaId=${areaId}&month=${monthStr}`);
      const map = {};
      dates.forEach(d => map[d.date] = d.count);
      setCalendar(map);
    } catch { }
  };

  useEffect(() => { loadCal(); }, [areaId, monthStr]);

  // Build calendar grid
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const firstDay = new Date(month.y, month.m, 1).getDay(); // 0=Sun
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const today = londonNow();

  const dateKey = (d) => `${month.y}-${String(month.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayKey = todayStr();

  const isToday = (d) => dateKey(d) === todayKey;

  const isPast = (d) => dateKey(d) < todayKey;
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
        api('/employees'),
        api(`/rosters?areaId=${areaId}&date=${date}`),
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
      await api('/rosters', { method: 'POST', body: { areaId, date, employeeIds: Array.from(selected) } });
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
                  <div className="text-[13px] text-[#8E8E93]">{e.username} · {e.role}</div>
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

  const groupedRecords = useMemo(() => {
    const groups = {};



    records.forEach((r) => {
      const key = r.employeeName; // later change to employeeId if you add it

      if (!groups[key]) {
        groups[key] = {
          employeeName: r.employeeName,
          username: r.username,
          lunch: null,
          tea: null,
        };
      }

      if (r.type === "lunch") groups[key].lunch = r;
      if (r.type === "tea") groups[key].tea = r;
    });

    return Object.values(groups);
  }, [records]);

  const exportHistory = async () => {
    const workbook = new ExcelJS.Workbook();

    workbook.creator = "ShiftOps";
    workbook.company = "ShiftOps";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Daily Report");

    const lunchCompleted = groupedRecords.filter(r => r.lunch).length;

    const teaCompleted = groupedRecords.filter(r => r.tea).length;

    const lunchExceeded = groupedRecords.filter(
      r => r.lunch?.exceeded
    ).length;

    const teaExceeded = groupedRecords.filter(
      r => r.tea?.exceeded
    ).length;
    // We'll build the report here.
    // ===== Report Title =====
    sheet.mergeCells("A1:H1");
    sheet.getCell("A1").value = "SHIFTOPS";
    sheet.getCell("A1").font = {
      size: 24,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    sheet.getCell("A1").alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    sheet.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF007AFF" },
    };

    sheet.mergeCells("A2:H2");
    sheet.getCell("A2").value = "Daily Break Report";
    sheet.getCell("A2").font = {
      size: 14,
      italic: true,
    };
    sheet.getCell("A2").alignment = {
      horizontal: "center",
    };

    sheet.addRow([]);

    const infoTitle = sheet.addRow(["Report Information"]);

    infoTitle.getCell(1).font = {
      bold: true,
      size: 14,
    };

    infoTitle.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3F4F6" },
    };

    sheet.addRow([
      "Date",
      new Date(date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    ]);

    sheet.addRow([
      "Generated",
      new Date().toLocaleString("en-IN"),
    ]);

    sheet.addRow([
      "Employees",
      groupedRecords.length,
    ]);

    sheet.addRow([]);

    const summaryTitle = sheet.addRow(["Summary"]);

    summaryTitle.getCell(1).font = {
      bold: true,
      size: 14,
    };

    sheet.addRow([]);

    const labelRow = sheet.addRow([
      "Employees",
      "Lunch",
      "Tea",
      "Exceeded",
    ]);

    const valueRow = sheet.addRow([
      groupedRecords.length,
      lunchCompleted,
      teaCompleted,
      lunchExceeded + teaExceeded,
    ]);

    [labelRow, valueRow].forEach((row, idx) => {
      row.height = idx === 0 ? 22 : 34;

      row.eachCell((cell) => {
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
        };

        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };

        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: idx === 0 ? "FFF3F4F6" : "FFFFFFFF",
          },
        };
      });
    });

    valueRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        size: 20,
      };
    });

    sheet.addRow([]);
    const headerRow = sheet.addRow([
      "Employee",
      "Username",
      "Tea Duration",
      "Lunch Duration",
      "Lunch Start",
      "Lunch End",
      "Tea Start",
      "Tea End",
    ]);

    headerRow.height = 24;

    headerRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };

      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF007AFF" },
      };

      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
      };

      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
    groupedRecords.forEach((r, index) => {
      const row = sheet.addRow([
        r.employeeName,
        r.username,
        r.tea
          ? (r.tea.durationSec != null
            ? `${Math.floor(r.tea.durationSec / 60)}m ${r.tea.durationSec % 60}s`
            : `${r.tea.durationMin} min`)
          : "-",
        r.lunch
          ? (r.lunch.durationSec != null
            ? `${Math.floor(r.lunch.durationSec / 60)}m ${r.lunch.durationSec % 60}s`
            : `${r.lunch.durationMin} min`)
          : "-",

        r.lunch ? fmtTime(r.lunch.startAt) : "-",
        r.lunch ? fmtTime(r.lunch.endAt) : "-",

        r.tea ? fmtTime(r.tea.startAt) : "-",
        r.tea ? fmtTime(r.tea.endAt) : "-",
      ]);

      // Alternate row colors
      if (index % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8F9FA" },
          };
        });
      }

      // Borders + alignment
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };

        cell.alignment = {
          vertical: "middle",
          horizontal: cell.col <= 2 ? "left" : "center",
        };
      });
    });

    sheet.columns = [
      { width: 24 },
      { width: 20 },
      { width: 18 },
      { width: 18 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
    ];

    sheet.views = [
      {
        showGridLines: false,
        state: "frozen",
        ySplit: headerRow.number,
      },
    ];

    sheet.autoFilter = {
      from: {
        row: headerRow.number,
        column: 1,
      },
      to: {
        row: headerRow.number,
        column: 8,
      },
    };


    const buffer = await workbook.xlsx.writeBuffer();

    saveAs(
      new Blob([buffer]),
      `ShiftOps-Daily-Report-${date}.xlsx`
    );
  };
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { records } = await api(`/history?areaId=${areaId}&date=${date}`);
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
        <button
          onClick={exportHistory}
          className="px-3 py-2 rounded-xl bg-[#007AFF] text-white text-[14px] font-medium"
        >
          Export
        </button>
      </div>
      <Section header={`${groupedRecords.length} employees`}>
        {loading && <div className="p-6 text-center text-[#8E8E93]">Loading…</div>}
        {!loading && records.length === 0 && (
          <div className="p-6 text-center text-[#8E8E93] text-[14px]">No completed breaks on this date.</div>
        )}
        {groupedRecords.map((r, i) => (
          <div
            key={r.employeeName}
            className="px-4 py-3.5"
            style={{ borderTop: i > 0 ? `1px solid ${C.sep}` : undefined }}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[16px] font-medium text-[#1D1D1F]">{r.employeeName}</div>
                <div className="text-[13px] text-[#8E8E93]">{r.username}</div>
              </div>
              <div className="mt-3 space-y-3">

                {r.lunch && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UtensilsCrossed size={14} color={C.orange} />
                      <span className="text-[15px] font-medium">Lunch</span>
                    </div>
                    <div className="text-[13px] text-[#8E8E93] flex items-center gap-2">
                      <span>{fmtTime(r.lunch.startAt)} – {fmtTime(r.lunch.endAt)}</span>
                      <span>•</span>
                      <span className={r.lunch.exceeded ? "text-[#FF3B30]" : ""}>
                        {r.lunch.durationSec != null
                          ? `${Math.floor(r.lunch.durationSec / 60)}m ${r.lunch.durationSec % 60}s`
                          : `${r.lunch.durationMin} min`}
                      </span>
                    </div>
                  </div>
                )}

                {r.tea && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coffee size={14} color={C.green} />
                      <span className="text-[15px] font-medium">Tea</span>
                    </div>
                    <div className="text-[13px] text-[#8E8E93] flex items-center gap-2">
                      <span>{fmtTime(r.tea.startAt)} – {fmtTime(r.tea.endAt)}</span>
                      <span>•</span>
                      <span className={r.tea.exceeded ? "text-[#FF3B30]" : ""}>
                        {r.tea.durationSec != null
                          ? `${Math.floor(r.tea.durationSec / 60)}m ${r.tea.durationSec % 60}s`
                          : `${r.tea.durationMin} min`}
                      </span>
                    </div>
                  </div>
                )}

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
  const [editingEmp, setEditingEmp] = useState(null);
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showAreas, setShowAreas] = useState(false);
  const [hap, setHap] = useState(true);
  const [snd, setSnd] = useState(true);

  useEffect(() => { setHap(getHaptics()); setSnd(getSounds()); }, []);

  const loadAll = async () => {
    const [s, e, a] = await Promise.all([
      api('/settings'), api('/employees'), api('/areas'),
    ]);
    setSettings(s.settings); setEmployees(e.employees); setAreas(a.areas);
  };
  useEffect(() => { loadAll(); }, []);

  const toggle = async (key) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    await api('/settings', { method: 'PATCH', body: { [key]: next[key] } });
  };

  const switchArea = async (id) => {
    setSettings({ ...settings, currentAreaId: id });
    await api('/settings', { method: 'PATCH', body: { currentAreaId: id } });
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
              <div className="text-[13px] text-[#8E8E93] truncate">{e.username}</div>
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
      </Section>

      <Section header="History">
        <Row onClick={async () => {
          if (!confirm("Clear today's history? Completed breaks will be permanently deleted.")) return;
          try {
            const d = todayStr();
            const r = await api(`/history?date=${d}`, { method: 'DELETE' });
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
            const r = await api(`/history?all=1`, { method: 'DELETE' });
            fx.success();
            alert(`Deleted ${r.deleted} records`);
          } catch (e) { fx.error(); alert(e.message); }
        }}>
          <Trash2 size={18} className="text-[#FF3B30]" />
          <div className="flex-1 text-[16px] text-[#FF3B30]">Clear All History (Area)</div>
        </Row>
      </Section>

      <Section header="Organization">
        <EditRow label="Organization" value={settings.organizationName} onSave={async (v) => { await api('/settings', { method: 'PATCH', body: { organizationName: v } }); loadAll(); }} />
        <EditRow label="Supervisor" value={settings.supervisorName} onSave={async (v) => { await api('/settings', { method: 'PATCH', body: { supervisorName: v } }); loadAll(); }} />
      </Section>

      <Section header="About">
        <Row>
          <span className="flex-1 text-[16px]">Version</span>
          <span className="text-[#8E8E93]">1.0.0</span>
        </Row>

        <Row
          onClick={() =>
            window.location.href =
            "mailto:support@shiftops.app?subject=ShiftOps%20Bug%20Report&body=Device:%0ABrowser:%0AVersion:%201.0.0%0A%0ADescribe%20the%20issue:%0A%0ASteps%20to%20reproduce:%0A%0AExpected%20result:%0A%0AActual%20result:"
          }
        >
          <span className="flex-1 text-[16px]">Report a Bug</span>
          <ChevronRight size={18} className="text-[#C7C7CC]" />
        </Row>

        {/*<Row onClick={() => window.location.href = "/privacy"}>
    <span className="flex-1 text-[16px]">Privacy Policy</span>
    <ChevronRight size={18} className="text-[#C7C7CC]" />
  </Row>*/}
      </Section>

      <div className="mx-4 mt-6">
        <button
          onClick={() => {
            const confirmed = window.confirm(
              "Are you sure you want to log out?"
            );

            if (!confirmed) return;

            onLogout();
          }}
          className="w-full bg-white rounded-2xl py-3.5 text-[17px] font-semibold text-[#FF3B30] flex items-center justify-center gap-2"
        >
          <LogOut size={18} />
          Log Out
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
    name: emp?.name || '',
    username: emp?.username || '',
    role: emp?.role || 'employee',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.name || !f.username) {
      alert('Name and Username are required');
      return;
    }
    setBusy(true);
    try {
      if (isNew) {
        await api('/employees', { method: 'POST', body: f });
      } else {
        await api(`/employees/${emp.id}`, { method: 'PATCH', body: f });
      }
      onClose();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete ${emp.name}? This cannot be undone.`)) return;
    await api(`/employees/${emp.id}`, { method: 'DELETE' });
    onClose();
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
            <Field
              label="Name"
              value={f.name}
              onChange={(v) => setF({ ...f, name: v })}
            />

            <Field
              label="Username"
              value={f.username}
              onChange={(v) =>
                setF({
                  ...f,
                  username: v,
                })
              }
            />
          </FieldGroup>
          <FieldGroup>
            <div className="px-4 py-3 flex items-center gap-3 border-t">
              <div className="text-[15px] text-[#8E8E93] w-24">
                Role
              </div>

              <select
                value={f.role}
                onChange={(e) =>
                  setF({
                    ...f,
                    role: e.target.value,
                  })
                }
                className="flex-1 bg-transparent outline-none text-[16px]"
              >
                <option value="employee">Employee</option>
                <option value="supervisor">Supervisor</option>
              </select>
            </div>
          </FieldGroup>
          {!isNew && (
            <>
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
    const r = await api('/areas', { method: 'POST', body: { name: newName.trim() } });
    setList([...list, r]);
    setNewName('');
  };
  const rename = async (a) => {
    const n = prompt('Rename area', a.name);
    if (!n) return;
    await api(`/areas/${a.id}`, { method: 'PATCH', body: { name: n } });
    setList(list.map(x => x.id === a.id ? { ...x, name: n } : x));
  };
  const del = async (a) => {
    if (!confirm(`Delete area "${a.name}"?`)) return;
    try {
      await api(`/areas/${a.id}`, { method: 'DELETE' });
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
    const [{ settings }, { areas }] = await Promise.all([api('/settings'), api('/areas')]);
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
