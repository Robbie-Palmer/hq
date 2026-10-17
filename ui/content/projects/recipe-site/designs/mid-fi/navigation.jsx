// mid-fi/navigation.jsx: planning and shopping information architecture.

const NAV_ROUTES = {
  recipes: { label: 'Recipes', route: '/recipes', icon: '▤' },
  discover: { label: 'Discover', route: '/recipes/discover', icon: '⌕' },
  planning: { label: 'Plan', title: 'Meal plan', route: '/recipes/planning', icon: '□' },
  shopping: { label: 'Shop', title: 'Shopping list', route: '/recipes/shopping', icon: '✓' },
  kitchen: { label: 'Kitchen', route: '/recipes/kitchen', icon: '⌂' },
  log: { label: 'Log', title: 'Cooking log', route: '/recipes/log', icon: '↺' },
};

const NAV_PAGE_COPY = {
  recipes: ['your recipes.', 'Open a recipe, add one, or return to something you cook often.'],
  discover: ['discover.', 'Browse recipes and cooks outside your own box.'],
  planning: ['meal plan.', 'Plan one meal now. A full week is optional.'],
  shopping: ['shopping list.', '12 unticked items in the active household list.'],
  kitchen: ['kitchen.', 'Check pantry, freezer, and missing ingredients.'],
  log: ['cooking log.', 'Review what you cooked and what you changed.'],
  notifications: ['notifications.', 'Two unread updates from your household.'],
  profile: ['your profile.', 'Manage the public view of your cooking activity.'],
  settings: ['settings.', 'Household, diet, units, agents, security, and account.'],
};

function NavigationPlanPreview({ mobile = false, go }) {
  const visibleDays = mobile ? PLANNED_WEEK.slice(0, 3) : PLANNED_WEEK.slice(0, 5);
  return (
    <div style={{ marginTop: mobile ? 14 : 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="mf-tag include" style={{ fontSize: mobile ? 8 : 10 }}>7 meals</span>
        <span className="mf-tag" style={{ fontSize: mobile ? 8 : 10 }}>5 cooks</span>
        <span className="mf-tag" style={{ fontSize: mobile ? 8 : 10 }}>2 leftovers</span>
        {!mobile && <button className="mf-btn terra sm" style={{ marginLeft: 'auto' }}>Plan a meal</button>}
      </div>
      <div className="mf-card" style={{ padding: mobile ? 8 : 10, maxWidth: 720 }}>
        {visibleDays.map((day) => <div key={day.key} style={{ display: 'grid', gridTemplateColumns: mobile ? '42px 1fr' : '70px 1fr', gap: 8, padding: mobile ? '6px 3px' : '8px 5px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: mobile ? 7 : 8 }}>{day.day.toUpperCase()}</div>
            <div className="mf-display" style={{ fontSize: mobile ? 19 : 23, lineHeight: 1 }}>{day.date}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : `repeat(${Math.min(2, day.meals.length)}, minmax(0, 1fr))`, gap: 5 }}>
            {day.meals.map((meal, index) => <PlannedMealCard key={`${meal.slot}-${index}`} meal={meal} compact />)}
          </div>
        </div>)}
        <div style={{ display: 'flex', gap: 6, padding: '8px 4px 2px' }}>
          <button className="mf-btn ghost sm" style={{ flex: 1, borderStyle: 'dashed' }}>Plan Sat</button>
          <button className="mf-btn ghost sm" style={{ flex: 1, borderStyle: 'dashed' }}>Plan Sun</button>
        </div>
      </div>
      <button className="mf-btn" style={{ marginTop: 10 }} onClick={() => go('shopping')}>Review Shop · 12 →</button>
    </div>
  );
}

function NavDestinationContent({ active, go }) {
  const [title, description] = NAV_PAGE_COPY[active] || NAV_PAGE_COPY.recipes;
  return (
    <div style={{ padding: '34px 44px', flex: 1, overflow: 'auto' }}>
      <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>
        {active === 'planning' ? 'PLAN · THU 15 OCT' : active === 'shopping' ? 'SHOP · ACTIVE LIST' : active.toUpperCase()}
      </div>
      <h1 className="mf-display" style={{ fontSize: 54, margin: '5px 0 8px' }}>{title}</h1>
      <p className="mf-body" style={{ color: 'var(--ink-2)', maxWidth: 620, margin: 0 }}>{description}</p>

      {active === 'planning' && (
        <NavigationPlanPreview go={go} />
      )}

      {active === 'shopping' && (
        <div className="mf-card" style={{ marginTop: 24, padding: 18, maxWidth: 650 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mf-check"></span>
            <span style={{ flex: 1 }}>fresh basil</span>
            <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>PRODUCE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span className="mf-check done"></span>
            <span style={{ flex: 1, textDecoration: 'line-through', color: 'var(--ink-3)' }}>chorizo</span>
            <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>CHILLED</span>
          </div>
          <hr className="mf-rule" style={{ margin: '16px 0' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="mf-btn">＋ Add item</button>
            <button className="mf-btn" onClick={() => go('planning')}>Plan meals →</button>
          </div>
        </div>
      )}

      {!['planning', 'shopping'].includes(active) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 280px))', gap: 12, marginTop: 24 }}>
          {[['planning', 'Plan one meal'], ['shopping', 'Open shopping list']].map(([key, label]) => (
            <button key={key} className="mf-card" onClick={() => go(key)} style={{ padding: 18, textAlign: 'left', fontFamily: 'Kalam', color: 'var(--ink)', background: 'var(--card)' }}>
              <div className="mf-display" style={{ fontSize: 24 }}>{label}</div>
              <div className="mf-mono" style={{ color: 'var(--terracotta)', marginTop: 6 }}>{NAV_ROUTES[key].route}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NavigationDesktopPrototype() {
  const [history, setHistory] = React.useState(['planning']);
  const [accountOpen, setAccountOpen] = React.useState(false);
  const active = history[history.length - 1];
  const go = (next) => {
    setAccountOpen(false);
    setHistory((items) => [...items, next]);
  };
  const back = () => setHistory((items) => items.length > 1 ? items.slice(0, -1) : items);
  const primary = ['recipes', 'discover', 'planning', 'shopping', 'kitchen', 'log'];

  return (
    <div className="mf mf-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <nav aria-label="Recipe sections" className="mf-nav" style={{ gap: 16, padding: '16px 24px', overflow: 'visible', position: 'relative', zIndex: 2 }}>
        <button onClick={() => go('recipes')} style={{ border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }} className="mf-logo">
          Robbie's <em style={{ fontStyle: 'italic', color: 'var(--terracotta)' }}>recipes</em>
        </button>
        <div style={{ display: 'flex', gap: 14, marginLeft: 8 }}>
          {primary.map((key) => {
            const item = NAV_ROUTES[key];
            return (
              <button
                key={key}
                aria-current={active === key ? 'page' : undefined}
                onClick={() => go(key)}
                style={{ position: 'relative', border: 0, borderBottom: active === key ? '2px solid var(--terracotta)' : '2px solid transparent', background: 'transparent', padding: '5px 2px', fontFamily: 'Kalam', fontSize: 14, color: active === key ? 'var(--ink)' : 'var(--ink-2)', cursor: 'pointer' }}
              >
                {item.label}
                {key === 'shopping' && <span style={{ marginLeft: 5, minWidth: 17, height: 17, padding: '0 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 99, background: 'var(--terracotta)', color: 'white', font: '9px JetBrains Mono' }}>12</span>}
              </button>
            );
          })}
        </div>
        <div className="mf-nav-spacer"></div>
        <button onClick={() => go('notifications')} aria-label="Notifications, 2 unread" className="mf-btn ghost" style={{ position: 'relative', padding: 6, fontSize: 18 }}>
          ♢<span style={{ position: 'absolute', top: 1, right: 1, width: 7, height: 7, borderRadius: 99, background: 'var(--berry)' }}></span>
        </button>
        <div style={{ position: 'relative' }}>
          <button aria-expanded={accountOpen} aria-label="Account menu" onClick={() => setAccountOpen((value) => !value)} className="mf-avatar" style={{ cursor: 'pointer' }}>R</button>
          {accountOpen && (
            <div style={{ position: 'absolute', right: 0, top: 42, width: 190, background: 'var(--card)', border: '1px solid var(--line-strong)', borderRadius: 10, padding: 8, boxShadow: 'var(--shadow)' }}>
              {[['profile', 'Profile'], ['settings', 'Settings']].map(([key, label]) => (
                <button key={key} onClick={() => go(key)} style={{ display: 'block', width: '100%', border: 0, borderRadius: 6, background: 'transparent', padding: '8px 10px', textAlign: 'left', fontFamily: 'Kalam', cursor: 'pointer' }}>{label}</button>
              ))}
              <hr className="mf-rule" style={{ margin: '4px 0' }} />
              <button style={{ display: 'block', width: '100%', border: 0, background: 'transparent', padding: '8px 10px', textAlign: 'left', fontFamily: 'Kalam' }}>Install app</button>
              <button style={{ display: 'block', width: '100%', border: 0, background: 'transparent', padding: '8px 10px', textAlign: 'left', fontFamily: 'Kalam' }}>Sign out</button>
            </div>
          )}
        </div>
      </nav>

      <div style={{ padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--paper-warm)', borderBottom: '1px solid var(--line)' }}>
        <button className="mf-btn sm" disabled={history.length === 1} onClick={back}>← Back</button>
        <span className="mf-mono" style={{ color: 'var(--ink-3)', textTransform: 'none' }}>{NAV_ROUTES[active]?.route || `/recipes/${active}`}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'Kalam', color: 'var(--ink-3)', fontSize: 12 }}>History: {history.join(' → ')}</span>
      </div>
      <NavDestinationContent active={active} go={go} />
    </div>
  );
}

function MobileBottomNavigation({ active, go, openMore }) {
  const items = [
    ['recipes', 'Recipes', '▤'],
    ['planning', 'Plan', '□'],
    ['shopping', 'Shop', '✓'],
    ['kitchen', 'Kitchen', '⌂'],
    ['more', 'More', '•••'],
  ];
  const moreActive = ['discover', 'log', 'profile', 'settings'].includes(active);
  return (
    <nav aria-label="Recipe sections" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', padding: '7px 4px 11px', background: 'var(--card)', borderTop: '1px solid var(--line-strong)', position: 'relative', zIndex: 4 }}>
      {items.map(([key, label, icon]) => {
        const selected = key === 'more' ? moreActive : active === key;
        return (
          <button key={key} aria-current={selected ? 'page' : undefined} onClick={() => key === 'more' ? openMore() : go(key)} style={{ border: 0, background: 'transparent', color: selected ? 'var(--terracotta-deep)' : 'var(--ink-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontFamily: 'Kalam', fontSize: 11, cursor: 'pointer', position: 'relative' }}>
            <span style={{ font: key === 'more' ? '700 13px JetBrains Mono' : '18px Caveat', height: 19 }}>{icon}</span>
            <span>{label}</span>
            {key === 'shopping' && <span aria-label="12 unticked items" style={{ position: 'absolute', top: -2, left: '56%', minWidth: 15, height: 15, padding: '0 3px', borderRadius: 99, background: 'var(--terracotta)', color: 'white', font: '8px JetBrains Mono', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>12</span>}
            {key === 'more' && <span aria-label="Activity in More" style={{ position: 'absolute', top: 0, left: '59%', width: 6, height: 6, borderRadius: 99, background: 'var(--berry)' }}></span>}
          </button>
        );
      })}
    </nav>
  );
}

function NavigationMobilePrototype() {
  const [history, setHistory] = React.useState(['shopping']);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [signedIn, setSignedIn] = React.useState(true);
  const active = history[history.length - 1];
  const protectedDestinations = ['planning', 'shopping', 'kitchen', 'log', 'notifications', 'profile', 'settings'];
  const blocked = !signedIn && protectedDestinations.includes(active);
  const go = (next) => {
    setMoreOpen(false);
    setHistory((items) => [...items, next]);
  };
  const back = () => {
    setMoreOpen(false);
    setHistory((items) => items.length > 1 ? items.slice(0, -1) : items);
  };
  const moreItems = [
    ['discover', 'Discover', 'Browse recipes and cooks'],
    ['log', 'Cooking log', 'History and outcomes'],
    ['profile', 'Profile', 'Your public cooking profile'],
    ['settings', 'Settings', 'Household, diet, units, and account'],
  ];

  return (
    <Phone>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', position: 'relative', zIndex: 5 }}>
        <button onClick={back} aria-label="Back" style={{ border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: 'var(--ink)' }}>←</button>
        <button onClick={() => go('recipes')} className="mf-logo" style={{ border: 0, background: 'transparent', padding: 0, fontSize: 22, cursor: 'pointer' }}>Robbie's <em style={{ color: 'var(--terracotta)' }}>recipes</em></button>
        <button onClick={() => setSignedIn((value) => !value)} className="mf-tag soft" style={{ marginLeft: 'auto', fontSize: 9 }}>{signedIn ? 'signed in' : 'logged out'}</button>
        <button onClick={() => go('notifications')} aria-label="Notifications, 2 unread" style={{ position: 'relative', border: 0, background: 'transparent', fontSize: 18, padding: 4, cursor: 'pointer' }}>
          ♢<span style={{ position: 'absolute', top: 2, right: 1, width: 7, height: 7, borderRadius: 99, background: 'var(--berry)' }}></span>
        </button>
      </header>

      <div style={{ padding: '7px 14px', background: 'var(--paper-warm)', borderBottom: '1px solid var(--line)' }}>
        <div className="mf-mono" style={{ color: 'var(--ink-3)', fontSize: 8, textTransform: 'none' }}>{NAV_ROUTES[active]?.route || `/recipes/${active}`}</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', position: 'relative', padding: '18px 16px 28px' }}>
        {blocked ? (
          <div className="mf-card" style={{ padding: 18, marginTop: 28 }}>
            <div className="mf-mono" style={{ color: 'var(--terracotta)' }}>SIGN IN TO CONTINUE</div>
            <h1 className="mf-display" style={{ fontSize: 34, margin: '7px 0' }}>Your {NAV_PAGE_COPY[active]?.[0]}</h1>
            <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.5 }}>After sign-in, return to <span className="mf-mono" style={{ textTransform: 'none' }}>{NAV_ROUTES[active]?.route || `/recipes/${active}`}</span>.</p>
            <button className="mf-btn terra" onClick={() => setSignedIn(true)}>Sign in</button>
          </div>
        ) : (
          <React.Fragment>
            <div className="mf-mono" style={{ color: 'var(--terracotta)', fontSize: 9 }}>{active.toUpperCase()}</div>
            <h1 className="mf-display" style={{ fontSize: 38, margin: '5px 0 8px' }}>{NAV_PAGE_COPY[active]?.[0] || 'your recipes.'}</h1>
            <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.45, margin: 0 }}>{NAV_PAGE_COPY[active]?.[1] || NAV_PAGE_COPY.recipes[1]}</p>

            {active === 'shopping' && (
              <div style={{ marginTop: 18 }}>
                {['fresh basil', 'chorizo', 'mozzarella', 'garlic'].map((item, index) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 0', borderBottom: '1px dashed var(--line-strong)' }}>
                    <span className={`mf-check ${index === 1 ? 'done' : ''}`}></span>
                    <span style={{ textDecoration: index === 1 ? 'line-through' : 'none', color: index === 1 ? 'var(--ink-3)' : 'var(--ink)' }}>{item}</span>
                  </div>
                ))}
                <button className="mf-btn" style={{ marginTop: 16 }} onClick={() => go('planning')}>Plan meals →</button>
              </div>
            )}

            {active === 'planning' && (
              <NavigationPlanPreview mobile go={go} />
            )}

            {!['shopping', 'planning'].includes(active) && (
              <div style={{ display: 'grid', gap: 9, marginTop: 18 }}>
                <button className="mf-card" onClick={() => go('planning')} style={{ padding: 14, textAlign: 'left', fontFamily: 'Kalam', color: 'var(--ink)', background: 'var(--card)' }}>□ Plan one meal</button>
                <button className="mf-card" onClick={() => go('shopping')} style={{ padding: 14, textAlign: 'left', fontFamily: 'Kalam', color: 'var(--ink)', background: 'var(--card)' }}>✓ Open shopping list</button>
              </div>
            )}
          </React.Fragment>
        )}

        {moreOpen && (
          <React.Fragment>
            <button aria-label="Close More" onClick={() => setMoreOpen(false)} style={{ position: 'absolute', inset: 0, border: 0, background: 'rgba(31,26,20,.28)', zIndex: 2 }}></button>
            <section aria-label="More destinations" style={{ position: 'absolute', left: 8, right: 8, bottom: 8, zIndex: 3, background: 'var(--card)', border: '1px solid var(--line-strong)', borderRadius: 16, padding: '14px 14px 10px', boxShadow: 'var(--shadow)' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7 }}>
                <h2 className="mf-display" style={{ fontSize: 28, margin: 0 }}>More.</h2>
                <button onClick={() => setMoreOpen(false)} aria-label="Close More" style={{ marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer' }}>×</button>
              </div>
              {moreItems.map(([key, label, note]) => (
                <button key={key} onClick={() => go(key)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 4px', border: 0, borderTop: '1px solid var(--line)', background: 'transparent', textAlign: 'left', cursor: 'pointer' }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--paper-warm)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--terracotta)' }}>{NAV_ROUTES[key]?.icon || '·'}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontFamily: 'Kalam', color: 'var(--ink)' }}>{label}</span>
                    <span style={{ display: 'block', font: '8px JetBrains Mono', color: 'var(--ink-3)', marginTop: 1 }}>{note.toUpperCase()}</span>
                  </span>
                  <span style={{ color: 'var(--ink-3)' }}>›</span>
                </button>
              ))}
            </section>
          </React.Fragment>
        )}
      </div>

      <MobileBottomNavigation active={active} go={go} openMore={() => setMoreOpen(true)} />
    </Phone>
  );
}

window.NavigationDesktopPrototype = NavigationDesktopPrototype;
window.NavigationMobilePrototype = NavigationMobilePrototype;
