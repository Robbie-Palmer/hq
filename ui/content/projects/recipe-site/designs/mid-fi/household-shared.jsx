// mid-fi/household-shared.jsx — Pantry-shared, Shopping-shared, Activity feed, mobile artboards.

// ── activity events (used by feed and inline) ────────────────
const HH_ACTIVITY = [
  { who: 'e', verb: 'flipped',  what: 'eggs',                 to: 'have',     when: 'just now', surface: 'pantry' },
  { who: 'j', verb: 'opted out of', what: 'Tue · dinner',          when: '2m ago',  surface: 'plan',   detail: 'late at work' },
  { who: 'r', verb: 'ticked',   what: 'cherry tomatoes',      when: '8m ago',  surface: 'shop',   to: 'in cart' },
  { who: 'e', verb: 'started cooking', what: 'Chorizo Pasta Bake', when: '14m ago', surface: 'cook' },
  { who: 'j', verb: 'added',    what: 'Salmon fillets ×2',    when: '32m ago', surface: 'freezer', to: '60d eat-by' },
  { who: 'n', verb: 'flipped',  what: 'soft cheese',          to: 'out',      when: '1h ago',  surface: 'pantry' },
  { who: 'r', verb: 'ticked',   what: 'mozzarella · chorizo · basil', when: '1h ago', surface: 'shop', to: '3 items off the list' },
  { who: 'e', verb: 'added',    what: 'Chicken Risotto',      when: '2h ago',  surface: 'plan',   detail: 'Wed dinner' },
  { who: 'j', verb: 'claimed',  what: 'Sat dinner',           when: '3h ago',  surface: 'plan',   detail: 'Slow Cooker Mexican' },
  { who: 'e', verb: 'flipped',  what: 'parsley · basil',      to: 'have',     when: '4h ago',  surface: 'pantry' },
  { who: 'r', verb: 'updated diet', what: 'added "low-FODMAP review"', when: 'yesterday', surface: 'diet' },
  { who: 'j', verb: 'shopping list', what: 'checked off 5 items', when: 'yesterday', surface: 'shop' },
  { who: 'n', verb: 'set diet',  what: 'no chilli',           when: 'yesterday', surface: 'diet' },
  { who: 'r', verb: 'ate a portion', what: 'Cajun Sausage Pasta', when: 'yesterday', surface: 'freezer', to: '1 portion left' },
  { who: 'e', verb: 'cooked',   what: 'Quesadillas',          when: '2d ago',  surface: 'cook', to: '2 leftover portions → freezer' },
  { who: 'j', verb: 'finished cooking', what: 'Cajun Sausage Pasta', when: '3d ago', surface: 'cook', to: 'pantry auto-deducted' },
  { who: 'r', verb: 'set away',  what: 'Mon → Wed lunches',   when: '3d ago',  surface: 'plan',  detail: 'work trip' },
  { who: 'e', verb: 'froze',    what: 'beef mince 500g',      when: '4d ago',  surface: 'freezer', to: '28d eat-by' },
];

function ActivityFeed({ density = 'compact', limit, surface }) {
  const t = useHH();
  if (density === 'hidden') return null;
  const members = getMembers(t.householdSize);
  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  const items = HH_ACTIVITY.filter(a => byId[a.who] && (!surface || a.surface === surface)).slice(0, limit || (density === 'compact' ? 5 : 999));
  const surfaceIcon = { pantry: '🧂', freezer: '❄️', plan: '📅', shop: '🛒', cook: '🍴', diet: '🥗' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: density === 'full' ? 4 : 2 }}>
      {items.map((a, i) => {
        const m = byId[a.who];
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: density === 'full' ? '6px 4px' : '3px 0', borderBottom: density === 'full' ? '1px dashed var(--line)' : 'none' }}>
            <MemberDot m={m} size={20} ring />
            <div style={{ flex: 1, fontFamily: 'Kalam', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.35 }}>
              <span style={{ color: 'var(--ink)' }}>{m.name}</span>
              <span style={{ color: 'var(--ink-3)' }}> {a.verb} </span>
              <span style={{ color: 'var(--ink)', fontWeight: a.surface === 'pantry' ? 700 : 400 }}>{a.what}</span>
              {a.to && <span style={{ color: a.to === 'have' || a.to === 'in cart' ? 'var(--sage)' : 'var(--terracotta-deep)' }}> · {a.to}</span>}
              {a.detail && <span style={{ color: 'var(--ink-3)' }}> — {a.detail}</span>}
            </div>
            <span className="mf-mono" style={{ color: 'var(--ink-4)', fontSize: 9 }} title={a.surface}>{surfaceIcon[a.surface]} {a.when}</span>
          </div>
        );
      })}
      {density === 'compact' && items.length >= 5 && (
        <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 4, cursor: 'pointer' }}>show all →</div>
      )}
    </div>
  );
}
window.HH_ACTIVITY = HH_ACTIVITY; window.ActivityFeed = ActivityFeed;

// ──────────────────────────────────────────────────────────────
// PANTRY · shared with the household
// ──────────────────────────────────────────────────────────────
// Per-item provenance — who flipped it last, when.
const PANTRY_TRACE = {
  'eggs':            { who: 'e', when: 'just now',  age: 'fresh' },
  'mozzarella':      { who: 'j', when: '2h ago',    age: 'fresh' },
  'soft cheese':     { who: 'n', when: '1h ago',    age: 'fresh' },
  'milk':            { who: 'r', when: 'yesterday', age: 'stable' },
  'butter':          { who: 'e', when: '2d ago',    age: 'stable' },
  'parmesan':        { who: 'r', when: 'last week', age: 'old' },
  'yoghurt':         { who: 'e', when: '3d ago',    age: 'stable' },
  'pasta · farfalle':{ who: 'r', when: 'last week', age: 'stable' },
  'pasta · penne':   { who: 'j', when: '4d ago',    age: 'stable' },
  'rice · basmati':  { who: 'r', when: 'last week', age: 'stable' },
  'tinned cherry tomatoes': { who: 'j', when: '1h ago', age: 'fresh' },
  'tinned chopped tomatoes':{ who: 'r', when: '3d ago', age: 'stable' },
  'tinned chickpeas':{ who: 'e', when: 'last week', age: 'old' },
  'olive oil':       { who: 'r', when: 'always',    age: 'stable' },
  'salt':            { who: 'r', when: 'always',    age: 'stable' },
  'black pepper':    { who: 'r', when: 'always',    age: 'stable' },
  'oregano (dried)': { who: 'r', when: '2 weeks',   age: 'stable' },
  'cumin':           { who: 'j', when: '3 weeks',   age: 'stable' },
  'paprika':         { who: 'r', when: '2 weeks',   age: 'stable' },
  'onion':           { who: 'e', when: 'today',     age: 'fresh' },
  'garlic':          { who: 'r', when: 'today',     age: 'fresh' },
  'basil':           { who: 'e', when: 'today',     age: 'fresh' },
  'parsley':         { who: 'j', when: '2d ago',    age: 'fresh' },
  'lemon':           { who: 'r', when: '5d ago',    age: 'fresh' },
  'chilli':          { who: 'j', when: '4d ago',    age: 'fresh' },
};

function MidPantryShared() {
  const t = useHH();
  const members = getMembers(t.householdSize);
  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  const [stock, setStock] = React.useState(() => {
    const m = {};
    Object.entries(PANTRY).forEach(([sec, items]) => items.forEach(([n, on]) => m[n] = on));
    return m;
  });
  const [chipFilter, setChipFilter] = React.useState('all'); // all | mine | recent
  const toggle = (n) => setStock(s => ({ ...s, [n]: !s[n] }));
  const passes = (n) => {
    const tr = PANTRY_TRACE[n];
    if (!tr) return chipFilter === 'all';
    if (chipFilter === 'mine')   return tr.who === 'r';
    if (chipFilter === 'recent') return tr.age === 'fresh';
    return true;
  };
  return (
    <div className="mf mf-page">
      <Nav active="kitchen" />

      {/* shared banner */}
      <div style={{ padding: '14px 48px 0' }}>
        <div className="mf-card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid var(--sage)', background: 'rgba(143,166,119,0.06)' }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--sage)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🏠</span>
          <span style={{ fontFamily: 'Kalam', fontSize: 14, color: 'var(--ink-2)' }}>
            <b>Pantry is shared</b> with <b>{HH_NAME}</b> · changes show up live for everyone.
          </span>
          <MemberStack members={members} size={22} max={6} overlap={6} />
          <span className="mf-mono" style={{ color: 'var(--ink-3)', marginLeft: 'auto' }}>3 online now</span>
        </div>
      </div>

      <div style={{ padding: '14px 48px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>KITCHEN · WHAT'S IN STOCK</div>
          <h1 className="mf-display" style={{ fontSize: 50, margin: '4px 0 0', lineHeight: 0.95 }}>our <span style={{ color: 'var(--terracotta)' }}>pantry.</span></h1>
        </div>
        <button className="mf-btn primary">＋ add to pantry</button>
      </div>

      {/* tabs */}
      <div style={{ padding: '12px 48px 0', display: 'flex', borderBottom: '1px solid var(--line)' }}>
        {[['pantry','🧂 Pantry'],['freezer','❄️ Freezer']].map(([k, l], i) => (
          <span key={k} style={{ padding: '10px 14px', fontFamily: 'Kalam', fontSize: 15, color: i === 0 ? 'var(--ink)' : 'var(--ink-3)', borderBottom: i === 0 ? '2px solid var(--terracotta)' : '2px solid transparent', marginBottom: -1, fontWeight: i === 0 ? 700 : 400, cursor: 'pointer' }}>{l}</span>
        ))}
      </div>

      <div style={{ padding: '18px 48px 40px', display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24 }}>
        {/* LEFT — chip grid with presence */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div className="mf-search" style={{ flex: 1, padding: '6px 12px' }}>
              <span style={{ color: 'var(--ink-3)' }}>⌕</span>
              <input placeholder="search the pantry…" style={{ fontSize: 13 }} />
            </div>
            <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>filter:</span>
            {[['all','everyone'],['mine','just me'],['recent','recently flipped']].map(([k, l]) => (
              <span key={k} onClick={() => setChipFilter(k)} className={'mf-tag ' + (chipFilter === k ? 'include' : '')} style={{ fontSize: 11, cursor: 'pointer' }}>{l}</span>
            ))}
          </div>

          {Object.entries(PANTRY).map(([section, items]) => {
            const inStock = items.filter(([n]) => stock[n] && passes(n));
            const hidden = items.filter(([n]) => stock[n] && !passes(n)).length;
            return (
              <div key={section} style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
                  <div className="mf-display" style={{ fontSize: 22, color: 'var(--terracotta)' }}>· {section}</div>
                  <div className="mf-mono" style={{ color: 'var(--ink-3)' }}>
                    {inStock.length} items{hidden > 0 ? ' · ' + hidden + ' filtered out' : ' · tap × to remove'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {inStock.map(([n]) => {
                    const trace = PANTRY_TRACE[n];
                    const m = trace && byId[trace.who];
                    const fresh = trace && trace.age === 'fresh';
                    return (
                      <span key={n} className="mf-tag include" style={{
                        fontSize: 13, padding: '3px 6px 3px 4px', display: 'inline-flex', alignItems: 'center', gap: 6,
                        outline: fresh ? '2px solid var(--sage)' : 'none', outlineOffset: 1,
                      }}>
                        {m && <MemberDot m={m} size={16} ring />}
                        {n}
                        <span onClick={() => toggle(n)} style={{ cursor: 'pointer', opacity: 0.7, padding: '0 4px' }}>×</span>
                      </span>
                    );
                  })}
                  <span className="mf-tag" style={{ borderStyle: 'dashed', fontSize: 13, color: 'var(--terracotta)', cursor: 'pointer' }}>＋ add to {section}</span>
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 18, padding: '8px 12px', background: 'var(--paper-warm)', borderRadius: 8, fontFamily: 'Kalam', fontSize: 13, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>KEY</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MemberDot m={members[0]} size={16} ring /> who flipped it last
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--ink)', outline: '2px solid var(--sage)', outlineOffset: 1 }}></span>
              just changed
            </span>
            <span className="mf-mono" style={{ color: 'var(--ink-3)', marginLeft: 'auto' }}>activity feed shows every change — no locking, no blocking</span>
          </div>
        </div>

        {/* RIGHT — activity feed + presence */}
        <div>
          <div className="mf-card" style={{ padding: 16, borderLeft: '3px solid var(--terracotta)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>HOUSEHOLD ACTIVITY</span>
              <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>{t.activityDensity} · click to expand</span>
            </div>
            <div style={{ marginTop: 8 }}><ActivityFeed density={t.activityDensity} limit={t.activityDensity === 'full' ? 999 : 6} /></div>
          </div>

          <div className="mf-card" style={{ padding: 14, marginTop: 14 }}>
            <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>PRESENCE · WHO'S COOKING</span>
            <div style={{ marginTop: 8 }}>
              {members.map((m, i) => {
                const status = i === 0 ? 'planning Sunday' : i === 1 ? 'cooking · Chorizo Bake · step 4' : i === 2 ? 'in shop' : 'away';
                const live = i === 1 || i === 2;
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                    <span style={{ position: 'relative' }}>
                      <MemberDot m={m} size={28} ring />
                      <span style={{ position: 'absolute', right: -2, bottom: -2, width: 10, height: 10, borderRadius: '50%', background: live ? 'var(--sage)' : 'var(--ink-4)', border: '2px solid var(--paper)' }}></span>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Kalam', fontSize: 13, lineHeight: 1.1 }}>{m.name} {m.you && <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>you</span>}</div>
                      <div className="mf-mono" style={{ color: live ? 'var(--sage)' : 'var(--ink-3)', fontSize: 9 }}>{status}</div>
                    </div>
                    {live && <span style={{ width: 6, height: 6, borderRadius: 6, background: 'var(--sage)', animation: 'pulse 1.5s infinite' }}></span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
window.MidPantryShared = MidPantryShared;

// ──────────────────────────────────────────────────────────────
// SHOPPING / MEAL-PLAN — shared, with opt-outs + scaling
// ──────────────────────────────────────────────────────────────
function MidShoppingShared() {
  const t = useHH();
  const members = getMembers(t.householdSize);
  const days = ['mon','tue','wed','thu','fri','sat','sun'];
  const slots = ['lunch','dinner'];

  // Meal cells — each carries: recipe index, for[] (who it's for), cook (id|null), opted-out members.
  // Wed dinner is a SPLIT slot: two parallel cook sessions (Risotto for 3 + Salmon for 1).
  const cells = {
    'mon-dinner': { r: 0, for: ['r','e','j','n','m','a'].slice(0, t.householdSize), cook: 'e' },
    'tue-lunch':  { r: 0, leftover: true, from: 'mon dinner', for: ['r','e','j','m'].slice(0, t.householdSize) },
    'tue-dinner': { r: 1, for: ['r','e','j','m','a'].slice(0, t.householdSize), out: ['j','n'], cook: 'r' },
    'wed-dinner': {
      sessions: [
        { r: 8, label: 'Chicken Alfredo', for: ['r','e','m','a'].slice(0, t.householdSize), cook: 'r' },
        { r: 'salmon', label: 'Pan-fried Salmon', for: ['j'], cook: 'j', why: 'low-FODMAP', palette: ['#E59B7D','#A8523B'], glyph: 'bowl' },
      ],
    },
    'thu-lunch':  { r: 8, leftover: true, from: 'wed dinner', for: ['e','m'].slice(0, t.householdSize) },
    'fri-dinner': { r: 2, for: ['r','e'].slice(0, t.householdSize), detail: 'date night', cook: 'r' },
    'sat-dinner': { r: 3, for: ['r','e','j','n','m','a'].slice(0, t.householdSize), cook: 'j', detail: 'slow cooker' },
  };
  const byId = Object.fromEntries(members.map(m => [m.id, m]));

  return (
    <div className="mf mf-page">
      <Nav active="planning" />

      {/* shared banner */}
      <div style={{ padding: '14px 48px 0' }}>
        <div className="mf-card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid var(--sage)', background: 'rgba(143,166,119,0.06)' }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--sage)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🏠</span>
          <span style={{ fontFamily: 'Kalam', fontSize: 14, color: 'var(--ink-2)' }}>
            <b>Plan & list are shared</b> with <b>{HH_NAME}</b> · everyone sees the same week, anyone can opt out.
          </span>
          <MemberStack members={members} size={22} max={6} overlap={6} />
        </div>
      </div>

      <div style={{ padding: '14px 48px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>SHOPPING · WEEK OF 27 APR</div>
          <h1 className="mf-display" style={{ fontSize: 48, margin: '4px 0 0' }}>what's the plan?</h1>
        </div>
      </div>

      <div style={{ padding: '18px 48px 32px' }}>
        {/* calendar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(7, 1fr)', gap: 6, position: 'relative' }}>
          <div></div>
          {days.map(d => (
            <div key={d} className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 10, textAlign: 'center', padding: '4px 0' }}>{d.toUpperCase()}</div>
          ))}
          {slots.map(slot => (
            <React.Fragment key={slot}>
              <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 10, alignSelf: 'flex-start', paddingTop: 12, textAlign: 'right', paddingRight: 6 }}>{slot}</div>
              {days.map(d => {
                const cell = cells[d + '-' + slot];
                return <MealCell key={d + '-' + slot} cell={cell} members={members} byId={byId} t={t} />;
              })}
            </React.Fragment>
          ))}
        </div>

        {/* opt-out style note */}
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--paper-warm)', borderRadius: 8, fontFamily: 'Kalam', fontSize: 12, color: 'var(--ink-2)' }}>
          <span className="mf-mono" style={{ color: 'var(--terracotta)', marginRight: 8 }}>OPT-OUT STYLE · {t.optOutStyle.toUpperCase().replace('-', ' ')}</span>
          {t.optOutStyle === 'inline-badge' && 'opt-outs strike through that member\'s avatar on the meal · click to set per-meal, recurring, or date range.'}
          {t.optOutStyle === 'rail' && 'opt-out members move to a "not eating" rail under each meal.'}
          {t.optOutStyle === 'banner' && 'date-range opt-outs become a top banner ("Jamie away Mon–Wed") that recolors affected meals.'}
        </div>

        {/* below: scaling impact + cooking-for popover */}
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {/* Cooking-for popover — content swaps with diet model */}
          <DietModelMealCard members={members} t={t} />

          {/* range opt-out — Jamie away */}
          <div className="mf-card" style={{ padding: 14 }}>
            <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>RANGE OPT-OUT</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <MemberDot m={byId.j || members[2] || members[0]} size={28} ring />
              <div style={{ flex: 1 }}>
                <div className="mf-display" style={{ fontSize: 18, lineHeight: 1 }}>Jamie away Mon → Wed</div>
                <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>3 dinners · 3 lunches · auto-applied</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>SCOPE</span>
              <span className="mf-tag include" style={{ fontSize: 11 }}>this week</span>
              <span className="mf-tag" style={{ fontSize: 11 }}>recurring</span>
              <span className="mf-tag" style={{ fontSize: 11 }}>date range</span>
            </div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 10 }}>IMPACT</div>
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3, fontFamily: 'Kalam', fontSize: 12 }}>
              <div>· cherry tomatoes: 2 tins → <b>1 tin</b></div>
              <div>· chicken: 1.2kg → <b>900g</b></div>
              <div>· farfalle: 600g → <b>450g</b></div>
            </div>
            <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(143,166,119,0.10)', borderRadius: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
              suggesting <b>smaller batches</b> for affected meals · or freeze leftovers ↩
            </div>
          </div>

          {/* split meal editor — shows when one slot holds multiple cook sessions */}
          <div className="mf-card" style={{ padding: 14, borderColor: 'var(--ink)', borderWidth: 1.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>SPLIT MEAL · WED DINNER</div>
              <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>2 cook sessions · 1 slot</span>
            </div>

            {/* SESSION 1 — Alfredo for the rest */}
            <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 22, height: 22, borderRadius: 4, background: 'linear-gradient(135deg, #E5C892, #9C7740)' }}></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mf-display" style={{ fontSize: 16, lineHeight: 1 }}>Chicken Alfredo</div>
                  <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>for 3 · ~30m · italian</div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px 1px 2px', borderRadius: 999, background: 'var(--ink)', color: 'var(--paper)', fontFamily: 'JetBrains Mono', fontSize: 9 }}>
                  <MemberDot m={byId.r || members[0]} size={12} /> robbie cooks
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                {['r','e','m'].slice(0, Math.max(0, members.length - 1)).map(id => byId[id] && (
                  <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px 1px 2px', borderRadius: 999, background: 'var(--paper-warm)', border: '1px solid var(--line)', fontFamily: 'Kalam', fontSize: 10 }}>
                    <MemberDot m={byId[id]} size={12} /> {byId[id].name}
                  </span>
                ))}
              </div>
            </div>

            {/* SESSION 2 — Salmon for Jamie */}
            <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'rgba(245,199,100,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 22, height: 22, borderRadius: 4, background: 'linear-gradient(135deg, #E59B7D, #A8523B)' }}></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mf-display" style={{ fontSize: 16, lineHeight: 1 }}>Pan-fried Salmon</div>
                  <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>for 1 · ~15m · low-FODMAP friendly</div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px 1px 2px', borderRadius: 999, background: 'var(--ink)', color: 'var(--paper)', fontFamily: 'JetBrains Mono', fontSize: 9 }}>
                  <MemberDot m={byId.j || members[2] || members[0]} size={12} /> jamie cooks
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                {byId.j && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px 1px 2px', borderRadius: 999, background: 'var(--paper-warm)', border: '1px solid var(--line)', fontFamily: 'Kalam', fontSize: 10 }}>
                    <MemberDot m={byId.j} size={12} /> Jamie
                  </span>
                )}
                <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9, marginLeft: 'auto' }}>solo · own diet</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button className="mf-btn ghost sm" style={{ flex: 1, fontSize: 11, borderStyle: 'dashed' }}>＋ another session</button>
              <button className="mf-btn ghost sm" style={{ fontSize: 11 }}>merge ↶</button>
            </div>
            <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(143,166,119,0.10)', borderRadius: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
              both bags → <b>one shopping list</b> · both cooks → <b>shared pantry</b>. Activity feed logs each separately.
            </div>
          </div>
        </div>

        {/* split-meals explainer row */}
        <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(245,199,100,0.10)', border: '1px dashed var(--butter)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontFamily: 'Kalam', fontSize: 13, color: 'var(--ink-2)' }}>
          <span style={{ fontFamily: 'Caveat', fontSize: 22, color: 'var(--terracotta-deep)', flexShrink: 0 }}>split meals.</span>
          <span style={{ flex: 1, minWidth: 220 }}>
            a slot can hold multiple parallel cook sessions — each with its own recipe, cook, scale, and a subset of members. Shopping list & pantry stay <b>shared</b>; the calendar cell stacks the sessions vertically. A member belongs to at most one session per slot.
          </span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <span className="mf-tag soft" style={{ fontSize: 10 }}>different diets</span>
            <span className="mf-tag soft" style={{ fontSize: 10 }}>off-schedule</span>
            <span className="mf-tag soft" style={{ fontSize: 10 }}>picky kids</span>
            <span className="mf-tag soft" style={{ fontSize: 10 }}>solo cooking</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MealCell({ cell, members, byId, t }) {
  if (!cell) return <div className="mf-card" style={{ minHeight: 92, padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: 'Caveat', fontSize: 14, color: 'var(--ink-4)' }}>＋</span></div>;

  // Split slot — render a vertical stack of session mini-rows.
  if (cell.sessions) {
    return (
      <div className="mf-card" style={{ padding: 4, minHeight: 92, display: 'flex', flexDirection: 'column', gap: 3, position: 'relative', background: 'var(--card)', border: '1.25px solid var(--line-strong)' }}>
        <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 7, padding: '1px 3px', letterSpacing: '0.06em' }}>SPLIT · {cell.sessions.length} MEALS</div>
        {cell.sessions.map((s, i) => {
          const r = s.r === 'salmon' ? { palette: s.palette, glyph: s.glyph, title: s.label } : RECIPES[s.r];
          const cook = s.cook && byId[s.cook];
          return (
            <div key={i} style={{ padding: '3px 4px', borderRadius: 4, background: i === 0 ? 'transparent' : 'rgba(245,199,100,0.10)', borderTop: i === 0 ? 'none' : '1px dashed var(--line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 16, height: 16, borderRadius: 3, background: `linear-gradient(135deg, ${r.palette[0]}, ${r.palette[1]})`, flexShrink: 0 }}></span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'Caveat', fontSize: 12, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(s.label || r.title).split(' ').slice(0, 2).join(' ')}
                </span>
                {cook && (
                  <span title={cook.name + ' cooks'} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <MemberDot m={cook} size={11} ring />
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {s.for.map(id => byId[id] && <MemberDot key={id} m={byId[id]} size={11} />)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const r = RECIPES[cell.r];
  const forIds = cell.for || [];
  const outIds = cell.out || [];
  const cook = cell.cook && byId[cell.cook];
  const isLeftover = cell.leftover;
  const dimmed = outIds.length > 0 && t.optOutStyle === 'rail';

  return (
    <div className="mf-card" style={{
      padding: 6, minHeight: 92, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative',
      background: isLeftover ? 'transparent' : 'var(--card)',
      border: isLeftover ? '1.5px dashed var(--line-strong)' : '1.25px solid var(--line-strong)',
      opacity: isLeftover ? 0.85 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 22, height: 22, borderRadius: 4, background: `linear-gradient(135deg, ${r.palette[0]}, ${r.palette[1]})`, flexShrink: 0, opacity: isLeftover ? 0.55 : 1 }}></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Caveat', fontSize: 14, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.title.split(' ').slice(0, 3).join(' ')}
          </div>
          {isLeftover && <div className="mf-mono" style={{ color: 'var(--sage)', fontSize: 8 }}>↩ {cell.from}</div>}
          {cell.detail && !isLeftover && <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 8 }}>{cell.detail}</div>}
        </div>
      </div>

      {/* cooking-for row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
        {forIds.map(id => {
          const m = byId[id]; if (!m) return null;
          const out = outIds.includes(id);
          if (t.optOutStyle === 'inline-badge') {
            return <span key={id} style={{ position: 'relative', display: 'inline-block' }}>
              <MemberDot m={m} size={14} dim={out} />
              {out && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--terracotta-deep)', fontWeight: 900, fontSize: 16, lineHeight: 1 }}>/</span>}
            </span>;
          }
          if (t.optOutStyle === 'rail' && out) return null;
          return <MemberDot key={id} m={m} size={14} />;
        })}
      </div>

      {/* rail style: opt-outs below */}
      {t.optOutStyle === 'rail' && outIds.length > 0 && (
        <div style={{ marginTop: 2, padding: '1px 3px', background: 'rgba(200,105,60,0.08)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span className="mf-mono" style={{ color: 'var(--terracotta-deep)', fontSize: 7 }}>OUT</span>
          {outIds.map(id => byId[id] && <MemberDot key={id} m={byId[id]} size={11} dim />)}
        </div>
      )}

      {/* cook badge */}
      {cook && (
        <div style={{ position: 'absolute', top: 3, right: 3, padding: '1px 4px 1px 1px', borderRadius: 999, background: 'var(--ink)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: 'JetBrains Mono', fontSize: 8 }}>
          <MemberDot m={cook} size={12} ring />
          <span>cooks</span>
        </div>
      )}
    </div>
  );
}

window.MidShoppingShared = MidShoppingShared;

// ──────────────────────────────────────────────────────────────
// MOBILE artboards — household setup, settings, pantry, shopping
// ──────────────────────────────────────────────────────────────
function MobileHouseholdSetup() {
  return (
    <Phone>
      <div style={{ padding: '8px 18px 12px', borderBottom: '1px solid var(--line)' }}>
        <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>STEP 2 OF 3</div>
        <h2 className="mf-display" style={{ fontSize: 28, margin: '4px 0 0', lineHeight: 1 }}>invite your <span style={{ color: 'var(--terracotta)' }}>kitchen people.</span></h2>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
        <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>HOUSEHOLD NAME</div>
        <input defaultValue="Park Road kitchen" style={{ marginTop: 4, padding: '7px 12px', width: '100%', boxSizing: 'border-box', fontFamily: 'Caveat', fontSize: 22, border: '1.5px solid var(--ink)', borderRadius: 8, background: 'var(--card)' }} />

        <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 14 }}>SHARE A LINK</div>
        <div style={{ marginTop: 4, padding: '6px 10px', background: 'var(--paper-warm)', borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>robbiesrecipes.com/join/park-road…</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
          <button className="mf-btn primary sm" style={{ flex: 1, fontSize: 12 }}>copy link</button>
          <button className="mf-btn sm" style={{ flex: 1, fontSize: 12 }}>📤 share</button>
          <button className="mf-btn sm" style={{ flex: 1, fontSize: 12 }}>💬 text</button>
        </div>

        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>OR · LET THEM SCAN</div>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}><QRPlaceholder size={170} /></div>
          <div className="mf-mono" style={{ color: 'var(--ink-3)', marginTop: 8 }}>raise phone · they scan with the camera app</div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>BY EMAIL</div>
          <input placeholder="add an email…" style={{ marginTop: 4, padding: '7px 10px', width: '100%', boxSizing: 'border-box', fontFamily: 'Kalam', fontSize: 13, border: '1px solid var(--line-strong)', borderRadius: 6 }} />
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            <span className="mf-tag" style={{ fontSize: 11 }}>ellie@home.com ×</span>
            <span className="mf-tag" style={{ fontSize: 11 }}>jamie@home.com ×</span>
          </div>
        </div>
      </div>
      <div style={{ padding: '10px 18px 14px', borderTop: '1px solid var(--line)', display: 'flex', gap: 6, background: 'var(--card)' }}>
        <button className="mf-btn ghost" style={{ flex: 1 }}>← back</button>
        <button className="mf-btn primary" style={{ flex: 2 }}>next: what's shared →</button>
      </div>
    </Phone>
  );
}

function MobileHouseholdSettings() {
  const t = useHH();
  const members = getMembers(t.householdSize);
  return (
    <Phone>
      <div style={{ padding: '8px 18px 12px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="mf-btn ghost sm" style={{ padding: '4px 8px' }}>← settings</button>
          <MobileAvatar />
        </div>
        <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9, marginTop: 6 }}>HOUSEHOLD</div>
        <h2 className="mf-display" style={{ fontSize: 28, margin: '2px 0 0', lineHeight: 1 }}>{HH_NAME}</h2>
        <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9, marginTop: 2 }}>{members.length} people · you're the owner</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
        <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>MEMBERS</div>
        <div style={{ marginTop: 6, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
          {members.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: i % 2 ? 'transparent' : 'rgba(244,236,214,0.5)', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
              <MemberDot m={m} size={30} ring you={m.you} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'Kalam', fontSize: 13 }}>{m.name}{m.you && <span className="mf-mono" style={{ color: 'var(--terracotta)', marginLeft: 6 }}>you</span>}</div>
                <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{m.diet}</div>
              </div>
              <RoleSelect role={m.role} disabled={m.you} />
            </div>
          ))}
        </div>
        <button className="mf-btn primary sm" style={{ marginTop: 8, width: '100%' }}>＋ invite someone</button>

        <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 16 }}>SHARED SURFACES</div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            ['🧂 Pantry',        true],
            ['❄️ Freezer',       true],
            ['🛒 Shopping list', true],
            ['📅 Meal plan',     true],
            ['🥗 Diet profile',  false],
            ['📖 Recipes',       false],
          ].map(([k, on]) => (
            <div key={k} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontFamily: 'Kalam', fontSize: 13 }}>{k}</span>
              <Switch on={on} small />
            </div>
          ))}
        </div>

        <div className="mf-mono" style={{ color: 'var(--terracotta-deep)', marginTop: 16 }}>DANGER ZONE</div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="mf-btn">transfer ownership →</button>
          <button className="mf-btn" style={{ borderColor: 'var(--terracotta-deep)', color: 'var(--terracotta-deep)' }}>leave household</button>
        </div>
      </div>
    </Phone>
  );
}

function MobilePantryShared() {
  const t = useHH();
  const members = getMembers(t.householdSize);
  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  return (
    <Phone>
      <div style={{ padding: '8px 18px 8px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>PANTRY · SHARED</div>
            <h2 className="mf-display" style={{ fontSize: 26, margin: '2px 0 0', lineHeight: 1 }}>our <span style={{ color: 'var(--terracotta)' }}>pantry.</span></h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MemberStack members={members} size={22} max={4} overlap={6} />
            <MobileAvatar />
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 18px 14px' }}>
        {/* activity strip */}
        <div className="mf-card" style={{ padding: 8, borderLeft: '3px solid var(--terracotta)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>JUST HAPPENED</span>
            <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>see all →</span>
          </div>
          <div style={{ marginTop: 4 }}><ActivityFeed density="compact" limit={3} /></div>
        </div>

        {Object.entries(PANTRY).slice(0, 2).map(([section, items]) => (
          <div key={section} style={{ marginTop: 12 }}>
            <div className="mf-display" style={{ fontSize: 18, color: 'var(--terracotta)', borderBottom: '1px solid var(--line)', paddingBottom: 2 }}>· {section}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {items.filter(([, on]) => on).map(([n]) => {
                const tr = PANTRY_TRACE[n], m = tr && byId[tr.who];
                const fresh = tr && tr.age === 'fresh';
                return (
                  <span key={n} className="mf-tag include" style={{ fontSize: 12, padding: '2px 6px 2px 3px', display: 'inline-flex', alignItems: 'center', gap: 4, outline: fresh ? '2px solid var(--sage)' : 'none', outlineOffset: 1 }}>
                    {m && <MemberDot m={m} size={14} ring />}
                    {n}
                  </span>
                );
              })}
              <span className="mf-tag" style={{ fontSize: 12, borderStyle: 'dashed', color: 'var(--terracotta)' }}>＋ add</span>
            </div>
          </div>
        ))}
      </div>
      <TabBar active="kitchen" />
    </Phone>
  );
}

function MobileShoppingShared() {
  const t = useHH();
  const members = getMembers(t.householdSize);
  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  return (
    <Phone>
      <div style={{ padding: '8px 18px 10px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>PLAN · WEEK · 27 APR</div>
            <h2 className="mf-display" style={{ fontSize: 26, margin: '2px 0 0', lineHeight: 1 }}>what's <span style={{ color: 'var(--terracotta)' }}>cooking?</span></h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MemberStack members={members} size={22} max={4} overlap={6} />
            <MobileAvatar />
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 18px 14px' }}>
        {[
          { day: 'Mon', slot: 'dinner', r: 0, out: [], cook: 'e' },
          { day: 'Tue', slot: 'lunch',  r: 0, leftover: true },
          { day: 'Tue', slot: 'dinner', r: 1, out: ['j','n'], cook: 'r' },
          { day: 'Wed', slot: 'dinner', sessions: [
            { r: 8, label: 'Chicken Alfredo', for: ['r','e','m'], cook: 'r', palette: ['#E5C892','#9C7740'], glyph: 'pasta' },
            { r: 'salmon', label: 'Pan-fried Salmon', for: ['j'], cook: 'j', palette: ['#E59B7D','#A8523B'], glyph: 'bowl', why: 'low-FODMAP' },
          ] },
          { day: 'Fri', slot: 'dinner', r: 2, out: ['j','n','m','a'], detail: 'date night · for 2', cook: 'r' },
        ].map((cell, i) => {
          // SPLIT slot rendering — stacked sessions
          if (cell.sessions) {
            return (
              <div key={i} className="mf-card" style={{ padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>{cell.day} · {cell.slot}</div>
                  <span className="mf-mono" style={{ color: 'var(--butter)', fontSize: 9, padding: '1px 6px', background: 'rgba(245,199,100,0.18)', border: '1px solid var(--butter)', borderRadius: 999, color: 'var(--terracotta-deep)' }}>SPLIT · {cell.sessions.length}</span>
                </div>
                {cell.sessions.map((s, j) => (
                  <div key={j} style={{ marginTop: 8, padding: 8, borderRadius: 6, background: j === 0 ? 'transparent' : 'rgba(245,199,100,0.08)', border: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 30, height: 30, borderRadius: 4, background: `linear-gradient(135deg, ${s.palette[0]}, ${s.palette[1]})`, position: 'relative', flexShrink: 0 }}>{s.glyph && <FoodGlyph kind={s.glyph} size={22} />}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mf-display" style={{ fontSize: 16, lineHeight: 1 }}>{s.label}</div>
                        {s.why && <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{s.why}</div>}
                      </div>
                      {s.cook && byId[s.cook] && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px 2px 3px', borderRadius: 999, background: 'var(--ink)', color: 'var(--paper)', fontFamily: 'JetBrains Mono', fontSize: 9 }}>
                          <MemberDot m={byId[s.cook]} size={12} /> cooks
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                      <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>FOR</span>
                      {s.for.map(id => byId[id] && <MemberDot key={id} m={byId[id]} size={16} ring />)}
                    </div>
                  </div>
                ))}
              </div>
            );
          }
          const r = RECIPES[cell.r];
          const total = members.length;
          const eating = total - (cell.out || []).filter(id => byId[id]).length;
          return (
            <div key={i} className="mf-card" style={{ padding: 10, marginBottom: 8, opacity: cell.leftover ? 0.85 : 1, borderStyle: cell.leftover ? 'dashed' : 'solid' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 36, height: 36, borderRadius: 5, background: `linear-gradient(135deg, ${r.palette[0]}, ${r.palette[1]})`, position: 'relative', flexShrink: 0 }}><FoodGlyph kind={r.glyph} size={26} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>{cell.day} · {cell.slot}</div>
                  <div className="mf-display" style={{ fontSize: 18, lineHeight: 1 }}>{r.title}</div>
                  {cell.leftover && <div className="mf-mono" style={{ color: 'var(--sage)', fontSize: 9 }}>↩ leftovers from Mon dinner</div>}
                  {cell.detail && !cell.leftover && <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{cell.detail}</div>}
                </div>
              </div>
              {!cell.leftover && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>FOR</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {members.map(m => {
                      const out = (cell.out || []).includes(m.id);
                      return (
                        <span key={m.id} style={{ position: 'relative', display: 'inline-block' }}>
                          <MemberDot m={m} size={20} ring dim={out} />
                          {out && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--terracotta-deep)', fontWeight: 900, fontSize: 22, lineHeight: 1 }}>/</span>}
                        </span>
                      );
                    })}
                  </div>
                  <span className="mf-mono" style={{ color: eating < total ? 'var(--terracotta)' : 'var(--ink-3)', fontSize: 9, marginLeft: 'auto' }}>{eating} of {total}</span>
                  {cell.cook && byId[cell.cook] && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px 2px 3px', borderRadius: 999, background: 'var(--ink)', color: 'var(--paper)', fontFamily: 'JetBrains Mono', fontSize: 9 }}>
                      <MemberDot m={byId[cell.cook]} size={14} /> cooks
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <TabBar active="planning" />
    </Phone>
  );
}

window.MobileHouseholdSetup = MobileHouseholdSetup;
window.MobileHouseholdSettings = MobileHouseholdSettings;
window.MobilePantryShared = MobilePantryShared;
window.MobileShoppingShared = MobileShoppingShared;

// ──────────────────────────────────────────────────────────────
// LEFTOVER SUGGESTIONS — planning-time prompt + freezer outcome
// Shows three beats: (1) prompt during meal planning, (2) what
// lands in the SHARED freezer (no owner — anyone can take it),
// (3) those leftovers offered as next week's plan fillers.
// ──────────────────────────────────────────────────────────────
function HouseholdLeftoverSuggestion() {
  const t = useHH();
  const members = getMembers(t.householdSize);
  const byId = Object.fromEntries(members.map(m => [m.id, m]));

  return (
    <div className="mf mf-page">
      <Nav active="planning" />

      <div style={{ padding: '24px 48px 6px' }}>
        <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>HOUSEHOLD · LEFTOVERS</div>
        <h1 className="mf-display" style={{ fontSize: 50, margin: '4px 0 0' }}>
          cook a bit more, <span style={{ color: 'var(--terracotta)' }}>eat next week.</span>
        </h1>
        <div className="mf-body" style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 4, maxWidth: 760 }}>
          When a meal is for fewer people than the recipe serves, we ask once. Leftovers land in the shared freezer — anyone can grab them for any future meal.
        </div>
      </div>

      <div style={{ padding: '20px 48px 32px', display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 16 }}>
        {/* 1 · PLANNING-TIME PROMPT */}
        <div className="mf-card" style={{ padding: 16, borderLeft: '3px solid var(--terracotta)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--terracotta)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Caveat', fontWeight: 700, fontSize: 15 }}>1</span>
            <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>WHEN YOU PLAN A MEAL FOR FEWER PEOPLE</span>
          </div>

          <div style={{ marginTop: 10, padding: 12, background: 'var(--paper-warm)', borderRadius: 10, border: '1px solid var(--line-strong)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 34, height: 34, borderRadius: 5, background: 'linear-gradient(135deg, #E2A040, #8B4A1E)', position: 'relative' }}><FoodGlyph kind="tortilla" size={24} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mf-display" style={{ fontSize: 18, lineHeight: 1 }}>Quesadillas · Tue dinner</div>
                <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>recipe serves 4 · cooking for 2</div>
              </div>
              <span className="mf-mono" style={{ color: 'var(--terracotta-deep)', fontSize: 9, padding: '1px 6px', background: 'rgba(200,105,60,0.10)', borderRadius: 999 }}>−2 ENV.</span>
            </div>

            <div style={{ marginTop: 12, fontFamily: 'Caveat', fontSize: 22, color: 'var(--ink)', lineHeight: 1.05 }}>
              cook the <span style={{ color: 'var(--terracotta)' }}>full recipe</span> and stash <span style={{ color: 'var(--terracotta)' }}>2 portions</span> in the shared freezer?
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                ['⊕', 'scale up + freeze 2',  'cook for 4 · freeze 2 · eat-by ~14 days', true],
                ['⌃', 'smaller batch',         'scale ingredients down; no leftovers', false],
                ['→', 'leave as is',           'serve 2 · no extra; shopping unchanged', false],
              ].map(([ic, k, sub, on]) => (
                <label key={k} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid ' + (on ? 'var(--terracotta)' : 'var(--line)'), background: on ? 'rgba(200,105,60,0.06)' : 'transparent', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid var(--ink)', background: on ? 'var(--terracotta)' : 'transparent', flexShrink: 0, marginTop: 2 }}></span>
                  <span style={{ fontFamily: 'Caveat', fontSize: 18, color: 'var(--terracotta-deep)', lineHeight: 1 }}>{ic}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'Kalam', fontSize: 13, fontWeight: 700, lineHeight: 1.1 }}>{k}</div>
                    <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{sub}</div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(143,166,119,0.10)', borderRadius: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
              ingredients scale to <b>4 servings</b> · shopping list updates · <b>only asked once</b> per meal.
            </div>
          </div>

          <div className="mf-mono" style={{ color: 'var(--ink-3)', marginTop: 10 }}>WHEN THIS PROMPT APPEARS</div>
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3, fontFamily: 'Kalam', fontSize: 12, color: 'var(--ink-2)' }}>
            <div>· "cooking for" is set below recipe-serves</div>
            <div>· someone opted out late and you over-cooked</div>
            <div>· split-meal session left another session short</div>
          </div>
        </div>

        {/* 2 · INTO THE SHARED FREEZER */}
        <div className="mf-card" style={{ padding: 16, borderLeft: '3px solid var(--sage)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--sage)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Caveat', fontWeight: 700, fontSize: 15 }}>2</span>
            <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>LANDS IN THE SHARED FREEZER</span>
          </div>
          <div className="mf-mono" style={{ color: 'var(--ink-3)', marginTop: 2 }}>no owner · anyone in the household can grab them</div>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { name: 'Quesadillas · Tue dinner', cook: 'r', portions: 2, eatBy: 14, palette: ['#E2A040','#8B4A1E'], glyph: 'tortilla' },
              { name: 'Chorizo Pasta Bake',        cook: 'e', portions: 2, eatBy: 5,  palette: ['#D67C42','#7E2D1F'], glyph: 'pasta' },
              { name: 'Slow Cooker Mexican',       cook: 'j', portions: 4, eatBy: 11, palette: ['#B5462E','#5C1A0F'], glyph: 'pot' },
            ].map((p, i) => {
              const m = byId[p.cook];
              return (
                <div key={i} className="mf-card" style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 36, height: 36, borderRadius: 5, background: `linear-gradient(135deg, ${p.palette[0]}, ${p.palette[1]})`, position: 'relative', flexShrink: 0 }}><FoodGlyph kind={p.glyph} size={26} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mf-display" style={{ fontSize: 16, lineHeight: 1 }}>{p.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-3)' }}>
                        cooked by {m && <MemberDot m={m} size={12} ring />} {m && m.name}
                      </span>
                      <span style={{ width: 3, height: 3, borderRadius: 3, background: 'var(--ink-4)' }}></span>
                      <span className="mf-mono" style={{ color: p.eatBy <= 5 ? 'var(--terracotta)' : 'var(--ink-3)', fontSize: 9 }}>
                        {p.portions} portions · {p.eatBy}d
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(143,166,119,0.10)', borderRadius: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
            cooked-by stays on the label as <b>provenance</b>, not as a claim — anyone takes a portion when they want one. Activity feed logs each pull.
          </div>
        </div>

        {/* 3 · FUTURE USE — anyone, any slot */}
        <div className="mf-card" style={{ padding: 16, borderLeft: '3px solid var(--butter)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--butter)', color: 'var(--terracotta-deep)', border: '1.5px solid var(--terracotta-deep)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Caveat', fontWeight: 700, fontSize: 15 }}>3</span>
            <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>OFFERED AS PLAN FILLERS</span>
          </div>
          <div className="mf-mono" style={{ color: 'var(--ink-3)', marginTop: 2 }}>upcoming slots that could be filled from the freezer</div>

          <div style={{ marginTop: 12, padding: 10, background: 'var(--paper-warm)', borderRadius: 8 }}>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>EATING FROM FREEZER · TAP TO FILL</div>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                ['Thu · lunch',   'Quesadillas',         'tortilla', ['#E2A040','#8B4A1E'], 'fits everyone'],
                ['Fri · lunch',   'Chorizo Pasta Bake',  'pasta',    ['#D67C42','#7E2D1F'], 'eat-by 3d ⏳'],
                ['Sat · lunch',   'Slow Cooker Mexican', 'pot',      ['#B5462E','#5C1A0F'], 'fits everyone'],
                ['Sun · lunch',   'Quesadillas',         'tortilla', ['#E2A040','#8B4A1E'], '2nd portion'],
              ].map(([slot, name, glyph, palette, hint], i) => (
                <div key={i} className="mf-card" style={{ padding: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 4, background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`, position: 'relative', flexShrink: 0 }}><FoodGlyph kind={glyph} size={18} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>{slot}</span>
                      <span style={{ fontFamily: 'Kalam', fontSize: 12 }}>{name}</span>
                    </div>
                    <div className="mf-mono" style={{ color: hint.includes('⏳') ? 'var(--terracotta)' : 'var(--ink-3)', fontSize: 9 }}>{hint}</div>
                  </div>
                  <button className="mf-btn ghost sm" style={{ fontSize: 10, padding: '2px 8px' }}>fill →</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(245,199,100,0.10)', border: '1px dashed var(--butter)', borderRadius: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
            urgency-sorted — items closer to <b>eat-by</b> are surfaced first; the meal-plan picker also nudges these when a slot is empty.
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="mf-mono" style={{ color: 'var(--ink-3)' }}>SAVES YOU FROM</div>
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'Kalam', fontSize: 12, color: 'var(--ink-2)' }}>
              <div>· 4 extra meals' shopping</div>
              <div>· 4 cooking sessions</div>
              <div>· freezer-clearout regret</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.HouseholdLeftoverSuggestion = HouseholdLeftoverSuggestion;

// ──────────────────────────────────────────────────────────────
// "Cooking for" card — cook picks who it's for, then optional swaps
// for outliers. This is the committed model (B+C combined).
// Tue dinner = Quesadillas. Nana out (no chilli). Ellie: chicken→tofu swap.
// ──────────────────────────────────────────────────────────────
function DietModelMealCard({ members, t }) {
  return (
    <div className="mf-card" style={{ padding: 14, position: 'relative', borderColor: 'var(--ink)', borderWidth: 1.5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>COOKING FOR · TUE DINNER</div>
        <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>cook picks → optional swaps</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 5, background: 'linear-gradient(135deg, #E2A040, #8B4A1E)', position: 'relative' }}><FoodGlyph kind="tortilla" size={20} /></span>
        <div style={{ flex: 1 }}>
          <div className="mf-display" style={{ fontSize: 18, lineHeight: 1 }}>Quesadillas</div>
          <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>chicken · tortillas · cheese · chilli · peppers</div>
        </div>
      </div>
      <DMCookPicks members={members} />
    </div>
  );
}
function DMCookPicks({ members }) {
  const [swapsOpen, setSwapsOpen] = React.useState(true);
  return (
    <React.Fragment>
      <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 10 }}>COOKING FOR · 3 OF {members.length}</div>
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {members.map((m, i) => {
          const optedOut = i === 3; // Nana out (no chilli)
          const reason = i === 3 ? 'no chilli' : null;
          return (
            <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Kalam', fontSize: 12.5, padding: '3px 6px', borderRadius: 6, background: optedOut ? 'rgba(200,105,60,0.06)' : 'transparent' }}>
              <Checkbox on={!optedOut} />
              <MemberDot m={m} size={18} ring you={m.you} />
              <span style={{ flex: 1, color: optedOut ? 'var(--ink-3)' : 'var(--ink)', textDecoration: optedOut ? 'line-through' : 'none' }}>{m.name}</span>
              {reason && <span className="mf-mono" style={{ color: 'var(--terracotta-deep)', fontSize: 9 }}>{reason.toUpperCase()}</span>}
            </label>
          );
        })}
      </div>

      {/* swaps — folds open for outliers within the 'for' subset */}
      <div style={{ marginTop: 10, padding: '6px 8px 8px', background: 'rgba(245,199,100,0.10)', borderRadius: 6, border: '1px dashed var(--butter)' }}>
        <div onClick={() => setSwapsOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>SWAPS FOR OUTLIERS · OPTIONAL</span>
          <span className="mf-mono" style={{ color: 'var(--ink-3)', marginLeft: 'auto' }}>{swapsOpen ? '▴' : '▾'}</span>
        </div>
        {swapsOpen && (
          <React.Fragment>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                { m: members[1], from: 'chicken', to: 'tofu chunks', why: 'protein swap' },
              ].filter(s => s.m).map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontFamily: 'Kalam', fontSize: 11.5 }}>
                  <MemberDot m={s.m} size={16} ring />
                  <span style={{ color: 'var(--ink-3)', textDecoration: 'line-through' }}>{s.from}</span>
                  <span style={{ color: 'var(--ink-3)' }}>→</span>
                  <span style={{ color: 'var(--terracotta-deep)', fontWeight: 700 }}>{s.to}</span>
                  <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9, marginLeft: 'auto' }}>{s.why}</span>
                  <span style={{ cursor: 'pointer', color: 'var(--ink-3)', fontSize: 11 }}>×</span>
                </div>
              ))}
              <span className="mf-tag" style={{ fontSize: 10, borderStyle: 'dashed', color: 'var(--terracotta)', alignSelf: 'flex-start' }}>＋ swap for someone</span>
            </div>
            <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9, marginTop: 6 }}>most meals don't need this — skip unless one person diverges.</div>
          </React.Fragment>
        )}
      </div>

      <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 10 }}>WHO'S COOKING · OPTIONAL</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
        {members.map(m => (
          <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px 2px 3px', borderRadius: 999, border: '1px solid ' + (m.you ? 'var(--ink)' : 'var(--line-strong)'), background: m.you ? 'var(--ink)' : 'var(--card)', color: m.you ? 'var(--paper)' : 'var(--ink)', cursor: 'pointer' }}>
            <MemberDot m={m} size={14} />
            <span style={{ fontFamily: 'Kalam', fontSize: 11 }}>{m.initial}</span>
          </span>
        ))}
        <span className="mf-tag soft" style={{ fontSize: 10 }}>unassigned</span>
      </div>
      <div style={{ marginTop: 10, padding: '6px 8px', background: 'rgba(143,166,119,0.10)', borderRadius: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
        scales to <b>3 servings</b> · shopping adds <b>200g tofu</b> · Robbie gets a "you're cooking Tue" nudge.
      </div>
    </React.Fragment>
  );
}

window.DietModelMealCard = DietModelMealCard;

// ──────────────────────────────────────────────────────────────
// MOBILE: detailed activity feed
// ──────────────────────────────────────────────────────────────
function MobileHouseholdActivity() {
  const t = useHH();
  const [surface, setSurface] = React.useState(null);
  const members = getMembers(t.householdSize);
  const filters = [
    [null, 'all'], ['pantry', '🧂'], ['plan', '📅'], ['shop', '🛒'], ['cook', '🍴'], ['freezer', '❄️'],
  ];
  return (
    <Phone>
      <div style={{ padding: '8px 18px 10px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>HOUSEHOLD · ACTIVITY</div>
            <h2 className="mf-display" style={{ fontSize: 26, margin: '2px 0 0', lineHeight: 1 }}>what's <span style={{ color: 'var(--terracotta)' }}>happening?</span></h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MemberStack members={members} size={20} max={4} overlap={6} />
            <MobileAvatar />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 8, overflowX: 'auto' }}>
          {filters.map(([k, l]) => (
            <span key={String(k)} onClick={() => setSurface(k)} className={'mf-tag ' + (surface === k ? 'include' : '')} style={{ fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>{l}</span>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px 12px' }}>
        <ActivityFeed density="full" surface={surface} />
      </div>
      <div style={{ padding: '8px 18px 10px', borderTop: '1px solid var(--line)', background: 'var(--paper-warm)' }}>
        <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>THIS WEEK</div>
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {members.slice(0, 3).map((m, i) => {
            const counts = [{ flips: 12, cooks: 2, opts: 0 }, { flips: 8, cooks: 1, opts: 1 }, { flips: 3, cooks: 0, opts: 3 }][i];
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MemberDot m={m} size={18} ring you={m.you} />
                <span style={{ flex: 1, fontFamily: 'Kalam', fontSize: 12 }}>{m.name}</span>
                <span style={{ fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
                  <b>{counts.flips}</b> <span className="mf-mono" style={{ color: 'var(--ink-4)' }}>flips</span> · <b>{counts.cooks}</b> <span className="mf-mono" style={{ color: 'var(--ink-4)' }}>cooked</span>
                  {counts.opts > 0 && <span style={{ color: 'var(--terracotta-deep)' }}> · <b>{counts.opts}</b> <span className="mf-mono">out</span></span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <TabBar active={null} />
    </Phone>
  );
}
window.MobileHouseholdActivity = MobileHouseholdActivity;

// ──────────────────────────────────────────────────────────────
// ACTIVITY FEED — full detail artboard
// ──────────────────────────────────────────────────────────────
function HouseholdActivity() {
  const t = useHH();
  const members = getMembers(t.householdSize);
  const [surface, setSurface] = React.useState(null);
  const filters = [
    [null, 'everything'],
    ['pantry', '🧂 pantry'],
    ['freezer', '❄️ freezer'],
    ['plan', '📅 plan'],
    ['shop', '🛒 shopping'],
    ['cook', '🍴 cooking'],
    ['diet', '🥗 diet'],
  ];
  return (
    <div className="mf mf-page">
      <Nav active={null} />
      <div style={{ padding: '28px 48px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>HOUSEHOLD · ACTIVITY</div>
          <h1 className="mf-display" style={{ fontSize: 48, margin: '4px 0 0' }}>what's been <span style={{ color: 'var(--terracotta)' }}>happening?</span></h1>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {filters.map(([k, l]) => (
            <span key={String(k)} onClick={() => setSurface(k)} className={'mf-tag ' + (surface === k ? 'include' : '')} style={{ fontSize: 11, cursor: 'pointer' }}>{l}</span>
          ))}
        </div>
      </div>

      <div style={{ padding: '18px 48px 40px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        <div className="mf-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>
              {surface ? `FILTERED · ${surface.toUpperCase()}` : 'ALL EVENTS · NEWEST FIRST'}
            </div>
            {surface && <span onClick={() => setSurface(null)} className="mf-mono" style={{ color: 'var(--ink-3)', cursor: 'pointer' }}>clear ×</span>}
          </div>
          <ActivityFeed density="full" surface={surface} />
        </div>

        <div>
          <div className="mf-card" style={{ padding: 14 }}>
            <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>NOTIFY ME WHEN</span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['someone flips a pantry item', false],
                ['someone opts out of my cook',  true],
                ['someone claims a meal I had',  true],
                ['food in the freezer expires',  true],
                ['shopping list updated',         false],
                ['timer finished while away',     true],
              ].map(([k, on]) => (
                <div key={k} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontFamily: 'Kalam', fontSize: 13 }}>{k}</span>
                  <Switch on={on} small />
                </div>
              ))}
            </div>
          </div>
          <div className="mf-card" style={{ padding: 14, marginTop: 14 }}>
            <span className="mf-mono" style={{ color: 'var(--terracotta)' }}>THIS WEEK · BY PERSON</span>
            <div className="mf-mono" style={{ color: 'var(--ink-3)', marginTop: 2 }}>pantry & freezer flips · meals cooked · meals opted out of</div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {members.map((m, i) => {
                const counts = [{ flips: 12, cooks: 2, opts: 0 }, { flips: 8, cooks: 1, opts: 1 }, { flips: 3, cooks: 0, opts: 3 }, { flips: 1, cooks: 0, opts: 0 }, { flips: 4, cooks: 1, opts: 0 }, { flips: 2, cooks: 0, opts: 1 }][i] || { flips: 0, cooks: 0, opts: 0 };
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }} data-comment-anchor={i === 0 ? 'hh-activity-by-person-row' : undefined}>
                    <MemberDot m={m} size={22} ring you={m.you} />
                    <span style={{ flex: 1, fontFamily: 'Kalam', fontSize: 13 }}>{m.name}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'Kalam', fontSize: 12, color: 'var(--ink-2)' }}>
                      <span title="pantry & freezer flips this week" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ color: 'var(--ink-3)' }}>🧂</span>
                        <b>{counts.flips}</b>
                        <span className="mf-mono" style={{ color: 'var(--ink-4)' }}>flips</span>
                      </span>
                      <span title="meals cooked this week" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ color: 'var(--ink-3)' }}>🍴</span>
                        <b>{counts.cooks}</b>
                        <span className="mf-mono" style={{ color: 'var(--ink-4)' }}>cooked</span>
                      </span>
                      <span title="meals opted out of this week" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: counts.opts > 0 ? 'var(--terracotta-deep)' : 'var(--ink-2)' }}>
                        <span style={{ color: counts.opts > 0 ? 'var(--terracotta-deep)' : 'var(--ink-3)' }}>⊘</span>
                        <b>{counts.opts}</b>
                        <span className="mf-mono" style={{ color: counts.opts > 0 ? 'var(--terracotta-deep)' : 'var(--ink-4)' }}>opt-outs</span>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
window.HouseholdActivity = HouseholdActivity;
