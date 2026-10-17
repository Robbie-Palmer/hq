// mid-fi/mobile.jsx — mobile artboards for every main page.
// Reuses the existing desktop data (RECIPES, INGREDIENTS, STEPS) and components.

function Phone({ children, dark }) {
  return (
    <div style={{ background: dark ? '#1a1410' : '#2a2520', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '14px 0' }}>
      <div style={{ width: 360, height: 760, background: '#000', borderRadius: 36, padding: 8, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
        <div className="mf" style={{ width: '100%', height: '100%', borderRadius: 28, overflow: 'hidden', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>
          {/* notch / status bar */}
          <div style={{ padding: '12px 22px 6px', display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--ink-2)', flexShrink: 0 }}>
            <span>9:41</span><span>●●●</span><span>100%</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {children}
          </div>
        </div>
      </div>
    </div>);

}

function TabBar({ active = 'recipes' }) {
  const tabs = [['recipes', '▤', 'Recipes'], ['planning', '□', 'Plan'], ['shop', '✓', 'Shop'], ['kitchen', '⌂', 'Kitchen'], ['more', '•••', 'More']];
  const normalized = active === 'shopping' ? 'shop' : active;
  const moreActive = ['discover', 'cookbooks', 'scan', 'profile', 'settings', 'log', null].includes(normalized);
  return (
    <div style={{ padding: '8px 14px 14px', borderTop: '1px solid var(--line)', background: 'var(--card)', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
      {tabs.map(([k, e, l]) => {
        const selected = k === 'more' ? moreActive : normalized === k;
        return <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontFamily: 'Kalam', fontSize: 10, color: selected ? 'var(--terracotta)' : 'var(--ink-3)', fontWeight: selected ? 700 : 400, flex: 1, position: 'relative' }}>
          <span style={{ font: k === 'more' ? '700 12px JetBrains Mono' : '18px Caveat' }}>{e}</span>
          <span>{l}</span>
          {k === 'shop' && <span style={{ position: 'absolute', top: -3, left: '57%', minWidth: 14, height: 14, padding: '0 3px', borderRadius: 99, background: 'var(--terracotta)', color: 'white', font: '8px JetBrains Mono', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>12</span>}
        </div>;
      })}
    </div>);

}

// Small profile avatar — sits in the top-right of every mobile page header.
function MobileAvatar({ size = 28 }) {
  return (
    <div title="open your profile" style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--butter)', border: '1.5px solid var(--ink)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Caveat', fontWeight: 700, fontSize: size * 0.55,
      color: 'var(--terracotta-deep)', cursor: 'pointer', flexShrink: 0
    }}>R</div>);

}

// ─────────── List ──────────────────────────────────────────────
function MobileList() {
  const [filters, setFilters] = React.useState({ italian: 'include', chinese: 'exclude', egg: 'exclude', quick: 'include' });
  const [filterSheet, setFilterSheet] = React.useState(false);
  const cycle = (k) => setFilters((f) => {
    const cur = f[k] || 'off';
    return { ...f, [k]: cur === 'off' ? 'include' : cur === 'include' ? 'exclude' : 'off' };
  });
  const filterGroups = [
  { label: 'cuisine', items: ['italian', 'mexican', 'chinese', 'british', 'cajun'] },
  { label: 'ingredient', items: ['chicken', 'egg', 'dairy', 'gluten', 'peanut'] },
  { label: 'equipment', items: ['oven', 'slow cooker', 'blender'] },
  { label: 'time', items: ['quick', 'under 30m'] },
  { label: 'tag', items: ['one-pot', 'sweet', 'savoury', 'dinner', 'lunch'] }];

  const activeFilters = Object.entries(filters).filter(([, v]) => v !== 'off');
  const activeCount = activeFilters.length;

  return (
    <Phone>
      {/* sticky header */}
      <div style={{ padding: '6px 18px 10px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>RECIPE BOX</div>
            <h2 className="mf-display" style={{ fontSize: 30, margin: '2px 0 0', lineHeight: 1 }}>what's cooking, <span style={{ color: 'var(--terracotta)' }}>R?</span></h2>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="mf-btn ghost sm" style={{ padding: '4px 6px', fontSize: 14 }} title="add a recipe">＋</button>
            <button className="mf-btn butter sm" style={{ padding: '4px 6px', fontSize: 14 }} title="scan a recipe">📷</button>
            <MobileAvatar />
          </div>
        </div>

        {/* diet banner — matches desktop */}
        <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(143,166,119,0.12)', border: '1px dashed var(--sage)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Kalam', fontSize: 11 }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--sage)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 10 }}>🥗</span>
          <span style={{ flex: 1, color: 'var(--ink-2)' }}><b>diet</b> · veggie, no egg <span style={{ color: 'var(--ink-3)' }}>(–16)</span></span>
          <span className="mf-mono" style={{ color: 'var(--sage)' }}>edit</span>
        </div>

        {/* search + filter trigger */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <div className="mf-search" style={{ padding: '6px 12px', flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--ink-3)' }}>⌕</span>
            <input placeholder="find a recipe…" style={{ fontSize: 13 }} />
          </div>
          <button onClick={() => setFilterSheet(true)} className={'mf-btn ' + (activeCount ? 'primary' : '')} style={{ padding: '6px 10px', fontSize: 12 }}>
            ⚲ filters{activeCount > 0 && <span style={{ marginLeft: 4, padding: '0 5px', background: activeCount ? 'var(--butter)' : 'var(--ink-4)', color: 'var(--ink)', borderRadius: 999, fontSize: 10 }}>{activeCount}</span>}
          </button>
        </div>

        {/* active filter strip — appears when there are any */}
        {activeCount > 0 &&
        <div style={{ display: 'flex', gap: 4, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {activeFilters.map(([k, v]) =>
          <span key={k} className={'mf-tag ' + (v === 'include' ? 'include' : 'exclude')} onClick={() => cycle(k)} style={{ fontSize: 11, flexShrink: 0 }}>
                {v === 'exclude' && '⊘'}{k} <span style={{ marginLeft: 4, opacity: 0.6 }}>×</span>
              </span>
          )}
            <span onClick={() => setFilters({})} className="mf-tag" style={{ fontSize: 10, color: 'var(--ink-3)', borderStyle: 'dashed', flexShrink: 0 }}>clear</span>
          </div>
        }
      </div>

      {/* feed */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
        <div className="mf-mono" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>14 RECIPES MATCH</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {RECIPES.slice(0, 8).map((r) =>
          <div key={r.id} className="mf-card">
              <FoodPhoto palette={r.palette} glyph={r.glyph} style={{ height: 100 }} />
              <div style={{ padding: '6px 8px 8px' }}>
                <div className="mf-display" style={{ fontSize: 17, lineHeight: 1.05 }}>{r.title}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                  <span className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>{r.cuisine.toLowerCase()}</span>
                  <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{r.total}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* filter bottom-sheet */}
      {filterSheet &&
      <React.Fragment>
          <div onClick={() => setFilterSheet(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 2 }}></div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', background: 'var(--paper)', borderTopLeftRadius: 22, borderTopRightRadius: 22, boxShadow: '0 -8px 24px rgba(0,0,0,0.2)', zIndex: 3, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 0 4px' }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--ink-4)', margin: '0 auto' }}></div>
            </div>
            <div style={{ padding: '4px 18px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 className="mf-display" style={{ fontSize: 22, margin: 0 }}>filters</h3>
              <span onClick={() => setFilters({})} className="mf-mono" style={{ color: 'var(--terracotta)', cursor: 'pointer' }}>clear all</span>
            </div>
            <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 10, padding: '0 18px 8px' }}>tap once to include · twice to avoid · third to clear</div>

            <div style={{ flex: 1, overflow: 'auto', padding: '0 18px 12px' }}>
              {filterGroups.map((g) =>
            <div key={g.label} style={{ marginBottom: 14 }}>
                  <div className="mf-mono" style={{ color: 'var(--terracotta)', marginBottom: 4 }}>{g.label.toUpperCase()}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {g.items.map((i) => {
                  const st = filters[i] || 'off';
                  return (
                    <span key={i} className={'mf-tag ' + (st === 'include' ? 'include' : st === 'exclude' ? 'exclude' : '')} onClick={() => cycle(i)} style={{ fontSize: 12 }}>
                          {st === 'exclude' && '⊘'}{i}
                        </span>);

                })}
                  </div>
                </div>
            )}
            </div>

            <div style={{ padding: '10px 18px 18px', borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
              <button onClick={() => setFilterSheet(false)} className="mf-btn primary" style={{ width: '100%', padding: 12, fontSize: 15, borderRadius: 12 }}>show 14 recipes</button>
            </div>
          </div>
        </React.Fragment>
      }
      <TabBar active="recipes" />
    </Phone>);

}

// ─────────── Recipe page · read + cooking sub-mode ─────────────
function MobileRecipe() {
  const [cooking, setCooking] = React.useState(false);
  return cooking ? <MobileRecipeCook onExit={() => setCooking(false)} /> : <MobileRecipeRead onCook={() => setCooking(true)} />;
}

function MobileRecipeRead({ onCook }) {
  const r = RECIPES[0];
  return (
    <Phone>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <FoodPhoto palette={r.palette} glyph={r.glyph} style={{ height: 200 }} big />
        <div style={{ padding: '14px 18px 90px' }}>
          <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>← Italian · Dinner · V1.2 BY ROBBIE</div>
          <h1 className="mf-display" style={{ fontSize: 32, margin: '4px 0 0', lineHeight: 0.95 }}>
            Chicken & Chorizo<br />
            <span style={{ color: 'var(--terracotta)' }}>Pasta Bake.</span>
          </h1>

          {/* lineage chip — mobile */}
          <div style={{ marginTop: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
            <span style={{ color: 'var(--ink-3)' }}>via </span>
            <b>Mum</b>
            <span style={{ color: 'var(--ink-3)' }}> ← </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 5px 0 3px', borderRadius: 999, background: 'var(--paper-warm)', border: '1px solid var(--line-strong)', fontSize: 10 }}>🌐 BBC Good Food</span>
            <span style={{ marginLeft: 6, color: 'var(--terracotta)', cursor: 'pointer' }}>tree →</span>
          </div>

          <p className="mf-body" style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0' }}>
            Creamy with a smoky edge from the chorizo. Sunday-night staple.
          </p>

          {/* honest signal — compact line */}
          <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(143,166,119,0.08)', border: '1px solid var(--line)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Kalam', fontSize: 11, flexWrap: 'wrap' }}>
            <span className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>SIGNAL</span>
            <span><b>341</b> cooks</span>
            <span style={{ color: 'var(--ink-3)' }}>·</span>
            <span><b style={{ color: 'var(--terracotta)' }}>62%</b> repeat</span>
            <span style={{ color: 'var(--ink-3)' }}>·</span>
            <span style={{ color: 'var(--sage)' }}>📈 <b>+24</b> wk</span>
            <span style={{ color: 'var(--ink-3)' }}>·</span>
            <span><b>8</b> forks</span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="mf-tag include" style={{ fontSize: 10 }}>italian</span>
            <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>⏱ 55m</span>
            <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>· serves 4</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className="mf-btn ghost sm" style={{ fontSize: 11, padding: '4px 8px' }}>🌱 fork</button>
              <button className="mf-btn ghost sm" style={{ fontSize: 11, padding: '4px 8px' }}>↗ fix</button>
            </span>
          </div>
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--card)', border: '1px solid var(--line-strong)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'Kalam', fontSize: 13, color: 'var(--ink-2)' }}>serves</span>
            <button className="mf-btn sm" style={{ padding: '0 8px' }}>−</button>
            <span className="mf-display" style={{ fontSize: 22, color: 'var(--terracotta)' }}>4</span>
            <button className="mf-btn sm" style={{ padding: '0 8px' }}>＋</button>
          </div>

          <h2 className="mf-display" style={{ fontSize: 22, color: 'var(--terracotta)', margin: '18px 0 4px' }}>Ingredients</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {INGREDIENTS.map((ing, i) =>
            <li key={i} style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)', display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'Kalam', fontSize: 13 }}>
                <span className="mf-check"></span>{ing}
              </li>
            )}
          </ul>

          <h2 className="mf-display" style={{ fontSize: 22, color: 'var(--terracotta)', margin: '18px 0 4px' }}>Method</h2>
          {STEPS.slice(0, 3).map((s, i) =>
          <div key={i} style={{ padding: '8px 0', borderBottom: '1px dashed var(--line)', display: 'flex', gap: 10 }}>
              <span className="mf-display" style={{ fontSize: 22, color: 'var(--terracotta)', minWidth: 22 }}>{i + 1}.</span>
              <div style={{ flex: 1 }}>
                <div className="mf-body" style={{ fontSize: 13 }}>{s.text}</div>
                {s.timer && <span className="mf-tag" style={{ marginTop: 4, fontSize: 10, background: 'var(--butter-soft)' }}>⏱ {s.timer} min</span>}
              </div>
            </div>
          )}
          <div className="mf-mono" style={{ color: 'var(--ink-3)', textAlign: 'center', marginTop: 8 }}>+ 4 more steps…</div>

          {/* Forks downstream — compact card */}
          <div className="mf-card" style={{ padding: 10, marginTop: 14 }}>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>FORKS DOWNSTREAM · 8 BRANCHES</div>
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                { name: 'Halloumi Pasta Bake', who: 'Ellie', diff: 'chicken → halloumi' },
                { name: 'Low-FODMAP Bake',    who: 'Jamie', diff: 'garlic → garlic oil' },
              ].map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--terracotta)' }}></span>
                  <span style={{ flex: 1, fontFamily: 'Kalam', fontSize: 12 }}>{f.name} <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>· {f.who}</span></span>
                  <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9, fontStyle: 'italic' }}>{f.diff}</span>
                </div>
              ))}
            </div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 4, fontSize: 9, cursor: 'pointer' }}>see all 8 + tree →</div>
          </div>
        </div>
      </div>
      {/* floating CTA */}
      <div style={{ position: 'absolute', bottom: 60, left: 0, right: 0, padding: '0 18px', pointerEvents: 'none' }}>
        <button onClick={onCook} className="mf-btn terra" style={{ width: '100%', padding: '12px', fontSize: 16, borderRadius: 14, pointerEvents: 'auto', boxShadow: 'var(--shadow)' }} data-comment-anchor="8ea667c21e-button-151-9">🔥 start cooking →</button>
      </div>
      <TabBar active="recipes" />
    </Phone>);

}

function MobileRecipeCook({ onExit }) {
  const [step, setStep] = React.useState(4);
  const [secs, setSecs] = React.useState(9 * 60 + 42);
  const [running, setRunning] = React.useState(true);
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);
  const m = String(Math.floor(secs / 60)).padStart(2, '0'),ss = String(secs % 60).padStart(2, '0');
  const cur = STEPS[step];
  return (
    <Phone>
      {/* top bar */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-strong)', background: 'var(--butter-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="mf-btn ghost sm" onClick={onExit} style={{ padding: '2px 8px' }}>← exit</button>
        <span className="mf-display" style={{ fontSize: 16, flex: 1, color: 'var(--terracotta-deep)' }}>Chorizo Pasta Bake</span>
        <span className="mf-mono" style={{ fontSize: 9, color: 'var(--ink-3)' }}>👁</span>
        <span className="mf-mono" style={{ fontSize: 9, color: 'var(--ink-3)' }}>📺</span>
      </div>

      {/* main — swipeable step */}
      <div style={{ flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'auto' }}>
        <div>
          <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 10 }}>STEP {String(step + 1).padStart(2, '0')} OF {STEPS.length}</div>
          <h1 className="mf-display" style={{ fontSize: 30, margin: '8px 0 0', lineHeight: 1.05 }}>{cur.text}</h1>

          {cur.timer &&
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 130, height: 130, borderRadius: '50%', background: running ? 'var(--butter)' : 'var(--card)', border: '3px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="mf-display" style={{ fontSize: 38 }}>{m}:{ss}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="mf-btn sm" onClick={() => setRunning((r) => !r)}>{running ? 'pause' : 'resume'}</button>
                <button className="mf-btn sm" onClick={() => setSecs((s) => s + 60)}>+1m</button>
                <button className="mf-btn sm" onClick={() => setSecs(cur.timer * 60)}>reset</button>
              </div>
            </div>
          }
        </div>

        <div>
          <div className="mf-mono" style={{ textAlign: 'center', color: 'var(--ink-3)', marginBottom: 6 }}>‹— swipe between steps —›</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {STEPS.map((_, i) =>
            <div key={i} onClick={() => setStep(i)} style={{ flex: 1, height: i === step ? 8 : 4, borderRadius: 3, background: i < step ? 'var(--terracotta)' : i === step ? 'var(--butter)' : 'var(--ink-4)', cursor: 'pointer' }}></div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="mf-btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} style={{ flex: 1 }}>← prev</button>
            <button className="mf-btn primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} style={{ flex: 1 }}>next →</button>
          </div>
        </div>
      </div>

      {/* mini multi-timer dock */}
      <div style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '8px 14px', display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-around', fontFamily: 'Kalam', fontSize: 12, flexShrink: 0 }}>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--butter)' }}>● simmer</span>
          <span className="mf-display" style={{ fontSize: 16 }}>{m}:{ss}</span>
        </span>
        <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)' }}></span>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--terracotta)' }}>● bake</span>
          <span className="mf-display" style={{ fontSize: 16 }}>17:08</span>
        </span>
        <span className="mf-mono" style={{ color: 'var(--ink-4)', fontSize: 10 }}>＋ add</span>
      </div>
    </Phone>);

}

// ─────────── Scan / add ────────────────────────────────────────
function MobileScan() {
  const [tab, setTab] = React.useState('camera');
  return (
    <Phone>
      <div style={{ padding: '8px 18px 12px', borderBottom: '1px solid var(--line)' }}>
        <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>ADD A RECIPE</div>
        <h2 className="mf-display" style={{ fontSize: 26, margin: '2px 0 0', lineHeight: 1 }}>scan, snap, or paste.</h2>
        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          {[['camera', '📷 camera'], ['url', '🔗 URL'], ['paste', '📝 text']].map(([k, l]) =>
          <span key={k} onClick={() => setTab(k)} className={'mf-tag ' + (tab === k ? 'include' : '')} style={{ fontSize: 11, flex: 1, textAlign: 'center', cursor: 'pointer' }}>{l}</span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, padding: 14, overflow: 'auto' }}>
        {tab === 'camera' &&
        <div>
            {/* viewfinder */}
            <div style={{ position: 'relative', height: 260, background: '#2a2520', borderRadius: 14, overflow: 'hidden', backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 8px, rgba(255,255,255,0.04) 8px 9px)' }}>
              {[
            { top: 18, left: 14 }, { top: 18, right: 14 },
            { bottom: 14, left: 14 }, { bottom: 14, right: 14 }].
            map((p, i) =>
            <div key={i} style={{ position: 'absolute', ...p, width: 28, height: 28,
              borderTop: i < 2 ? '3px solid var(--butter)' : 'none',
              borderBottom: i >= 2 ? '3px solid var(--butter)' : 'none',
              borderLeft: i % 2 === 0 ? '3px solid var(--butter)' : 'none',
              borderRight: i % 2 === 1 ? '3px solid var(--butter)' : 'none' }}></div>
            )}
              <div style={{ position: 'absolute', top: 14, left: 0, right: 0, textAlign: 'center', color: 'var(--butter)', fontFamily: 'JetBrains Mono', fontSize: 10 }}>● auto-detecting page</div>
              <div style={{ position: 'absolute', top: '46%', left: 0, right: 0, textAlign: 'center', color: 'var(--butter)', fontFamily: 'Caveat', fontSize: 18 }}>line up the page</div>
              {/* multi-page chip */}
              <div style={{ position: 'absolute', bottom: 50, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.6)', padding: '3px 8px', borderRadius: 12, display: 'flex', gap: 4, alignItems: 'center', color: 'var(--butter)', fontFamily: 'JetBrains Mono', fontSize: 9 }}>
                <span style={{ width: 14, height: 18, background: 'var(--butter)', borderRadius: 2 }}></span>
                <span style={{ width: 14, height: 18, background: 'var(--butter)', borderRadius: 2 }}></span>
                <span>2 pages ＋</span>
              </div>
            </div>
            {/* shutter */}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
              <div style={{ width: 38, height: 38, borderRadius: 8, border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📁</div>
              <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--butter)', border: '4px solid var(--ink)', boxShadow: '0 0 0 2px var(--butter)' }}></div>
              <div style={{ width: 38, height: 38, borderRadius: 8, border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>↻</div>
            </div>
            <div style={{ marginTop: 12, fontFamily: 'Kalam', fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', lineHeight: 1.4 }}>
              auto-crop · multi-page · works offline (parses later)
            </div>
          </div>
        }
        {tab === 'url' &&
        <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>PASTE A LINK</div>
            <div style={{ marginTop: 8, padding: 10, background: 'var(--card)', border: '1px solid var(--line-strong)', borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11 }}>
              bbcgoodfood.com/recipes/<b>chicken-chorizo…</b>
            </div>
            <button className="mf-btn primary" style={{ width: '100%', marginTop: 10 }}>fetch →</button>
            <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--paper-warm)' }}>
              <div className="mf-mono" style={{ color: 'var(--sage)', fontSize: 9 }}>● FOUND</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <FoodPhoto palette={RECIPES[0].palette} glyph={RECIPES[0].glyph} style={{ width: 60, height: 60 }} />
                <div>
                  <div className="mf-display" style={{ fontSize: 16, lineHeight: 1 }}>{RECIPES[0].title}</div>
                  <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>11 ing · 7 steps · 55m</div>
                </div>
              </div>
            </div>
            <button className="mf-btn terra" style={{ width: '100%', marginTop: 10 }}>review →</button>
          </div>
        }
        {tab === 'paste' &&
        <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>PASTE THE RECIPE</div>
            <textarea rows={10} placeholder={'Chicken & Chorizo Pasta Bake\nServes 4\n\nIngredients\n300g pasta\n…'} style={{ width: '100%', marginTop: 8, padding: 10, border: '1px solid var(--line-strong)', borderRadius: 8, fontFamily: 'Kalam', fontSize: 13, resize: 'none', boxSizing: 'border-box' }}></textarea>
            <button className="mf-btn primary" style={{ width: '100%', marginTop: 10 }}>parse →</button>
          </div>
        }

        <div style={{ marginTop: 18 }}>
          <div className="mf-mono" style={{ color: 'var(--ink-3)' }}>RECENT</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, overflowX: 'auto' }}>
            {RECIPES.slice(1, 4).map((r) =>
            <div key={r.id} className="mf-card" style={{ flex: '0 0 90px', padding: 5 }}>
                <FoodPhoto palette={r.palette} glyph={r.glyph} style={{ height: 50 }} />
                <div style={{ fontFamily: 'Kalam', fontSize: 11, marginTop: 3, lineHeight: 1.05 }}>{r.title}</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <TabBar active="scan" />
    </Phone>);

}

// ─────────── Share — half-sheet style ──────────────────────────
function MobileShare() {
  const r = RECIPES[0];
  return (
    <Phone>
      {/* dimmed page underneath */}
      <div style={{ position: 'absolute', inset: '36px 8px 8px 8px', borderRadius: '28px 28px 0 0', background: 'rgba(0,0,0,0.4)', zIndex: 0 }}></div>
      <div style={{ flex: 1, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        <div style={{ background: 'var(--paper)', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '12px 18px 22px', boxShadow: '0 -8px 24px rgba(0,0,0,0.15)', flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--ink-4)', margin: '0 auto 12px' }}></div>
          <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>SHARE</div>
          <h2 className="mf-display" style={{ fontSize: 22, margin: '2px 0 8px', lineHeight: 1 }}>{r.title}</h2>

          {/* OG preview card */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
            <FoodPhoto palette={r.palette} glyph={r.glyph} style={{ height: 110 }} big />
            <div style={{ padding: '8px 10px' }}>
              <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>ROBBIESRECIPES.COM</div>
              <div className="mf-display" style={{ fontSize: 18, marginTop: 2 }}>{r.title}</div>
              <div style={{ fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>Creamy, smoky. 55m · serves 4.</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', background: 'var(--paper-warm)', borderRadius: 10, alignItems: 'center', marginBottom: 10 }}>
            <code style={{ flex: 1, fontFamily: 'JetBrains Mono', fontSize: 11 }}>robbiesrecipes.com/r/chorizo…</code>
            <button className="mf-btn primary sm">copy</button>
          </div>

          {/* social row */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 12 }}>
            {[['💬', 'iMessage'], ['💚', 'WhatsApp'], ['📧', 'Mail'], ['📱', 'SMS'], ['⋯', 'More']].map(([e, l]) =>
            <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 50, height: 50, borderRadius: 12, background: 'var(--card)', border: '1px solid var(--line-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{e}</div>
                <span style={{ fontFamily: 'Kalam', fontSize: 10, color: 'var(--ink-3)' }}>{l}</span>
              </div>
            )}
          </div>

          {/* people */}
          <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>SEND DIRECTLY</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {[['M', 'mum'], ['D', 'dave'], ['S', 'sarah'], ['J', 'jess'], ['＋', 'add']].map(([i, n]) =>
            <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span className="mf-avatar" style={{ width: 46, height: 46, fontSize: 22 }}>{i}</span>
                <span style={{ fontFamily: 'Kalam', fontSize: 11 }}>{n}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <span className="mf-tag include" style={{ fontSize: 10, flex: 1, textAlign: 'center' }}>link only</span>
            <span className="mf-tag" style={{ fontSize: 10, flex: 1, textAlign: 'center' }}>friends</span>
            <span className="mf-tag" style={{ fontSize: 10, flex: 1, textAlign: 'center' }}>public</span>
          </div>
        </div>
      </div>
    </Phone>);

}

// ─────────── Cookbooks ─────────────────────────────────────────
function MobileCookbooks() {
  const books = [
  ['Weeknight dinners', 18, 'private', ['#C8693C', '#7E2D1F'], 'pasta'],
  ['From mum', 9, 'friends', ['#9DAE7A', '#506B3F'], 'bowl'],
  ['Baking', 14, 'public', ['#E2A040', '#8B4A1E'], 'tortilla'],
  ['Slow cooker', 7, 'private', ['#B5462E', '#5C1A0F'], 'pot']];

  return (
    <Phone>
      <div style={{ padding: '6px 18px 10px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>COOKBOOKS</div>
          <h2 className="mf-display" style={{ fontSize: 26, margin: '2px 0 0', lineHeight: 1 }}>collections.</h2>
        </div>
        <button className="mf-btn primary sm">＋ new</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {books.map(([n, c, vis, palette, glyph], i) =>
          <div key={n} style={{ position: 'relative', height: 180, transform: i % 2 ? 'rotate(-0.5deg)' : 'rotate(0.4deg)' }}>
              <div style={{ position: 'absolute', inset: '3px -3px -3px 3px', background: 'var(--ink-4)', borderRadius: 5, opacity: 0.3 }}></div>
              <div style={{ position: 'relative', height: '100%', borderRadius: 5, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` }}>
                <FoodGlyph kind={glyph} size={110} />
                <div style={{ position: 'absolute', inset: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div className="mf-mono" style={{ color: 'rgba(255,246,224,0.85)', fontSize: 9 }}>{c} recipes</div>
                  <div>
                    <div className="mf-display" style={{ fontSize: 22, color: '#FFF6E0', lineHeight: 0.95, textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>{n}</div>
                    <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', padding: '2px 8px', background: 'rgba(0,0,0,0.25)', borderRadius: 999, color: '#FFF6E0', fontFamily: 'Kalam', fontSize: 10 }}>
                      {vis === 'public' ? '🌐' : vis === 'friends' ? '👥' : '🔒'} {vis}
                    </div>
                  </div>
                </div>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 8, background: 'rgba(0,0,0,0.18)' }}></div>
              </div>
            </div>
          )}
        </div>
      </div>
      <TabBar active="cookbooks" />
    </Phone>);

}

// ─────────── Profile ───────────────────────────────────────────
function MobileProfile() {
  const sub = [['64', 'self'], ['142', 'fresh for others'], ['32', 'from freezer']];
  const badges = [
    { ic: '🍴', name: 'Feeder',         tone: 'butter' },
    { ic: '❄️', name: 'Freezer Queen',  tone: 'sage' },
    { ic: '🌶️', name: 'Spice Captain',  tone: 'terra' },
    { ic: '☘️', name: 'Plant Whisp.',   tone: 'sage' },
    { ic: '🥄', name: 'Sun. Saviour',   tone: 'butter' },
    { ic: '📺', name: 'TV Cook',        tone: 'terra' },
    { ic: '✂️', name: 'Fuss Pot',       tone: 'berry' },
  ];
  const toneBg = {
    butter: 'linear-gradient(135deg, #F5C764, #E2A040)',
    sage:   'linear-gradient(135deg, #9DAE7A, #506B3F)',
    terra:  'linear-gradient(135deg, #C8693C, #7E2D1F)',
    berry:  'linear-gradient(135deg, #99394A, #5A1E2A)',
  };
  return (
    <Phone>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '14px 18px 12px', textAlign: 'center' }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--butter)', border: '2px solid var(--ink)', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}>
            <span className="mf-display" style={{ fontSize: 42, color: 'var(--terracotta-deep)' }}>R</span>
          </div>
          <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9, marginTop: 6 }}>@ROBBIE · LIVERPOOL</div>
          <h2 className="mf-display" style={{ fontSize: 28, margin: '2px 0 0', lineHeight: 1 }}>Robbie's <span style={{ color: 'var(--terracotta)' }}>kitchen.</span></h2>
          <p className="mf-body" style={{ fontSize: 12, color: 'var(--ink-2)', margin: '4px 16px 0' }}>
            Cook, taster, leftover-fan. Mostly weeknight pasta and slow-cooker miracles.
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'center' }}>
            <button className="mf-btn primary sm">＋ follow</button>
            <button className="mf-btn ghost sm">⋯</button>
          </div>
        </div>

        {/* meals fed — headline + sub breakdown */}
        <div style={{ padding: '0 14px' }}>
          <div className="mf-card" style={{ padding: '10px 12px', borderLeft: '3px solid var(--terracotta)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>MEALS FED</div>
              <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>12 ppl · 47 recipes · 8 cuisines</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="mf-display" style={{ fontSize: 44, color: 'var(--terracotta)', lineHeight: 0.9 }}>238</span>
              <span style={{ fontFamily: 'Caveat', fontSize: 14, color: 'var(--ink-3)' }}>portions</span>
            </div>
            <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {sub.map(([n, l]) => (
                <div key={l} style={{ padding: '4px 6px', background: 'var(--paper-warm)', borderRadius: 6 }}>
                  <div className="mf-display" style={{ fontSize: 16, lineHeight: 1 }}>{n}</div>
                  <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 8 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* tabs */}
        <div style={{ padding: '12px 18px 6px', display: 'flex', gap: 14, borderBottom: '1px solid var(--line)' }} data-comment-anchor="ae81175055-div-541-9">
          {['Recipes', 'Cookbooks', 'Cooked'].map((t, i) =>
          <span key={t} style={{ paddingBottom: 6, fontFamily: 'Kalam', fontSize: 13, color: i === 0 ? 'var(--ink)' : 'var(--ink-3)', borderBottom: i === 0 ? '2px solid var(--terracotta)' : '2px solid transparent', marginBottom: -1 }}>{t}</span>
          )}
        </div>

        {/* recipes — the social payload */}
        <div style={{ padding: '10px 14px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {RECIPES.slice(0, 6).map((r) =>
          <div key={r.id} className="mf-card">
              <FoodPhoto palette={r.palette} glyph={r.glyph} style={{ height: 90 }} />
              <div style={{ padding: '6px 8px' }}>
                <div className="mf-display" style={{ fontSize: 15, lineHeight: 1.05 }}>{r.title}</div>
                <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9, marginTop: 2 }}>{r.total}</div>
              </div>
            </div>
          )}
        </div>

        {/* badges — below recipes, the fun footer */}
        <div style={{ padding: '4px 0 12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingRight: 14 }}>
            <span className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>BADGES · 7 / 18</span>
            <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>tap to see how →</span>
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, paddingRight: 14 }}>
            {badges.map(b => (
              <div key={b.name} style={{ flex: '0 0 60px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: toneBg[b.tone], border: '2px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: 'var(--shadow)', position: 'relative' }}>
                  {b.ic}
                  <span style={{ position: 'absolute', inset: 2, borderRadius: '50%', border: '1px dashed rgba(255,246,224,0.5)' }}></span>
                </div>
                <div className="mf-display" style={{ fontSize: 11, lineHeight: 1, textAlign: 'center' }}>{b.name}</div>
              </div>
            ))}
            <div style={{ flex: '0 0 60px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--paper)', border: '1.5px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--ink-3)' }}>🔒</div>
              <div className="mf-display" style={{ fontSize: 11, color: 'var(--ink-3)' }}>8 more</div>
            </div>
          </div>
        </div>
      </div>
      <TabBar active="profile" />
    </Phone>);
}

// ─────────── Shopping · meal plan view (mobile) ───────────────
function MobileShoppingPlan() {
  const [mode, setMode] = React.useState('plan'); // plan | quick
  const [sheetOpen, setSheetOpen] = React.useState(true); // open by default so the interaction model is visible on the artboard
  const slots = [['breakfast', 'B'], ['lunch', 'L'], ['dinner', 'D']];
  // Each cell: { idx, leftover?, from? } — one cook session can fill many slots.
  const days = [
  ['mon', 27, { dinner: { idx: 0 } }],
  ['tue', 28, { breakfast: { idx: 3 }, lunch: { idx: 0, leftover: true, from: 'Mon dinner' } }],
  ['wed', 29, { lunch: { idx: 5 }, dinner: { idx: 1 } }],
  ['thu', 30, { lunch: { idx: 1, leftover: true, from: 'Wed dinner' } }],
  ['fri', 1, { dinner: { idx: 2 } }],
  ['sat', 2, {}],
  ['sun', 3, {}]];


  const [picked, setPicked] = React.useState({ 0: true, 1: true, 5: true });
  const cookMeals = days.reduce((n, d) => n + Object.values(d[2]).filter((c) => !c.leftover).length, 0);
  const leftoverMeals = days.reduce((n, d) => n + Object.values(d[2]).filter((c) => c.leftover).length, 0);
  const total = mode === 'plan' ? cookMeals + leftoverMeals : Object.values(picked).filter(Boolean).length;

  return (
    <Phone>
      {/* header */}
      <div style={{ padding: '6px 18px 12px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>WEEK · 27 APR</div>
            <h2 className="mf-display" style={{ fontSize: 28, margin: '2px 0 0', lineHeight: 1 }}>plan the week.</h2>
          </div>
          <button className="mf-btn ghost sm" style={{ padding: '4px 8px' }} title="settings & profile"><MobileAvatar size={24} /></button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          <span onClick={() => setMode('plan')} className={'mf-tag ' + (mode === 'plan' ? 'include' : '')} style={{ fontSize: 11, flex: 1, textAlign: 'center', cursor: 'pointer' }}>📅 plan</span>
          <span onClick={() => setMode('quick')} className={'mf-tag ' + (mode === 'quick' ? 'include' : '')} style={{ fontSize: 11, flex: 1, textAlign: 'center', cursor: 'pointer' }}>✓ just recipes</span>
        </div>
        {mode === 'plan' &&
        <div className="mf-mono" style={{ marginTop: 6, color: 'var(--ink-3)', fontSize: 9 }}>
            {cookMeals + leftoverMeals} meals · <span style={{ color: 'var(--sage)' }}>{leftoverMeals} ↩ leftover</span>
          </div>
        }
      </div>

      {/* body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 0 80px' }}>
        {/* insights — what you've cooked lately to help pick what's next */}
        <MobileEatingInsights />

        {mode === 'plan' ?
        <div>
            {days.map(([d, n, plan], i) => {
            const isToday = i === 0;
            return (
              <div key={d} style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', background: isToday ? 'var(--paper-warm)' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 38, textAlign: 'center' }}>
                      <div className="mf-mono" style={{ color: isToday ? 'var(--terracotta)' : 'var(--ink-3)', fontSize: 9 }}>{d.toUpperCase()}</div>
                      <div className="mf-display" style={{ fontSize: 22, color: isToday ? 'var(--terracotta)' : 'var(--ink)', lineHeight: 1 }}>{n}</div>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {slots.map(([slot]) => {
                      const cell = plan[slot];
                      const r = cell ? RECIPES[cell.idx] : null;
                      const isLeftover = cell?.leftover;
                      const isCookable = !!cell && !isLeftover;
                      return (
                        <div key={slot}
                        onClick={() => isCookable && setSheetOpen(true)}
                        style={{
                          padding: '4px 8px', borderRadius: 6,
                          border: !cell ? '1.5px dashed var(--line-strong)' : isLeftover ? '1.5px dashed var(--sage)' : '1px solid var(--line)',
                          background: !cell ? 'transparent' : isLeftover ? 'rgba(143,166,119,0.10)' : 'var(--card)',
                          display: 'flex', alignItems: 'center', gap: 8, minHeight: 28,
                          cursor: isCookable ? 'pointer' : 'default'
                        }}>
                            <span className="mf-mono" style={{ color: 'var(--ink-4)', fontSize: 9, width: 18 }}>{slot[0].toUpperCase()}</span>
                            {r ?
                          <React.Fragment>
                                <span style={{ width: 18, height: 18, borderRadius: 3, background: `linear-gradient(135deg, ${r.palette[0]}, ${r.palette[1]})`, flexShrink: 0, opacity: isLeftover ? 0.6 : 1 }}></span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontFamily: 'Kalam', fontSize: 12, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                                  {isLeftover && <div className="mf-mono" style={{ color: 'var(--sage)', fontSize: 8 }}>↩ {cell.from} leftovers</div>}
                                </div>
                                <span className="mf-mono" style={{ color: 'var(--ink-4)', fontSize: 9 }}>{isCookable ? '⋯' : '×'}</span>
                              </React.Fragment> :

                          <span style={{ fontFamily: 'Caveat', fontSize: 14, color: 'var(--ink-4)' }}>＋ add {slot}</span>
                          }
                          </div>);

                    })}
                    </div>
                  </div>
                </div>);

          })}
            <div style={{ padding: '10px 18px', fontFamily: 'Kalam', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>
              tap any cooked meal to bump servings & pick which upcoming slots its leftovers fill →
            </div>
          </div> :

        <div style={{ padding: '12px 18px' }}>
            <div className="mf-mono" style={{ color: 'var(--ink-3)' }}>TAP TO ADD / REMOVE FROM THIS WEEK</div>
            <div className="mf-search" style={{ padding: '6px 10px', marginTop: 8 }}>
              <span style={{ color: 'var(--ink-3)' }}>⌕</span>
              <input placeholder="search 47 recipes…" style={{ fontSize: 13 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {RECIPES.map((rr, i) => {
              const on = picked[i];
              // mock: where this recipe is scheduled, including leftovers
              const scheduledTo = { 0: 'Mon dinner ↩ Tue lunch', 1: 'Wed dinner ↩ Thu lunch', 5: 'Wed lunch' }[i];
              return (
                <div key={rr.id} onClick={() => setPicked((p) => ({ ...p, [i]: !p[i] }))} className="mf-card" style={{ padding: 8, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', outline: on ? '2px solid var(--terracotta)' : 'none' }}>
                    <Checkbox on={on} />
                    <FoodPhoto palette={rr.palette} glyph={rr.glyph} style={{ width: 44, height: 44 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Kalam', fontSize: 13, lineHeight: 1.05 }}>{rr.title}</div>
                      <div className="mf-mono" style={{ color: scheduledTo ? 'var(--terracotta)' : 'var(--ink-3)', fontSize: 9, marginTop: 1 }}>
                        {scheduledTo ? '📅 ' + scheduledTo : rr.cuisine.toLowerCase() + ' · ' + rr.total}
                      </div>
                    </div>
                  </div>);

            })}
            </div>
          </div>
        }
      </div>

      {/* leftover-config bottom sheet */}
      {sheetOpen &&
      <React.Fragment>
          <div onClick={() => setSheetOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 4 }}></div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--paper)', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '12px 18px 22px', zIndex: 5, boxShadow: '0 -8px 24px rgba(0,0,0,0.18)' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--ink-4)', margin: '0 auto 10px' }}></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 5, background: 'linear-gradient(135deg, #D67C42, #7E2D1F)' }}></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mf-display" style={{ fontSize: 20, lineHeight: 1 }}>Chorizo Pasta Bake</div>
                <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>Mon · dinner · cook session</div>
              </div>
              <button onClick={() => setSheetOpen(false)} className="mf-btn ghost sm" style={{ padding: '2px 8px' }}>done</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '6px 10px', background: 'var(--paper-warm)', borderRadius: 8 }}>
              <span style={{ fontFamily: 'Kalam', fontSize: 13 }}>serves</span>
              <button className="mf-btn sm" style={{ padding: '0 8px' }}>−</button>
              <span className="mf-display" style={{ fontSize: 22, color: 'var(--terracotta)' }}>6</span>
              <button className="mf-btn sm" style={{ padding: '0 8px' }}>＋</button>
              <span className="mf-mono" style={{ color: 'var(--ink-3)', marginLeft: 'auto', fontSize: 9 }}>2 base · 4 leftover</span>
            </div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9, marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span>FILLS THESE MEALS · TICK ANY</span>
              <span style={{ color: 'var(--ink-3)' }}>scroll ↓</span>
            </div>
            <div style={{ marginTop: 4, maxHeight: 170, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
              {[
            ['Tue · lunch', true, true, false],
            ['Tue · dinner', false, false, false],
            ['Wed · lunch', false, false, true],
            ['Wed · dinner', false, false, true],
            ['Thu · lunch', true, false, false],
            ['Thu · dinner', false, false, false],
            ['Fri · lunch', false, false, false],
            ['Fri · dinner', false, false, true],
            ['Sat · lunch', false, false, false],
            ['Sat · dinner', false, false, false],
            ['Sun · lunch', false, false, false]].
            map(([slot, on, suggested, occupied]) =>
            <label key={slot} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Kalam', fontSize: 13, padding: '4px 0', opacity: occupied ? 0.45 : 1 }}>
                  <Checkbox on={on} />
                  <span style={{ flex: 1 }}>{slot}</span>
                  {occupied && <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>OTHER MEAL</span>}
                  {suggested && !occupied && <span className="mf-mono" style={{ color: 'var(--sage)', fontSize: 9 }}>SUGGESTED</span>}
                </label>
            )}
              <div style={{ padding: '4px 0', fontFamily: 'Kalam', fontSize: 13, color: 'var(--terracotta)' }}>＋ extend into next week →</div>
            </div>
            <div style={{ marginTop: 12, padding: '6px 10px', background: 'rgba(143,166,119,0.10)', borderRadius: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
              cooking for <b>6 servings</b> · ingredients auto-scale in the shopping list.
            </div>
          </div>
        </React.Fragment>
      }

      {/* sticky CTA above tab bar */}
      <div style={{ position: 'absolute', bottom: 62, left: 0, right: 0, padding: '8px 18px 0', background: 'linear-gradient(to top, var(--paper) 60%, transparent)', pointerEvents: 'none' }}>
        <button className="mf-btn terra" style={{ width: '100%', padding: '10px', fontSize: 15, borderRadius: 12, pointerEvents: 'auto', boxShadow: 'var(--shadow)' }}>
          🛒 make shopping list →
        </button>
      </div>
      <TabBar active="shop" />
    </Phone>);

}

// Reuse Checkbox from shopping.jsx (it's a top-level function so it's global).
window.MobileShoppingPlan = MobileShoppingPlan;

// ─────────── Mobile · Kitchen (Pantry + Freezer) ───────────────
function MobileKitchen() {
  const [tab, setTab] = React.useState('pantry');
  const [addOpen, setAddOpen] = React.useState(false);
  const [addFreezerOpen, setAddFreezerOpen] = React.useState(false);

  return (
    <Phone>
      {/* header */}
      <div style={{ padding: '6px 18px 10px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>KITCHEN</div>
            <h2 className="mf-display" style={{ fontSize: 28, margin: '2px 0 0', lineHeight: 1 }}>what's in stock.</h2>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => tab === 'pantry' ? setAddOpen(true) : setAddFreezerOpen(true)} className="mf-btn primary sm">＋ add</button>
            <MobileAvatar />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          <span onClick={() => setTab('pantry')} className={'mf-tag ' + (tab === 'pantry' ? 'include' : '')} style={{ fontSize: 11, flex: 1, textAlign: 'center', cursor: 'pointer' }}>🧂 Pantry · 18</span>
          <span onClick={() => setTab('freezer')} className={'mf-tag ' + (tab === 'freezer' ? 'include' : '')} style={{ fontSize: 11, flex: 1, textAlign: 'center', cursor: 'pointer' }}>❄️ Freezer · 6</span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* "can cook now" lives inside the scrollable content as a card — consistent with other mobile views */}
        <div style={{ padding: '10px 18px 0' }}>
          <div className="mf-card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid var(--sage)' }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--sage)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, flexShrink: 0 }}>✓</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Kalam', fontSize: 12, lineHeight: 1.1 }}><b>2 recipes</b> you can cook right now</div>
              <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>soup · cajun pasta</div>
            </div>
            <span className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 10 }}>open →</span>
          </div>
        </div>
        {tab === 'pantry' ? <MobilePantry openAdd={() => setAddOpen(true)} /> : <MobileFreezer openAdd={() => setAddFreezerOpen(true)} />}
      </div>

      {addOpen && <MobileAddItemSheet onClose={() => setAddOpen(false)} />}
      {addFreezerOpen && <MobileAddFreezerSheet onClose={() => setAddFreezerOpen(false)} />}
      <TabBar active="kitchen" />
    </Phone>);

}

function MobilePantry({ openAdd }) {
  const [stock, setStock] = React.useState(() => {
    const m = {};
    Object.entries(window.PANTRY || {}).forEach(([sec, items]) => items.forEach(([n, on]) => m[n] = on));
    return m;
  });
  const toggle = (n) => setStock((s) => ({ ...s, [n]: !s[n] }));
  return (
    <div style={{ padding: '12px 18px 18px' }}>
      <div className="mf-search" style={{ padding: '6px 10px' }}>
        <span style={{ color: 'var(--ink-3)' }}>⌕</span>
        <input placeholder="search your pantry…" style={{ fontSize: 13 }} />
      </div>
      {Object.entries(window.PANTRY || {}).map(([section, items]) => {
        const inStock = items.filter(([n]) => stock[n]);
        return (
          <div key={section} style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 2 }}>
              <div className="mf-display" style={{ fontSize: 18, color: 'var(--terracotta)' }}>· {section}</div>
              <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{inStock.length}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {inStock.map(([n]) =>
              <span key={n} className="mf-tag include" style={{ fontSize: 11, padding: '3px 4px 3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {n}
                  <span onClick={() => toggle(n)} style={{ cursor: 'pointer', opacity: 0.7, padding: '0 4px' }}>×</span>
                </span>
              )}
              <span onClick={openAdd} className="mf-tag" style={{ borderStyle: 'dashed', fontSize: 11, color: 'var(--terracotta)' }}>＋ add</span>
            </div>
          </div>);

      })}
    </div>);

}

function MobileFreezer({ openAdd }) {
  const [sort, setSort] = React.useState('date');
  const [filter, setFilter] = React.useState('all');
  const sorted = [...(window.FREEZER || [])].
  filter((f) => filter === 'all' || f.kind === filter).
  sort((a, b) => sort === 'date' ? a.eatBy - b.eatBy : a.name.localeCompare(b.name));
  return (
    <div style={{ padding: '12px 18px 18px' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>SORT</span>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ padding: '3px 6px', fontFamily: 'Kalam', fontSize: 11, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'white' }}>
          <option value="date">eat-by date</option>
          <option value="name">name</option>
        </select>
        <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>SHOW</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: '3px 6px', fontFamily: 'Kalam', fontSize: 11, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'white' }}>
          <option value="all">all</option>
          <option value="cooked">cooked</option>
          <option value="ingredient">ingredient</option>
        </select>
        <button onClick={openAdd} className="mf-btn primary sm" style={{ marginLeft: 'auto', fontSize: 11 }}>＋ add</button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map((f, i) => {
          const expired = f.eatBy < 0;
          const urgent = f.eatBy >= 0 && f.eatBy <= 7;
          const tone = expired ? 'var(--terracotta-deep)' : urgent ? 'var(--terracotta)' : 'var(--sage)';
          const dateLabel = expired ? `expired ${-f.eatBy}d ago` : urgent ? `use within ${f.eatBy}d` : `keeps ~${f.eatBy}d`;
          return (
            <div key={i} className="mf-card" style={{ padding: 8, borderLeft: `3px solid ${tone}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 32, height: 32, borderRadius: 4, background: `linear-gradient(135deg, ${f.palette[0]}, ${f.palette[1]})`, position: 'relative', flexShrink: 0 }}>
                {f.kind === 'cooked' && <FoodGlyph kind={f.glyph} size={26} />}
                {f.kind === 'ingredient' &&
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF6E0', fontSize: 14 }}>❄</span>
                }
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Kalam', fontSize: 13, lineHeight: 1.1 }}>{f.name}</div>
                <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>
                  {f.kind === 'cooked' ? `${f.portions} portions` : f.qty}
                </div>
                <div className="mf-mono" style={{ color: tone, fontSize: 9 }}>{expired && '⚠ '}{dateLabel}</div>
              </div>
              <button className="mf-btn sm" style={{ fontSize: 10, padding: '2px 6px' }}>
                {f.kind === 'cooked' ? '🍴 ate' : '✓ used'}
              </button>
            </div>);

        })}
      </div>
    </div>);

}

function MobileAddFreezerSheet({ onClose }) {
  const [kind, setKind] = React.useState('cooked');
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 4 }}></div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--paper)', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '12px 18px 22px', zIndex: 5, maxHeight: '88%', overflow: 'auto' }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--ink-4)', margin: '0 auto 10px' }}></div>
        <h3 className="mf-display" style={{ fontSize: 22, margin: 0 }}>add to freezer ❄️</h3>

        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          <span onClick={() => setKind('cooked')} className={'mf-tag ' + (kind === 'cooked' ? 'include' : '')} style={{ fontSize: 11, flex: 1, textAlign: 'center', cursor: 'pointer' }}>🍝 cooked portion</span>
          <span onClick={() => setKind('ingredient')} className={'mf-tag ' + (kind === 'ingredient' ? 'include' : '')} style={{ fontSize: 11, flex: 1, textAlign: 'center', cursor: 'pointer' }}>🥩 ingredient</span>
        </div>

        <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 12, fontSize: 9 }}>{kind === 'cooked' ? 'WHICH RECIPE?' : 'WHAT IS IT?'}</div>
        <div className="mf-search" style={{ padding: '6px 10px', marginTop: 4 }}>
          <span style={{ color: 'var(--ink-3)' }}>⌕</span>
          <input defaultValue={kind === 'cooked' ? 'Chicken & Chorizo Pasta Bake' : ''} placeholder={kind === 'ingredient' ? 'beef mince · salmon · peas…' : ''} style={{ fontSize: 13 }} />
        </div>

        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>QUANTITY</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <button className="mf-btn sm" style={{ padding: '0 6px' }}>−</button>
              <span className="mf-display" style={{ fontSize: 18, color: 'var(--terracotta)' }}>2</span>
              <button className="mf-btn sm" style={{ padding: '0 6px' }}>＋</button>
              <span style={{ fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>{kind === 'cooked' ? 'ptns' : '×'}</span>
            </div>
          </div>
          <div>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>FROZEN ON</div>
            <input type="date" defaultValue="2026-05-19" style={{ marginTop: 4, padding: '4px 6px', fontFamily: 'Kalam', fontSize: 13, border: '1px solid var(--line-strong)', borderRadius: 4, width: '100%', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 12, fontSize: 9 }}>BEST EATEN BY</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {[['7d', '1 wk'], ['14d', '2 wks'], ['1m', '1 mo'], ['3m', '3 mo'], ['6m', '6 mo']].map(([k, l]) =>
          <span key={k} className={'mf-tag ' + (k === (kind === 'cooked' ? '14d' : '3m') ? 'include' : '')} style={{ fontSize: 11, cursor: 'pointer' }}>{l}</span>
          )}
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>OR PICK</span>
          <input type="date" defaultValue="2026-06-02" style={{ padding: '4px 6px', fontFamily: 'Kalam', fontSize: 13, border: '1px solid var(--line-strong)', borderRadius: 4 }} />
        </div>
        <div className="mf-mono" style={{ color: 'var(--sage)', marginTop: 6, fontSize: 9 }}>auto-suggested based on {kind}</div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="mf-btn ghost" onClick={onClose} style={{ flex: 1 }}>cancel</button>
          <button className="mf-btn primary" onClick={onClose} style={{ flex: 1 }}>save ✓</button>
        </div>
      </div>
    </React.Fragment>);

}

function MobileAddItemSheet({ onClose }) {
  const [method, setMethod] = React.useState('search');
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 4 }}></div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--paper)', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '12px 18px 22px', zIndex: 5, boxShadow: '0 -8px 24px rgba(0,0,0,0.2)' }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--ink-4)', margin: '0 auto 10px' }}></div>
        <h3 className="mf-display" style={{ fontSize: 22, margin: 0 }}>add to your kitchen</h3>
        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          {[['search', '⌕ search'], ['barcode', '▥ barcode'], ['photo', '📷 photo'], ['receipt', '🧾 receipt']].map(([k, l]) =>
          <span key={k} onClick={() => setMethod(k)} className={'mf-tag ' + (method === k ? 'include' : '')} style={{ fontSize: 10, cursor: 'pointer', flex: 1, textAlign: 'center' }}>{l}</span>
          )}
        </div>
        {method === 'search' &&
        <div style={{ marginTop: 12 }}>
            <div className="mf-search" style={{ padding: '8px 12px' }}>
              <span style={{ color: 'var(--ink-3)' }}>⌕</span>
              <input placeholder="type an ingredient…" style={{ fontSize: 13 }} autoFocus />
            </div>
            <div className="mf-mono" style={{ color: 'var(--ink-3)', marginTop: 10, fontSize: 9 }}>SUGGESTIONS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {['pasta · penne', 'rice', 'olive oil', 'cherry tomatoes', 'milk', 'eggs', 'butter', 'garlic'].map((s) =>
            <span key={s} className="mf-tag" style={{ fontSize: 11, cursor: 'pointer' }}>＋ {s}</span>
            )}
            </div>
          </div>
        }
        {method === 'barcode' &&
        <div style={{ marginTop: 12, height: 200, background: '#2a2520', borderRadius: 12, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '50%', left: 24, right: 24, height: 2, background: 'var(--butter)', boxShadow: '0 0 12px var(--butter)' }}></div>
            <div style={{ position: 'absolute', top: '50%', left: 24, right: 24, height: 80, transform: 'translateY(-50%)', border: '2px dashed var(--butter)', borderRadius: 8 }}></div>
            <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', color: 'var(--butter)', fontFamily: 'Caveat', fontSize: 15 }}>line up the barcode</div>
          </div>
        }
        {method === 'photo' &&
        <div style={{ marginTop: 12, padding: 16, background: 'var(--paper-warm)', borderRadius: 10, textAlign: 'center', border: '2px dashed var(--line-strong)' }}>
            <div style={{ fontSize: 32 }}>📸</div>
            <div className="mf-display" style={{ fontSize: 18, marginTop: 4 }}>snap your fridge</div>
            <div className="mf-mono" style={{ color: 'var(--ink-3)', marginTop: 4, fontSize: 9 }}>ML detects items · you confirm</div>
            <button className="mf-btn primary sm" style={{ marginTop: 8 }}>take photo</button>
          </div>
        }
        {method === 'receipt' &&
        <div style={{ marginTop: 12 }}>
            <div style={{ padding: 14, background: 'var(--paper-warm)', borderRadius: 10, border: '2px dashed var(--line-strong)', textAlign: 'center' }}>
              <div style={{ fontSize: 32 }}>🧾</div>
              <div className="mf-display" style={{ fontSize: 18, marginTop: 4 }}>scan a receipt</div>
              <button className="mf-btn primary sm" style={{ marginTop: 8 }}>upload</button>
            </div>
          </div>
        }

        {/* persistent footer — same for every method */}
        <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(143,166,119,0.10)', borderRadius: 8, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>
          ✓ items also auto-flow into your pantry as you tick them off the <b>shopping list</b>.
        </div>
      </div>
    </React.Fragment>);

}

window.MobileKitchen = MobileKitchen;
window.MobileAddFreezerSheet = MobileAddFreezerSheet;

function MobileEatingInsights() {
  const [open, setOpen] = React.useState(false);
  const stale = [
  { label: 'Chicken Risotto', days: 43, palette: ['#C8553D', '#7E3326'] },
  { label: 'Potato Leek Soup', days: 31, palette: ['#9DAE7A', '#506B3F'] },
  { label: 'Chicken Alfredo', days: 26, palette: ['#E5C892', '#9C7740'] }];

  const heavy = [
  { label: 'Chorizo Pasta Bake', count: 4, palette: ['#D67C42', '#7E2D1F'] },
  { label: 'Quesadillas', count: 3, palette: ['#E2A040', '#8B4A1E'] }];


  if (!open) {
    return (
      <div onClick={() => setOpen(true)} style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line)', background: 'var(--paper-warm)', cursor: 'pointer' }}>
        <span style={{ fontSize: 14 }}>📊</span>
        <span style={{ flex: 1, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.3 }}>
          mostly italian · <span style={{ color: 'var(--sage)' }}>no risotto in 43d</span>
        </span>
        <span className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>more ▾</span>
      </div>);

  }

  return (
    <div style={{ padding: '10px 18px 8px', borderBottom: '1px solid var(--line)', background: 'var(--paper-warm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>EATING THIS WEEK</span>
        <span onClick={() => setOpen(false)} className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>hide ▴</span>
      </div>
      <div style={{ marginTop: 6, fontFamily: 'Kalam', fontSize: 11, color: 'var(--ink-2)' }}>mostly italian (50%) · <span style={{ color: 'var(--sage)' }}>no asian in 3 wks</span></div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, overflowX: 'auto' }}>
        {stale.map((s, i) =>
        <div key={i} className="mf-card" style={{ flex: '0 0 130px', padding: 6 }}>
            <div className="mf-mono" style={{ color: 'var(--sage)', fontSize: 8 }}>NOT IN A WHILE</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
              <span style={{ width: 24, height: 24, borderRadius: 4, background: `linear-gradient(135deg, ${s.palette[0]}, ${s.palette[1]})`, flexShrink: 0 }}></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: 'Kalam', fontSize: 11, lineHeight: 1.05 }}>{s.label}</div>
                <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{s.days}d ago</div>
              </div>
            </div>
          </div>
        )}
        {heavy.map((h, i) =>
        <div key={'h' + i} className="mf-card" style={{ flex: '0 0 130px', padding: 6 }}>
            <div className="mf-mono" style={{ color: 'var(--terracotta-deep)', fontSize: 8 }}>OFTEN LATELY</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
              <span style={{ width: 24, height: 24, borderRadius: 4, background: `linear-gradient(135deg, ${h.palette[0]}, ${h.palette[1]})`, flexShrink: 0 }}></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: 'Kalam', fontSize: 11, lineHeight: 1.05 }}>{h.label}</div>
                <div className="mf-mono" style={{ color: 'var(--terracotta-deep)', fontSize: 9 }}>×{h.count} this mo</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>);

}
window.MobileEatingInsights = MobileEatingInsights;

window.MobileList = MobileList;
window.MobileRecipe = MobileRecipe;
window.MobileScan = MobileScan;
window.MobileShare = MobileShare;
window.MobileCookbooks = MobileCookbooks;
window.MobileProfile = MobileProfile;
