# Planning and shopping navigation

Status: reviewed for implementation

Work Graph ticket: `recipe-plan-shopping-information-architecture`

## Decision

Planning and Shopping are separate destinations. They share household data and
link to one another when the next action is useful, but neither is a step inside
the other.

Desktop uses six visible product destinations: Recipes, Discover, Plan, Shop,
Kitchen, and Log. Notifications stay in the header. The account menu contains
Profile, Settings, Install app, and Sign out.

Mobile and the installed PWA use a five-item bottom bar: Recipes, Plan, Shop,
Kitchen, and More. More opens a labelled destination sheet containing Discover,
Cooking log, Profile, and Settings. Notifications remain a separate header
button because their unread badge is time-sensitive. This keeps Plan and Shop
one tap away without shrinking labels or introducing horizontal scrolling.

## Destination map

| Destination | Stable route | Desktop entry | Mobile entry | Active state |
| --- | --- | --- | --- | --- |
| Recipes | `/recipes` | Primary navigation | Bottom bar | Exact route plus recipe detail, add, edit, import, and saved routes |
| Discover | `/recipes/discover` | Primary navigation | More sheet | Exact route and public cook browsing |
| Plan | `/recipes/planning` | Primary navigation | Bottom bar | Planning route and planning sub-routes |
| Shop | `/recipes/shopping` | Primary navigation | Bottom bar | Shopping route and shared-list sub-routes |
| Kitchen | `/recipes/kitchen` | Primary navigation | Bottom bar | Kitchen route and pantry or freezer sub-routes |
| Cooking log | `/recipes/log` | Primary navigation as `Log` | More sheet | Log route and individual cooking records |
| Notifications | `/recipes/notifications` | Header bell | Header bell | Notifications route; the bell retains its unread badge elsewhere |
| Profile | `/recipes/profile` | Account menu | More sheet | Profile route and public profile preview |
| Settings | `/recipes/settings` | Account menu | More sheet | Any settings route |

`Plan` and `Shop` are the short navigation labels. Page headings use `Meal plan`
and `Shopping list` so the destination is unambiguous after arrival. `Log` is
shortened only in desktop navigation. The More sheet uses `Cooking log`.

## Route and state rules

- Each destination owns its URL, document title, loading state, empty state,
  analytics page view, and reload behaviour.
- `/recipes/shopping` opens the active household list. It does not redirect to
  Planning when the plan is empty.
- `/recipes/planning` opens an agenda with the smallest useful action, `Plan one
  meal`. It does not create shopping items until the cook commits a meal.
- Recipe details remain inside the Recipes active state. Public cook pages remain
  inside Discover. Nested Settings routes keep Settings active.
- The Shop badge counts unticked list items, not selected recipes. The
  Notifications badge counts unread notifications. More shows a dot when a
  destination inside it has an unresolved state, but it does not add those
  counts together.
- Destination changes create browser-history entries. Browser Back returns to
  the previous destination or page. Closing the More sheet or account menu does
  not add history.
- Refreshing a deep link restores the same destination and server-backed
  household state. Ephemeral overlays may close on refresh.

## Entry points and cross-links

| Starting point | Action | Destination |
| --- | --- | --- |
| Recipe card or detail | `Plan this meal` | `/recipes/planning?recipe=<slug>` |
| Recipe card or detail | `Add ingredients to list` | `/recipes/shopping?recipe=<slug>` |
| Plan | `Review shopping list` | `/recipes/shopping` |
| Plan | `Add missing ingredients` | `/recipes/shopping?from=planning` |
| Shop | `Plan meals` | `/recipes/planning` |
| Shop | `Add from recipes` | Recipe picker inside Shopping; it does not leave the route |
| Kitchen | `Shop for missing items` | `/recipes/shopping?from=kitchen` |
| Notification | Destination-specific action | The destination named by the notification |

Cross-links describe the next action. They do not use numbered steps such as
`1. Plan` and `2. Shop`.

## Authentication behaviour

Logged-out visitors can open Recipes, Discover, public recipes, public cooks,
and the product explanation. Opening Plan, Shop, Kitchen, Log, Notifications,
Profile, or Settings shows sign-in at the requested URL. The return target is
preserved, so a successful sign-in resumes the original destination. Browser
Back returns to the page visited before the protected destination.

The logged-out header shows Recipes, Discover, How it works, Sign in, and Create
account. It does not show empty placeholders for household destinations.

## Responsive choice

Four mobile patterns were compared at a 390-pixel viewport.

| Pattern | Result |
| --- | --- |
| Desktop tabs in a horizontal scroller | Rejected. Off-screen destinations are hard to discover and the active item can move out of view. |
| Hamburger menu for every destination | Rejected. It hides Plan and Shop even though both are frequent, time-sensitive tasks. |
| Grouped `Home`, `Cook`, and `Household` destinations | Rejected. The group labels add a choice before every visit and make deep-link active states vague. |
| Four frequent destinations plus labelled More | Chosen. Recipes, Plan, Shop, and Kitchen stay one tap away. More gives infrequent destinations room for full labels. |

Discover moves to More on mobile because discovery is usually a browsing session,
while Plan and Shop need quick access during a week and in a shop. Cooking Log
moves to More because it is normally reached after cooking or when reviewing
history.

## Prototype walkthrough checks

The source prototype includes desktop and 390-pixel mobile artboards. The review
used pointer and keyboard walkthroughs against these scenarios.

| Scenario | Expected path | Review result |
| --- | --- | --- |
| Go straight to a shop | Open `/recipes/shopping`; the list is visible with Shop active and no planning prompt | Pass |
| Plan one meal | Open `/recipes/planning`; choose `Plan one meal`; no week setup is required | Pass |
| Return to recipes | Use Recipes in either navigation; Browser Back returns to the prior Plan or Shop page | Pass |
| Find a less frequent destination | Open More on mobile and choose the fully labelled Cooking log, Discover, Profile, or Settings item | Pass |

Keyboard review order is logo, primary destinations, notifications, account
actions, page content, then mobile bottom navigation. Visible focus, text labels,
`aria-current="page"`, and accessible badge names are implementation
requirements. The bottom bar respects device safe-area insets and leaves page
content unobscured.

## Prototype source

The interactive artboards live in `mid-fi/navigation.jsx` and are assembled in
`mid-fi/app.jsx`. They cover desktop navigation, the mobile bottom bar and More
sheet, direct Plan and Shop entry, cross-links, history behaviour, badges, and
signed-in or logged-out states.
