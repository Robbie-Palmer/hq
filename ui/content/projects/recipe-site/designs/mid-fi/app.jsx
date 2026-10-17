// mid-fi/app.jsx — design canvas assembly. Each section pairs desktop + mobile.

function App() {
  const W = 1280,H = 820,MW = 420,MH = 820;
  const [t, setTweak] = useTweaks(window.HH_TWEAK_DEFAULTS);

  return (
    <HHContext.Provider value={t}>
      <DesignCanvas>
      <DCSection id="intro" title="Robbie's Recipes — mid-fi" subtitle="every page in two viewports: desktop (1280) and mobile (notes-app feel). Click any artboard ⤢ to focus.">
        <DCArtboard id="readme" label="read me" width={520} height={460}>
          <div style={{ padding: 28, height: '100%', background: '#FAF3E2', fontFamily: 'Kalam', boxSizing: 'border-box' }}>
            <div style={{ fontFamily: 'Caveat', fontSize: 40, lineHeight: 1, color: '#1F1A14' }}>mid-fi pass · v5.</div>
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5, color: '#4D4337' }}>
              v5 separates <b>Plan</b> and <b>Shop</b> in the route and navigation model. The populated Plan uses a compact weekly agenda, so meals are prominent and empty slots do not take over the screen. Desktop and mobile now share the same labels, active states and hand-off to Shop. Open the <b>Tweaks</b> panel (top-right) to change household size, diet model, activity density and opt-out style live.
            </div>
            <div style={{ marginTop: 12, fontFamily: 'JetBrains Mono', fontSize: 11, lineHeight: 1.7, color: '#4D4337' }}>
              1 · list<br />
              2 · recipe (read ⇄ cook)<br />
              3 · scan · 4 · kitchen · 5 · plan + shop<br />
              6 · share · 7 · cookbooks · 8 · profile · 9 · diet<br />
              <b>10 · household ←</b> new in this pass
            </div>
            <div style={{ marginTop: 12, fontFamily: 'Caveat', fontSize: 18, color: '#A04F26' }}>
              jump to "10 · Household" below ↓
            </div>
          </div>
        </DCArtboard>
      </DCSection>

      <DCSection id="list" title="1 · Recipe list" subtitle="the recipe box. Tri-state filter chips for per-search exclusion + a global Diet pill for the always-on stuff.">
        <DCArtboard id="list" label="desktop · recipe list" width={W} height={H}><MidList /></DCArtboard>
        <DCArtboard id="list-mobile" label="mobile · recipe list" width={MW} height={MH}><MobileList /></DCArtboard>
      </DCSection>

      <DCSection id="recipe" title="2 · Recipe page (A → B)" subtitle="read view by default · with lineage chip + honest-signal stats + SEO credit + fork/suggest actions baked in. The layout shifts by context: stats are compact in your own collection, prominent when browsing others' recipes. Tap 'start cooking' to flip into cooking-mode — try it on either viewport, the timer is live.">
        <DCArtboard id="recipe" label="desktop · IN YOUR BOX · compact signal · cooking actions prominent" width={W} height={1100}><MidRecipeWithToggle /></DCArtboard>
        <DCArtboard id="recipe-browsing" label="desktop · BROWSING someone else's · stats prominent · 'add to my recipes' CTA" width={W} height={1100}><MidRecipeBrowsing /></DCArtboard>
        <DCArtboard id="recipe-mobile" label="mobile · recipe (read ⇄ cook · swipe steps)" width={MW} height={MH}><MobileRecipe /></DCArtboard>
      </DCSection>

      <DCSection id="scan" title="3 · Scan / add" subtitle="photo, URL or paste — with a live preview-as-real-recipe panel on desktop, and a viewfinder on mobile.">
        <DCArtboard id="scan" label="desktop · scan & URL import" width={W} height={H}><MidScan /></DCArtboard>
        <DCArtboard id="scan-mobile" label="mobile · camera-first scan" width={MW} height={MH}><MobileScan /></DCArtboard>
      </DCSection>

      <DCSection id="kitchen" title="4 · Kitchen (pantry + freezer)" subtitle="binary stock tracking. Pantry chips toggle in/out · Freezer with eat-by dates. 'What can I make' surfaces recipes you can cook now (or with just X more items), and Eat Soon nudges what's expiring.">
        <DCArtboard id="kitchen" label="desktop · pantry + freezer + 'what can I make'" width={W} height={H}><MidKitchen /></DCArtboard>
        <DCArtboard id="kitchen-mobile" label="mobile · kitchen" width={MW} height={MH}><MobileKitchen /></DCArtboard>
      </DCSection>

      <DCSection id="shopping" title="5 · Plan and shop" subtitle="independent, populated destinations. Plan is a dense weekly agenda instead of a mostly empty calendar; Shop stays a fast, notes-like checklist.">
        <DCArtboard id="planning" label="desktop · populated weekly agenda" width={W} height={H}><MealPlanAgendaDesktop /></DCArtboard>
        <DCArtboard id="shopping" label="desktop · active shopping list" width={W} height={H}><ShoppingListDesktop /></DCArtboard>
        <DCArtboard id="shopping-mobile-plan" label="mobile · populated weekly agenda" width={MW} height={MH}><MealPlanAgendaMobile /></DCArtboard>
        <DCArtboard id="shopping-mobile" label="mobile · active shopping list" width={MW} height={MH}><MidShoppingMobile /></DCArtboard>
      </DCSection>

      <DCSection id="navigation-ia" title="5a · Planning and shopping navigation" subtitle="Plan and Shop are independent destinations; mobile keeps both in a compact bottom bar with labelled More for less frequent destinations.">
        <DCArtboard id="navigation-desktop" label="desktop · six destinations + account utilities" width={W} height={H}><NavigationDesktopPrototype /></DCArtboard>
        <DCArtboard id="navigation-mobile" label="mobile · four destinations + More" width={MW} height={MH}><NavigationMobilePrototype /></DCArtboard>
      </DCSection>

      <DCSection id="share" title="6 · Share" subtitle="desktop is link + previews + send-to. Mobile is the native share-sheet feel — OG card, social icons, recent contacts.">
        <DCArtboard id="share" label="desktop · share & OG previews" width={W} height={H}><MidShare /></DCArtboard>
        <DCArtboard id="share-mobile" label="mobile · share half-sheet" width={MW} height={MH}><MobileShare /></DCArtboard>
      </DCSection>

      <DCSection id="cookbooks" title="7 · Cookbooks" subtitle="collections styled as actual books — each with its own visibility (private / household / friends / public).">
        <DCArtboard id="cookbooks" label="desktop · cookbooks grid" width={W} height={H}><MidCookbooks /></DCArtboard>
        <DCArtboard id="cookbooks-mobile" label="mobile · cookbooks (2-up)" width={MW} height={MH}><MobileCookbooks /></DCArtboard>
      </DCSection>

      <DCSection id="profile" title="8 · Public profile (with household + meals-fed + badges)" subtitle="the social face. Meals-fed headline with provenance breakdown (yourself / fresh for others / from your freezer), badges with earned + in-progress, the household card, recipes.">
        <DCArtboard id="profile" label="desktop · public profile + household" width={W} height={1080}><MidProfileWithHousehold viewer="self" /></DCArtboard>
        <DCArtboard id="profile-badge-story" label="badge story sheet · what 'tap for the story' opens" width={620} height={760}><BadgeStorySheet b={FEEDER_STORY} /></DCArtboard>
        <DCArtboard id="profile-mobile" label="mobile · public profile" width={MW} height={MH}><MobileProfile /></DCArtboard>
      </DCSection>

      <DCSection id="diet" title="9 · Your Diet (persistent, profile-wide)" subtitle="set it once — vegetarian, no egg — and it filters every list, search, and shopping plan. Separate from per-search filter chips.">
        <DCArtboard id="diet" label="desktop · diet settings" width={W} height={H}><MidDiet /></DCArtboard>
        <DCArtboard id="diet-mobile" label="mobile · diet settings" width={MW} height={MH}><MobileDiet /></DCArtboard>
      </DCSection>

      {/* ── NEW: shared household ─────────────────────────────────── */}
      <DCSection id="household-intro" title="10 · Shared household (NEW)" subtitle="pantry, freezer, plan & shopping become collaborative. Recipes & cookbooks pick up a 4th visibility level. Each person keeps their own diet; cook picks who a meal is for. Three sub-sections below.">
        <DCArtboard id="hh-readme" label="read me · the model" width={760} height={520}>
          <div style={{ padding: 28, height: '100%', background: '#FAF3E2', fontFamily: 'Kalam', boxSizing: 'border-box', overflow: 'auto' }}>
            <div style={{ fontFamily: 'Caveat', fontSize: 44, lineHeight: 1, color: '#1F1A14' }}>shared household.</div>
            <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5, color: '#4D4337' }}>
              <b>Small families (2–4)</b> · shared: <b>pantry · freezer · shopping · plan</b> · diet resolves as <b>cook picks who → optional swap for any outlier</b> · opt-out per <b>slot / recurring / range</b> · slots can hold <b>multiple parallel cook sessions</b> (different diets, off-schedule, picky kids) · activity feed (no locking) · who-cooks <b>optional</b> · roles: <b>owner / member / guest (view-only, keeps own primary household)</b> · one primary household per account · recipes & cookbooks gain <b>household</b> as a 4th visibility level · profile household card is <b>per-member public/private</b> (members always see everyone).
            </div>
            <hr className="mf-rule" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <div>
                <div className="mf-mono" style={{ color: '#A04F26' }}>SHARED · FLOWS BETWEEN MEMBERS</div>
                <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13, lineHeight: 1.5, color: '#4D4337' }}>
                  <li>🧂 Pantry — last-write-wins, activity feed logs every flip</li>
                  <li>❄️ Freezer — anyone can add / mark eaten</li>
                  <li>🛒 Shopping list — one bag per week, anyone ticks</li>
                  <li>📅 Meal plan + calendar — opt-out per slot / recurring / range</li>
                </ul>
              </div>
              <div>
                <div className="mf-mono" style={{ color: '#A04F26' }}>PERSONAL · LIVES ON YOU</div>
                <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13, lineHeight: 1.5, color: '#4D4337' }}>
                  <li>📖 Recipe box — visibility per recipe: private · household · friends · public</li>
                  <li>📚 Cookbooks — same 4-level visibility per book</li>
                  <li>🥗 Diet profile — each person their own; cook picks per meal</li>
                  <li data-comment-anchor="cc3bf01bc3-input-105-11">📷 Scan history · activity prefs · notification rules</li>
                </ul>
              </div>
            </div>
            <hr className="mf-rule" />
            <div className="mf-mono" style={{ color: '#A04F26' }}>OPEN PRECEDENTS</div>
            <div style={{ fontSize: 12.5, color: '#4D4337', lineHeight: 1.5, marginTop: 4 }}>
              Closest models in the wild: <b>Apple Family / Reminders</b> (shared lists overlay personal) · <b>Notion teamspaces</b> (a "space" you join, content stays attached to people) · <b>Splitwise groups</b> (membership stack with per-event opt-outs) · <b>Spotify Blend</b> (shared output, individual taste profiles).
              <br />Our choice: <b>surfaces, not containers</b> — each surface (pantry, plan…) decides who can see/write. Visibility on recipes/cookbooks gets a 4th option, so authorship stays personal but you can quietly publish to the household.
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#F4ECD6', borderRadius: 8, fontFamily: 'Caveat', fontSize: 18, color: '#A04F26' }}>
              try the Tweaks panel ↗ — flip "household size" between 1 / 2 / 4 / 6 and watch the artboards re-cast.
            </div>
          </div>
        </DCArtboard>
      </DCSection>

      <DCSection id="household-setup" title="10a · Household setup" subtitle="three steps in one screen, with the 'you got invited' receiver-side at the bottom. Link and QR are equal-weight (you asked for both).">
        <DCArtboard id="hh-setup" label="desktop · create or join" width={W} height={920}><HouseholdSetup /></DCArtboard>
        <DCArtboard id="hh-setup-mobile" label="mobile · setup step 2" width={MW} height={MH}><MobileHouseholdSetup /></DCArtboard>
      </DCSection>

      <DCSection id="household-settings" title="10b · Household settings" subtitle="members, roles (owner / member / guest), pending invites, shared-surface toggles, danger zone.">
        <DCArtboard id="hh-settings" label="desktop · settings · household tab" width={W} height={900} data-comment-anchor="f1d4bde045-div-69-17"><HouseholdSettings /></DCArtboard>
        <DCArtboard id="hh-settings-mobile" label="mobile · settings · household" width={MW} height={MH}><MobileHouseholdSettings /></DCArtboard>
      </DCSection>

      <DCSection id="household-profile" title="10c · Profile with household card" subtitle="three views of the same profile: yourself (with visibility control), a household-member viewing it, and an outsider — who only sees members who've set their household to public.">
        <DCArtboard id="hh-profile" label="profile · as YOU see it" width={W} height={1080}><MidProfileWithHousehold viewer="self" /></DCArtboard>
        <DCArtboard id="hh-profile-member" label="profile · as a household MEMBER sees it" width={W} height={1080}><MidProfileWithHousehold viewer="member" /></DCArtboard>
        <DCArtboard id="hh-profile-outsider" label="profile · as an OUTSIDER sees it (public members only)" width={W} height={1080}><MidProfileWithHousehold viewer="outsider" /></DCArtboard>
      </DCSection>

      <DCSection id="household-pantry" title="10d · Shared Pantry" subtitle="every chip shows who flipped it last; freshly-flipped chips ring in sage. Live activity feed on the right · no locking, no blocking — your answer.">
        <DCArtboard id="hh-pantry" label="desktop · pantry · shared" width={W} height={900}><MidPantryShared /></DCArtboard>
        <DCArtboard id="hh-pantry-mobile" label="mobile · pantry · shared" width={MW} height={MH}><MobilePantryShared /></DCArtboard>
      </DCSection>

      <DCSection id="household-shopping" title="10e · Shared meal plan & shopping" subtitle="opt-outs per slot show as struck-through avatars (or rail / banner — tweak it). Cooking-for popover scales ingredients · who-cooks is optional. Range opt-outs auto-resize the bag. Wed dinner shows a SPLIT slot — two parallel cook sessions in one calendar cell.">
        <DCArtboard id="hh-plan" label="desktop · shared plan + opt-outs + scaling" width={W} height={900}><MidShoppingShared /></DCArtboard>
        <DCArtboard id="hh-plan-mobile" label="mobile · shared plan" width={MW} height={MH}><MobileShoppingShared /></DCArtboard>
      </DCSection>

      <DCSection id="household-leftovers" title="10f · Leftover suggestions" subtitle="cook a bit more, eat it next week. Three beats: (1) the planning prompt, (2) what lands in the SHARED freezer (no owner — anyone can take a portion), (3) those portions auto-offered as fillers for empty future slots.">
        <DCArtboard id="hh-leftovers" label="desktop · leftover flow" width={W} height={760}><HouseholdLeftoverSuggestion /></DCArtboard>
      </DCSection>

      <DCSection id="household-activity" title="10g · Activity feed (detailed)" subtitle="full-density version for the dedicated screen. Compact version lives in the pantry/plan sidebars; tweakable. Filter chips are interactive.">
        <DCArtboard id="hh-activity" label="desktop · activity & notifications" width={W} height={760}><HouseholdActivity /></DCArtboard>
        <DCArtboard id="hh-activity-mobile" label="mobile · activity feed" width={MW} height={MH}><MobileHouseholdActivity /></DCArtboard>
      </DCSection>

      {/* ── 11 · RECIPE PROVENANCE / LINEAGE ──────────────────── */}
      <DCSection id="provenance" title="11 · Recipe lineage (NEW)" subtitle="every recipe travels — BBC URL → Mum → you → forks downstream. Refines / forks / suggestions / upstream sync. The CANONICAL recipe page (section 2 ↑) now carries the lineage chip + honest-signal stats + SEO credit + fork/suggest actions — these are the same on every recipe page. The artboards below cover everything else.">
        <DCArtboard id="prov-readme" label="read me · the model" width={820} height={1200}><ProvenanceReadme /></DCArtboard>
        <DCArtboard id="prov-tree" label="lineage tree · full visual graph" width={W} height={900}><LineageTree /></DCArtboard>
        <DCArtboard id="prov-fork" label="fork & edit · live diff against parent" width={W} height={920}><ForkAndDiff /></DCArtboard>
        <DCArtboard id="prov-suggest" label="suggest upstream · review-style fix" width={W} height={820}><SuggestUpstream /></DCArtboard>
        <DCArtboard id="prov-sync" label="upstream sync · pull updates into your fork" width={W} height={900}><UpstreamSync /></DCArtboard>
        <DCArtboard id="prov-ingest" label="ingest · detection-first origin capture" width={W} height={720}><IngestWithOrigin /></DCArtboard>
        <DCArtboard id="prov-books" label="published books · domain registry + cover capture" width={W} height={900}><PublishedBooks /></DCArtboard>
      </DCSection>

      {/* ── 12 · COOK LOG & INSIGHTS ──────────────────────────── */}
      <DCSection id="cooklog" title="12 · Cook log & insights (NEW)" subtitle="the personal/household mirror of the social signals: track what you've cooked & when → variety/balance (framed around what's NEW), a rankable recency matrix (sort by least-recent / most / least made, with a configurable window), what's in heavy rotation, and a 'last cooked X ago' freshness signal. Auto-logged from cooking mode + manual catch-up. Per-member filter is live; flip household size in Tweaks.">
        <DCArtboard id="cl-readme" label="read me · the model + your nav question" width={860} height={980}><CookLogReadme /></DCArtboard>
        <DCArtboard id="cl-dashboard" label="desktop · cook log · try the member filter + matrix sort/period" width={1280} height={1120}><MidCookLogDashboard /></DCArtboard>
        <DCArtboard id="cl-mobile" label="mobile · cook log (tabbed)" width={390} height={844}><MobileCookLog /></DCArtboard>
      </DCSection>

      {/* ── 13 · BEFORE YOU SIGN UP (public, browsable) ──────────── */}
      <DCSection id="welcome" title="13 · Before you sign up + Discover feed (NEW)" subtitle="logged-out home = the real product, browsable. Hero leads with social proof + honest signal (NOT provenance — that's demoted to a supporting proof point). 'browse the feed — no account' opens the DISCOVER FEED: friends' activity, trending, picks tuned to your diet. The feed is a SHARED destination — also a logged-in 'Discover' nav tab (see the signed-in variant). Sign-in (Google) stays just-in-time: tap ♡ / cook / follow.">
        <DCArtboard id="welcome-readme" label="read me · the model" width={560} height={460}>
          <div style={{ padding: 28, height: '100%', background: '#FAF3E2', fontFamily: 'Kalam', boxSizing: 'border-box', overflow: 'auto' }}>
            <div style={{ fontFamily: 'Caveat', fontSize: 40, lineHeight: 1, color: '#1F1A14' }}>browse free · sign in to keep.</div>
            <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.5, color: '#4D4337' }}>
              No wall. Anyone can search 12k recipes, read them, follow lineage. An account exists for one reason: <b>a place to keep your own stuff</b> — saved recipes, kitchen stock, weekly plan, household.
            </div>
            <hr className="mf-rule" />
            <div className="mf-mono" style={{ color: '#A04F26' }}>SIGN-IN IS JUST-IN-TIME</div>
            <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13, lineHeight: 1.6, color: '#4D4337' }}>
              <li>tap <b>♡ save</b> → the Google sheet appears, with the recipe right there</li>
              <li>tap <b>🔥 cook</b> or <b>📅 plan</b> → same sheet, copy adapts to the action</li>
              <li>"keep browsing →" always dismisses it — never a hard gate</li>
            </ul>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#F4ECD6', borderRadius: 8, fontFamily: 'Caveat', fontSize: 18, color: '#A04F26' }}>
              two directions on the right — hover a card & hit ♡ to see the moment ↗
            </div>
          </div>
        </DCArtboard>
        <DCArtboard id="welcome-b" label="desktop · logged-out HOME · editorial, social-led" width={W} height={1180}><MidWelcomeEditorial /></DCArtboard>
        <DCArtboard id="feed-out" label="desktop · DISCOVER FEED · what 'browse the feed — no account' opens (logged-out)" width={W} height={1480}><MidDiscoverFeed signedIn={false} /></DCArtboard>
        <DCArtboard id="feed-in" label="desktop · DISCOVER FEED · same place, logged-in (the Discover nav tab)" width={W} height={1480}><MidDiscoverFeed signedIn={true} /></DCArtboard>
        <DCArtboard id="welcome-jit" label="the just-in-time sign-in card (triggered by save/cook/plan)" width={440} height={520}>
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#2a2520', padding: 16 }}><JITAuthCard action="save" embedded /></div>
        </DCArtboard>
        <DCArtboard id="welcome-mobile" label="mobile · logged-out home" width={MW} height={MH}><MobileWelcome /></DCArtboard>
        <DCArtboard id="feed-mobile" label="mobile · discover feed (logged-out)" width={MW} height={MH}><MobileDiscoverFeed signedIn={false} /></DCArtboard>
        <DCArtboard id="feed-mobile-in" label="mobile · discover feed (logged-in)" width={MW} height={MH}><MobileDiscoverFeed signedIn={true} /></DCArtboard>
      </DCSection>

      {/* ── 14 · ONBOARDING — SEED TO FILL ───────────────────────── */}
      <DCSection id="onboarding" title="14 · Onboarding · seed to fill (NEW)" subtitle="the whole job of onboarding here is to POPULATE content so a new account never opens onto emptiness. Short guided flow: Google → diet (skippable) → fill your box (4 levers: pick starters / paste a link / scan a photo / starter cookbooks) → land on a first-run home that's already full. The flow is interactive — click through it. The 'empty trap' artboard shows what we're avoiding.">
        <DCArtboard id="onb-readme" label="read me · the model" width={560} height={460}>
          <div style={{ padding: 28, height: '100%', background: '#FAF3E2', fontFamily: 'Kalam', boxSizing: 'border-box', overflow: 'auto' }}>
            <div style={{ fontFamily: 'Caveat', fontSize: 40, lineHeight: 1, color: '#1F1A14' }}>seed, don't strand.</div>
            <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.5, color: '#4D4337' }}>
              A content app is only as good as its content. So onboarding's #1 job is getting recipes <b>in</b> — fast — using the levers the product already has.
            </div>
            <hr className="mf-rule" />
            <div className="mf-mono" style={{ color: '#A04F26' }}>WHAT'S UPFRONT vs DEFERRED</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: '#4D4337', marginTop: 4 }}>
              <b>In the flow:</b> sign in · diet · seed recipes.<br />
              <b>Deferred to first-run home</b> (as dismissible prompt cards): stock kitchen · plan a week · invite household. They fill in over time, so nothing is a gate.
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#F4ECD6', borderRadius: 8, fontFamily: 'Caveat', fontSize: 18, color: '#A04F26' }}>
              click through the live flow ↗ — add 3+ and watch the box tray fill.
            </div>
          </div>
        </DCArtboard>
        <DCArtboard id="onb-flow" label="desktop · the live flow (click through all 4 steps)" width={W} height={860}><MidOnboarding /></DCArtboard>
        <DCArtboard id="onb-firstrun" label="desktop · FIRST-RUN HOME · seeded + prompt cards (the payoff)" width={W} height={1020}><FirstRunHome /></DCArtboard>
        <DCArtboard id="onb-empty" label="✗ the empty trap · what we're avoiding" width={560} height={620}><EmptyTrap /></DCArtboard>
        <DCArtboard id="onb-mobile" label="mobile · onboarding flow (opens on seed step)" width={MW} height={MH}><MobileOnboarding /></DCArtboard>
        <DCArtboard id="onb-firstrun-mobile" label="mobile · first-run home" width={MW} height={MH}><MobileFirstRun /></DCArtboard>
      </DCSection>

      {/* ── 15 · RECOMMENDED TO YOU (NEW) ─────────────────────── */}
      <DCSection id="recommend" title="15 · Recommended to you (NEW)" subtitle="the RECEIVING side of a person→you recipe hand-off — distinct from the algorithmic ✨ picks in Discover. IA: it lives as a TAB inside the Recipes space (My recipe box · Recommended · Cookbooks) with an unread badge — that's why 'Recipes' is the active nav item. The 🔔 bell is the ambient way in and deep-links to this tab. Senders are people you FOLLOW or your HOUSEHOLD (household pinned + sage). Note is optional; recipe is the hero. Actions: Save to box · Add to plan · Cook now · thanks. Tweaks: count (empty / one / several), notes on-off, sender mix.">
        <DCArtboard id="rec-readme" label="read me · the model" width={560} height={520}>
          <div style={{ padding: 28, height: '100%', background: '#FAF3E2', fontFamily: 'Kalam', boxSizing: 'border-box', overflow: 'auto' }}>
            <div style={{ fontFamily: 'Caveat', fontSize: 40, lineHeight: 1, color: '#1F1A14' }}>someone passed you a recipe.</div>
            <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.5, color: '#4D4337' }}>
              A <b>recommendation</b> is a deliberate person→you hand-off. It's <i>not</i> the algorithmic ✨ “picks for you” in Discover — a real person chose it and (optionally) wrote you a note. Sent recipes are kept <b>separate from your box</b> until you save them.
            </div>
            <hr className="mf-rule" />
            <div className="mf-mono" style={{ color: '#A04F26' }}>WHERE IT SHOWS UP</div>
            <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13, lineHeight: 1.6, color: '#4D4337' }}>
              <li><b>Inbox</b> — the primary home (“Recommended to you”). Three directions →</li>
              <li><b>🔔 Bell</b> — recommendation is the showcase notification type</li>
              <li><b>Home card</b> — a nudge on the first-run / home</li>
            </ul>
            <hr className="mf-rule" />
            <div className="mf-mono" style={{ color: '#A04F26' }}>WHO + WHAT</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: '#4D4337', marginTop: 4 }}>
              From people you <b>follow</b> or your <b>household</b> (household pinned + sage). Note is <b>optional</b>, recipe is the hero. Do: <b>Save · Plan · Cook</b> · say thanks · dismiss.
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#F4ECD6', borderRadius: 8, fontFamily: 'Caveat', fontSize: 18, color: '#A04F26' }}>
              open Tweaks ↗ — flip count / notes / sender mix and watch every artboard re-cast.
            </div>
          </div>
        </DCArtboard>
        <DCArtboard id="rec-stack" label="desktop INBOX · the stack — note-forward, household pinned, under the Recipes › Recommended tab" width={W} height={1220}><RecInboxStack /></DCArtboard>
        <DCArtboard id="rec-bell" label="entry · 🔔 notification bell · recommendation is the showcase type, deep-links to the tab" width={760} height={620}><NotifBellDemo /></DCArtboard>
        <DCArtboard id="rec-home" label="entry · homepage prompt card" width={560} height={420}><RecHomeCard /></DCArtboard>
        <DCArtboard id="rec-mobile" label="mobile · recommendations inbox (the stack)" width={MW} height={MH}><MobileRecInbox /></DCArtboard>
      </DCSection>

      {/* ── 16 · NOTIFICATIONS SYSTEM (NEW) ───────────────────────── */}
      <DCSection id="notifications" title="16 · Notifications system (NEW)" subtitle="the full system behind the 🔔 bell. Taxonomy is product-specific: Recommendations · Social (follows/cheers/comments) · Household · Your recipes (forks/suggested edits/upstream sync) · Milestones. Beyond redirecting to source, three views come out of it: (1) the full Notifications PAGE — the bell's 'see all' archive, grouped by time + filterable by category; (2) notification PREFERENCES — channels (in-app/push/email) + a daily-digest frequency for noisy household activity; (3) INLINE actions on types that resolve without a redirect — follow back, save a rec, review a suggested edit, pull an upstream update. Try the filter chips & the preference toggles.">
        <DCArtboard id="notif-readme" label="read me · the model + your nav question" width={620} height={560}>
          <div style={{ padding: 28, height: '100%', background: '#FAF3E2', fontFamily: 'Kalam', boxSizing: 'border-box', overflow: 'auto' }}>
            <div style={{ fontFamily: 'Caveat', fontSize: 40, lineHeight: 1, color: '#1F1A14' }}>the bell is a peek. the page is the archive.</div>
            <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.5, color: '#4D4337' }}>
              You asked: beyond redirecting people to where things happened, what else needs to exist? <b>Three things.</b>
            </div>
            <hr className="mf-rule" />
            <div className="mf-mono" style={{ color: '#A04F26' }}>1 · A FULL NOTIFICATIONS PAGE</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: '#4D4337', marginTop: 2 }}>The 🔔 dropdown is a quick peek (last few). “See all” opens the managed archive — grouped Today / This week / Earlier, filterable by category, read/unread.</div>
            <div className="mf-mono" style={{ color: '#A04F26', marginTop: 10 }}>2 · NOTIFICATION PREFERENCES</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: '#4D4337', marginTop: 2 }}>Per-category channels (in-app / push / email). Household activity especially needs a <b>daily digest</b> so it doesn’t flood the bell.</div>
            <div className="mf-mono" style={{ color: '#A04F26', marginTop: 10 }}>3 · INLINE ACTIONS (no redirect needed)</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: '#4D4337', marginTop: 2 }}>A few types resolve in place: <b>follow back · save a rec · review a suggested edit · pull an upstream update</b> (the last two plug straight into the lineage system). Everything else deep-links.</div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#F4ECD6', borderRadius: 8, fontFamily: 'Caveat', fontSize: 18, color: '#A04F26' }}>
              the bell + recommendations inbox from section 15 are the same system — this is the rest of it.
            </div>
          </div>
        </DCArtboard>
        <DCArtboard id="notif-bell" label="entry · 🔔 bell dropdown (the peek) — now links to page + settings" width={760} height={680}><NotifBellDemo /></DCArtboard>
        <DCArtboard id="notif-page" label="VIEW 1 · desktop · full notifications page — try the category filter chips" width={W} height={1140}><NotificationsPage /></DCArtboard>
        <DCArtboard id="notif-prefs" label="VIEW 2 · desktop · notification preferences — toggle channels + household digest" width={860} height={860}><NotifPrefs /></DCArtboard>
        <DCArtboard id="notif-mobile" label="mobile · notifications page (filter chips scroll)" width={MW} height={MH}><MobileNotifications /></DCArtboard>
      </DCSection>

      {/* ── 17 · SETTINGS & ACCOUNT (NEW) ─────────────────────────── */}
      <DCSection id="settings" title="17 · Settings & account (NEW)" subtitle="the unified Settings hub — reached from the avatar dropdown (now on every page's nav) AND a ⚙ button on your profile. Left sidebar + content pane; it ABSORBS the pages that already existed (Your diet §9, Notification prefs §16, Household §10b) as sections, and adds Account · Sign-in · Units · Default visibility · Cooking mode · Privacy · Data. The HEADLINE is 'Units & measurements': convert every recipe on the fly (display-only, original kept), with a custom unit LADDER — add the units you use (tsp, tbsp, ml, litres…) and drag where each hands off to the next. The ruler control sits on its own in 17a. Tweaks: flip the starting preset and the default visibility — every artboard re-casts.">
        <DCArtboard id="set-readme" label="read me · the model + entry points" width={620} height={620}>
          <div style={{ padding: 28, height: '100%', background: '#FAF3E2', fontFamily: 'Kalam', boxSizing: 'border-box', overflow: 'auto' }}>
            <div style={{ fontFamily: 'Caveat', fontSize: 40, lineHeight: 1, color: '#1F1A14' }}>one hub. reached two ways.</div>
            <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.5, color: '#4D4337' }}>
              You asked: a settings page off the profile, with <b>default units</b> front and centre — presets (US/UK/metric) <i>and</i> a custom unit ladder (tsp → tbsp → ml → litres, your thresholds). Plus a home for the orphaned notification prefs, and whatever else belongs.
            </div>
            <hr className="mf-rule" />
            <div className="mf-mono" style={{ color: '#A04F26' }}>HOW YOU GET THERE</div>
            <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13, lineHeight: 1.6, color: '#4D4337' }}>
              <li><b>Avatar dropdown</b> (top-right of every nav) → Settings · profile · diet · household · log out</li>
              <li><b>⚙ settings</b> button on your own profile</li>
            </ul>
            <div className="mf-mono" style={{ color: '#A04F26', marginTop: 12 }}>UNITS — THE HEADLINE</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: '#4D4337', marginTop: 2 }}>
              Pick a system, then build a <b>ladder</b> per dimension. <b>Weight</b> & <b>volume</b> take any number of units with draggable thresholds between them (tsp→tbsp→ml→litres); <b>length</b> & <b>oven temp</b> are single-choice. Conversion is <b>display-only</b> — the original is always kept. The ruler control, up close ↓
            </div>
            <div className="mf-mono" style={{ color: '#A04F26', marginTop: 12 }}>ALSO IN THE HUB</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4D4337', marginTop: 2 }}>
              Account · Sign-in (linked accounts) · Default visibility (recipes / cookbooks / household card) · Diet (was §9) · Cooking mode · Notifications (was §16) · Household (links to §10b) · Privacy · Data & danger zone.
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#F4ECD6', borderRadius: 8, fontFamily: 'Caveat', fontSize: 18, color: '#A04F26' }}>
              open Tweaks ↗ — flip units style / preset / default visibility & watch it re-cast.
            </div>
          </div>
        </DCArtboard>
        <DCArtboard id="set-menu" label="entry · avatar dropdown (open) — on every page's nav now" width={420} height={460}>
          <div style={{ height: '100%', background: '#FAF3E2', display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', padding: '20px 28px' }}>
            <div className="mf"><AvatarMenu open={true} /></div>
          </div>
        </DCArtboard>
        <DCArtboard id="set-hub" label="desktop · SETTINGS HUB · fully interactive — click any section in the sidebar. Opens on Units (the headline)." width={W} height={1000}><SettingsHub start="units" /></DCArtboard>
      </DCSection>

      <DCSection id="units-variations" title="17a · Units control — the ruler, up close" subtitle="the headline control on its own so you can play. It's now a LADDER, not a binary switch — add the units you use with the chips (tsp, tbsp, ml, litres…), then drag the dividers to set where each hands off to the next. The bar is a log scale so a teaspoon and a litre both get a visible band. Length & oven temp stay single-choice. Mirrors the control inside the hub above.">
        <DCArtboard id="units-ruler" label="THE RULER · chips add/remove units · drag the dividers" width={600} height={920}><UnitsVariantDemo /></DCArtboard>
      </DCSection>

      <DCSection id="settings-mobile" title="17b · Settings — mobile" subtitle="fully interactive — the index drills into each section (iOS-settings feel); tap a row to open it, ← settings to come back. Opens on the index.">
        <DCArtboard id="set-mobile" label="mobile · settings — tap any row to drill in" width={MW} height={MH}><MobileSettings start="index" /></DCArtboard>
      </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks · household">
        <TweakSection label="Settings · units" />
        <TweakSelect
          label="Starting preset"
          value={t.unitPreset}
          options={[
          { value: 'metric', label: 'Metric · tsp · ml · L · °C' },
          { value: 'uk', label: 'UK · tsp · ml · L · gas' },
          { value: 'us', label: 'US · tsp · tbsp · cups · °F' }]
          }
          onChange={(v) => setTweak('unitPreset', v)} />
        <TweakSection label="Settings · sharing" />
        <TweakRadio
          label="New recipes default to"
          value={t.defaultVisibility}
          options={[
          { value: 'private', label: 'private' },
          { value: 'household', label: 'household' },
          { value: 'friends', label: 'friends' },
          { value: 'public', label: 'public' }]
          }
          onChange={(v) => setTweak('defaultVisibility', v)} />
        <TweakSection label="Recommended to you" />
        <TweakRadio
          label="In your inbox"
          value={t.recCount}
          options={[
          { value: 'empty', label: 'empty' },
          { value: 'one', label: 'one' },
          { value: 'several', label: 'several' }]
          }
          onChange={(v) => setTweak('recCount', v)} />
        <TweakToggle
          label="Show personal notes"
          value={t.recNotes}
          onChange={(v) => setTweak('recNotes', v)} />
        <TweakRadio
          label="Senders"
          value={t.recSenders}
          options={[
          { value: 'both', label: 'both' },
          { value: 'household', label: 'household' },
          { value: 'follow', label: 'follow' }]
          }
          onChange={(v) => setTweak('recSenders', v)} data-comment-anchor="656eb35590-div-259-21" />
        <TweakSection label="Household" />
        <TweakRadio
          label="Members"
          value={t.householdSize}
          options={[1, 2, 4, 6]}
          onChange={(v) => setTweak('householdSize', v)} />
        <TweakSection label="Shared plan" />
        <TweakSelect
          label="Opt-out UI"
          value={t.optOutStyle}
          options={[
          { value: 'inline-badge', label: 'inline · strike avatar' },
          { value: 'rail', label: 'rail · "out" row' },
          { value: 'banner', label: 'banner · range only' }]
          }
          onChange={(v) => setTweak('optOutStyle', v)} />
        <TweakSection label="Activity feed" />
        <TweakRadio
          label="Density"
          value={t.activityDensity}
          options={['hidden', 'compact', 'full']}
          onChange={(v) => setTweak('activityDensity', v)} />
      </TweaksPanel>
    </HHContext.Provider>);

}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
