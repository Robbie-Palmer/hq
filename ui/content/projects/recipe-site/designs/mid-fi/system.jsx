// mid-fi/system.jsx — shared components & data

const RECIPES = [
  { id: 'chorizo', title: 'Chicken & Chorizo Pasta Bake', cuisine: 'Italian', total: '55m', prep: '15m', cook: '40m', serves: 4, palette: ['#D67C42', '#7E2D1F'], glyph: 'pasta', tags: ['dinner','one-pot'] },
  { id: 'queso',   title: 'Chicken Quesadillas',          cuisine: 'Mexican', total: '50m', prep: '20m', cook: '30m', serves: 4, palette: ['#E2A040', '#8B4A1E'], glyph: 'tortilla', tags: ['dinner','quick'] },
  { id: 'chips',   title: 'Salt & Chilli Chips',           cuisine: 'Chinese', total: '30m', prep: '10m', cook: '20m', serves: 2, palette: ['#F0C24A', '#A56F1E'], glyph: 'chip', tags: ['savoury','quick'] },
  { id: 'slowmex', title: 'Slow Cooker Mexican Chicken',   cuisine: 'Mexican', total: '4h 15m', prep: '15m', cook: '4h', serves: 6, palette: ['#B5462E', '#5C1A0F'], glyph: 'pot', tags: ['dinner','one-pot'] },
  { id: 'pesto',   title: 'Chicken Risotto · Red Pesto',   cuisine: 'Italian', total: '40m', prep: '10m', cook: '30m', serves: 4, palette: ['#C8553D', '#7E3326'], glyph: 'risotto', tags: ['dinner'] },
  { id: 'creamy',  title: 'Creamy Chilli Tomato Pasta',    cuisine: 'Italian', total: '30m', prep: '10m', cook: '20m', serves: 3, palette: ['#D8623F', '#8A2A1B'], glyph: 'pasta', tags: ['dinner','quick'] },
  { id: 'soup',    title: 'Potato, Leek & Rosemary Soup',  cuisine: 'British', total: '45m', prep: '15m', cook: '30m', serves: 4, palette: ['#9DAE7A', '#506B3F'], glyph: 'bowl', tags: ['lunch','one-pot'] },
  { id: 'cajun',   title: 'Cajun Sausage Pasta',           cuisine: 'Cajun',   total: '35m', prep: '10m', cook: '25m', serves: 4, palette: ['#C8693C', '#742A18'], glyph: 'pasta', tags: ['dinner'] },
  { id: 'alfredo', title: 'Chicken Alfredo',               cuisine: 'Italian', total: '30m', prep: '10m', cook: '20m', serves: 4, palette: ['#E5C892', '#9C7740'], glyph: 'pasta', tags: ['dinner','quick'] },
];

const INGREDIENTS = [
  '300g farfalle (or penne)',
  '600g chicken breast, chopped',
  '1 chorizo ring, sliced',
  '3 cloves garlic, crushed',
  '1 tin cherry tomatoes (400g)',
  '1 tin chopped tomatoes (400g)',
  'small bunch fresh basil',
  '2 tsp dried oregano',
  '75g light soft cheese',
  '150g mozzarella, chopped',
  '40g parmesan, grated',
];

const STEPS = [
  { text: 'Pre-heat the oven to 200°C (fan 180°C). Salt a big pot of water and bring it to the boil.', timer: null },
  { text: 'Cook the farfalle to just-shy of al dente — it\'ll finish in the oven.', timer: 9 },
  { text: 'In a wide pan, render the chorizo over medium heat until the oil runs orange.', timer: 4 },
  { text: 'Add the chicken, season, and sear until just cooked through.', timer: 6 },
  { text: 'Tip in both tins of tomatoes, the garlic, and the oregano. Simmer to thicken.', timer: 10 },
  { text: 'Stir through the soft cheese, then fold in the drained pasta.', timer: null },
  { text: 'Top with mozzarella & parmesan. Bake until golden and bubbling.', timer: 18 },
];

// Stylised "photograph" — duotone gradient with subtle food glyph SVG.
function FoodPhoto({ palette, glyph, style, label, big }) {
  const [c1, c2] = palette || ['#C8693C','#7E2D1F'];
  return (
    <div className="mf-photo" style={{
      background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
      ...style,
    }}>
      <FoodGlyph kind={glyph} size={big ? 90 : 50} />
      {label && <span className="glyph">{label}</span>}
    </div>
  );
}

function FoodGlyph({ kind = 'pasta', size = 50 }) {
  const s = { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', opacity: 0.32, mixBlendMode: 'screen' };
  const stroke = '#FFF6E0';
  if (kind === 'pot') return <svg width={size} height={size} viewBox="0 0 60 60" style={s}><path d="M10 25 L50 25 L46 50 L14 50 Z" fill="none" stroke={stroke} strokeWidth="2"/><line x1="6" y1="22" x2="54" y2="22" stroke={stroke} strokeWidth="3"/><circle cx="22" cy="18" r="2" fill={stroke}/><circle cx="30" cy="14" r="2" fill={stroke}/><circle cx="38" cy="18" r="2" fill={stroke}/></svg>;
  if (kind === 'bowl') return <svg width={size} height={size} viewBox="0 0 60 60" style={s}><path d="M8 28 Q30 56 52 28 Z" fill="none" stroke={stroke} strokeWidth="2"/><path d="M14 22 Q22 18 30 22 T46 22" fill="none" stroke={stroke} strokeWidth="1.5"/></svg>;
  if (kind === 'chip') return <svg width={size} height={size} viewBox="0 0 60 60" style={s}><path d="M14 14 L20 46 M22 12 L24 50 M30 14 L30 48 M36 12 L38 50 M44 14 L48 48" stroke={stroke} strokeWidth="3" strokeLinecap="round"/></svg>;
  if (kind === 'tortilla') return <svg width={size} height={size} viewBox="0 0 60 60" style={s}><path d="M30 10 L52 24 L44 50 L16 50 L8 24 Z" fill="none" stroke={stroke} strokeWidth="2"/><line x1="22" y1="30" x2="38" y2="30" stroke={stroke} strokeWidth="1.5"/></svg>;
  if (kind === 'risotto') return <svg width={size} height={size} viewBox="0 0 60 60" style={s}><circle cx="30" cy="30" r="22" fill="none" stroke={stroke} strokeWidth="2"/><circle cx="22" cy="26" r="2" fill={stroke}/><circle cx="32" cy="22" r="2" fill={stroke}/><circle cx="38" cy="32" r="2" fill={stroke}/><circle cx="26" cy="36" r="2" fill={stroke}/></svg>;
  // pasta default
  return <svg width={size} height={size} viewBox="0 0 60 60" style={s}><path d="M10 30 Q15 20 22 30 T34 30 T46 30 T54 30" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round"/><path d="M10 38 Q15 28 22 38 T34 38 T46 38 T54 38" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round"/></svg>;
}

// Top nav used on every page
function Nav({ active = 'recipes' }) {
  const items = [['recipes','Recipes'], ['discover','Discover'], ['planning','Plan'], ['shop','Shop'], ['kitchen','Kitchen'], ['log','Log']];
  return (
    <nav className="mf-nav">
      <div className="mf-logo">Robbie's <em style={{ fontStyle: 'italic', color: 'var(--terracotta)' }}>recipes</em></div>
      <div style={{ display: 'flex', gap: 18, marginLeft: 16 }}>
        {items.map(([k,l]) => <a key={k} href="#" className={(active === k || (active === 'shopping' && k === 'shop')) ? 'active' : ''}>
          {l}{k === 'shop' && <span style={{ marginLeft: 5, minWidth: 17, height: 17, padding: '0 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 99, background: 'var(--terracotta)', color: 'white', font: '9px JetBrains Mono' }}>12</span>}
        </a>)}
      </div>
      <div className="mf-nav-spacer"></div>
      <div className="mf-search" style={{ minWidth: 240 }}>
        <span style={{ color: 'var(--ink-3)' }}>⌕</span>
        <input placeholder="search 47 recipes…"/>
        <span className="mf-mono" style={{ color: 'var(--ink-4)' }}>⌘K</span>
      </div>
      <DietPill />
      {typeof AvatarMenu === 'function' ? <AvatarMenu /> : <div className="mf-avatar">R</div>}
    </nav>
  );
}

// A small persistent "Diet" pill that appears in nav corners or page tops.
function DietPill() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 8px', borderRadius: 999, background: 'var(--butter-soft)', border: '1px solid var(--butter)', fontFamily: 'Kalam', fontSize: 12, cursor: 'pointer' }} title="Your diet — set once, applies everywhere. Click to edit.">
      <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--sage)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9 }}>🥗</span>
      <span style={{ color: 'var(--ink-2)' }}>your diet · veggie · no egg, shellfish</span>
      <span className="mf-mono" style={{ color: 'var(--ink-3)' }}>edit</span>
    </div>
  );
}

window.RECIPES = RECIPES;
window.INGREDIENTS = INGREDIENTS;
window.STEPS = STEPS;
window.FoodPhoto = FoodPhoto;
window.FoodGlyph = FoodGlyph;
window.Nav = Nav;
window.DietPill = DietPill;
