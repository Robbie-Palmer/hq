// mid-fi/log.jsx — Cook Log & Insights.
// "Track what I've cooked and when → variety/balance, popular vs neglected,
//  last-cooked freshness signal." Personal-first, household-aware (per-member
//  filter). Auto (finishing cooking mode) + manual catch-up logging.
//
// IA note: Scan/Add is an ACTION, not a destination — demoted from a nav tab
// to a "＋" button, which frees a slot for "Log" so the nav doesn't grow.

// ── DATA ───────────────────────────────────────────────────────
// Cook log: one row per meal cooked. {rid, d (days ago), by (member id), s (serves)}.
// Authored so a clear story falls out: Italian-heavy, a couple of recipes in
// heavy rotation, a couple gathering dust.
const CL_LOG = [
  { rid: 'cajun',   d: 2,  by: 'j', s: 4 },
  { rid: 'creamy',  d: 3,  by: 'r', s: 3 },
  { rid: 'chorizo', d: 5,  by: 'r', s: 4 },
  { rid: 'queso',   d: 9,  by: 'e', s: 4 },
  { rid: 'cajun',   d: 11, by: 'r', s: 4 },
  { rid: 'chips',   d: 12, by: 'r', s: 2 },
  { rid: 'creamy',  d: 14, by: 'r', s: 3 },
  { rid: 'slowmex', d: 16, by: 'r', s: 6 },
  { rid: 'chorizo', d: 19, by: 'e', s: 4 },
  { rid: 'pesto',   d: 21, by: 'e', s: 4 },
  { rid: 'queso',   d: 23, by: 'r', s: 4 },
  { rid: 'cajun',   d: 24, by: 'j', s: 4 },
  { rid: 'creamy',  d: 27, by: 'e', s: 3 },
  { rid: 'chips',   d: 30, by: 'j', s: 2 },
  { rid: 'chorizo', d: 33, by: 'r', s: 4 },
  { rid: 'creamy',  d: 40, by: 'r', s: 3 },
  { rid: 'queso',   d: 44, by: 'n', s: 4 },
  { rid: 'alfredo', d: 47, by: 'r', s: 4 },
  { rid: 'chorizo', d: 48, by: 'r', s: 6 },
  { rid: 'slowmex', d: 51, by: 'r', s: 6 },
  { rid: 'pesto',   d: 55, by: 'r', s: 4 },
  { rid: 'chorizo', d: 61, by: 'j', s: 4 },
  { rid: 'soup',    d: 63, by: 'r', s: 4 },
];
const CL_WINDOW = 70; // days the log covers

// Cuisine palette — warm/earthy, distinct enough to read a balance chart.
const CL_CUISINE = {
  Italian: '#C8693C', Mexican: '#E2A040', Cajun: '#99394A',
  Chinese: '#8FA677', British: '#B8AED1',
};

const clById = Object.fromEntries(RECIPES.map(r => [r.id, r]));

function clAgo(d) {
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return d + 'd ago';
  if (d < 14) return '1 wk ago';
  if (d < 56) return Math.round(d / 7) + ' wks ago';
  return Math.round(d / 30) + ' mo ago';
}

// Freshness signal for the "avoid repeating too soon" job.
function clFresh(d) {
  if (d < 7)  return { label: 'just cooked',    tone: 'var(--terracotta-deep)', dot: '#C8693C',  rest: true };
  if (d < 21) return { label: 'still resting',  tone: 'var(--ink-3)',           dot: 'var(--butter)' };
  return            { label: 'due a revisit',   tone: '#5E7A3F',                dot: 'var(--sage)' };
}

// Per-recipe rollup from the (optionally member-filtered) log.
function clRollup(log) {
  const m = {};
  log.forEach(e => {
    const r = clById[e.rid]; if (!r) return;
    if (!m[e.rid]) m[e.rid] = { r, count: 0, last: 99, portions: 0 };
    m[e.rid].count++;
    m[e.rid].portions += e.s;
    m[e.rid].last = Math.min(m[e.rid].last, e.d);
  });
  return Object.values(m);
}

function clStats(log) {
  const roll = clRollup(log);
  const totalCooks = log.length;
  const distinct = roll.length;
  const repeatRate = totalCooks ? Math.round((totalCooks - distinct) / totalCooks * 100) : 0;
  const newPct = totalCooks ? Math.round(distinct / totalCooks * 100) : 0; // share that were a different dish
  const cuisine = {};
  log.forEach(e => { const c = clById[e.rid]?.cuisine; if (c) cuisine[c] = (cuisine[c] || 0) + 1; });
  const portions = log.reduce((a, e) => a + e.s, 0);
  return { roll, totalCooks, distinct, repeatRate, newPct, cuisine, portions };
}

// ── ATOMS ──────────────────────────────────────────────────────
function CLDonut({ segs, size = 140, thickness = 22, center }) {
  const total = segs.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0; const stops = [];
  segs.forEach(s => {
    const a0 = acc / total * 360; acc += s.value; const a1 = acc / total * 360;
    stops.push(`${s.color} ${a0}deg ${a1}deg`);
  });
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${stops.join(',')})`, boxShadow: 'inset 0 0 0 1px rgba(31,26,20,0.12)' }}></div>
      <div style={{ position: 'absolute', inset: thickness, borderRadius: '50%', background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>{center}</div>
    </div>
  );
}

function CLStat({ n, label, sub, tone = 'var(--ink)' }) {
  return (
    <div style={{ background: 'var(--card)', border: '1.25px solid var(--line-strong)', borderRadius: 10, padding: '12px 14px' }}>
      <div className="mf-display" style={{ fontSize: 38, lineHeight: 0.9, color: tone }}>{n}</div>
      <div style={{ fontFamily: 'Kalam', fontSize: 14, color: 'var(--ink)', marginTop: 4 }}>{label}</div>
      {sub && <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// "What & when" — contribution-graph heatmap of cooking days.
function CLHeatmap({ log, weeks = 10, cell = 14, gap = 4 }) {
  const byDay = new Array(weeks * 7).fill(0);
  log.forEach(e => { if (e.d < byDay.length) byDay[e.d]++; });
  const cols = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const col = [];
    for (let dow = 0; dow < 7; dow++) col.push(byDay[w * 7 + dow] || 0);
    cols.push(col);
  }
  const shade = (c) => c === 0 ? 'var(--paper-warm)' : c === 1 ? 'rgba(200,105,60,0.45)' : 'var(--terracotta)';
  return (
    <div>
      <div style={{ display: 'flex', gap }}>
        {cols.map((col, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap }}>
            {col.map((c, j) => (
              <div key={j} title={c ? `${c} cooked` : 'nothing cooked'} style={{ width: cell, height: cell, borderRadius: 3, background: shade(c), boxShadow: 'inset 0 0 0 1px rgba(31,26,20,0.06)' }}></div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span className="mf-mono" style={{ color: 'var(--ink-4)', fontSize: 9 }}>{weeks} weeks ago</span>
        <span className="mf-mono" style={{ color: 'var(--ink-4)', fontSize: 9 }}>this week</span>
      </div>
    </div>
  );
}

// Member filter chips — All + each household member.
function CLMemberFilter({ members, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>who cooked:</span>
      <span onClick={() => onChange('all')} className={'mf-tag ' + (value === 'all' ? 'include' : '')} style={{ fontSize: 12, cursor: 'pointer' }}>everyone</span>
      {members.map(m => (
        <span key={m.id} onClick={() => onChange(m.id)} className={'mf-tag ' + (value === m.id ? 'include' : '')} style={{ fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, paddingLeft: 4 }}>
          <MemberDot m={m} size={16} ring />{m.name}{m.you ? '' : ''}
        </span>
      ))}
    </div>
  );
}

// Recipe swatch (mini food photo).
function CLChip({ r, size = 28 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 6, background: `linear-gradient(135deg, ${r.palette[0]}, ${r.palette[1]})`, position: 'relative', flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(31,26,20,0.15)' }}>
      <FoodGlyph kind={r.glyph} size={size * 0.74} />
    </span>
  );
}

// Cuisine legend row.
function CLCuisineLegend({ cuisine, total }) {
  const rows = Object.entries(cuisine).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(([c, n]) => (
        <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: CL_CUISINE[c] || 'var(--ink-3)', flexShrink: 0 }}></span>
          <span style={{ flex: 1, fontFamily: 'Kalam', fontSize: 14 }}>{c}</span>
          <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 10 }}>{Math.round(n / total * 100)}%</span>
          <span style={{ fontFamily: 'Kalam', fontSize: 13, color: 'var(--ink-2)', width: 22, textAlign: 'right' }}>×{n}</span>
        </div>
      ))}
    </div>
  );
}

// Keep the log artboards on the same six-destination shell as every other
// signed-in desktop screen.
function LogNav({ active = 'log' }) {
  return <Nav active={active} />;
}

window.CL_LOG = CL_LOG;
window.CL_CUISINE = CL_CUISINE;
window.clById = clById;
window.clAgo = clAgo;
window.clFresh = clFresh;
window.clRollup = clRollup;
window.clStats = clStats;
window.CLDonut = CLDonut;
window.CLStat = CLStat;
window.CLHeatmap = CLHeatmap;
window.CLMemberFilter = CLMemberFilter;
window.CLChip = CLChip;
window.CLCuisineLegend = CLCuisineLegend;
window.LogNav = LogNav;
