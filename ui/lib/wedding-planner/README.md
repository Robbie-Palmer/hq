# Wedding planner: accommodation

The hosted page is `/wedding-planner`. It keeps the plan in localStorage under
`wedding-planner:plan:v1`; the JSON import and export buttons move it between
browsers. An existing plan saved under `wedding-rooms:plan:v1` is copied to the
new key when the planner first loads. Do not add a real guest list to this
directory or to `public/`.

`types.ts` describes individual guests, bed groups and solver inputs.
`template.json` is this wedding's inventory, property and room names, rates,
discounts, booking status, and package figures. `setup.ts` adds the one
reservation rule that reads the existing Linen fields from the imported plan.
`state.ts` validates a plan and turns guests into bed groups. Each couple has
one fixed bed group. Single guests can share a bed only when both name each
other and neither needs their own bed. Room and cottage sharing choices are
separate and can overlap without forming global groups.

`buildInput(state, setup)` and `calculateRooms(state, setup)` accept another
`AccommodationSetup`. The solver and billing code use the resulting properties,
rooms, beds, prices, and booking rules without depending on Riverside, Linen,
or particular room counts. The result components accept the same setup for
names and room layout. `createBrowserPlannerSource(setup, storageKey)` binds a
setup to browser storage and calculation. The current editor's questions and saved Linen field
names are app-specific; a different event would supply its own editor and
reservation adapter. The injected-inventory test shows the boundary.

`solve-rooms.ts` builds the allocation model. It places higher-priority bed
groups in the included Riverside suites first, then in cottages. After those
choices it minimizes known additional accommodation cost, considers building
preferences, and avoids unnecessary bed sharing. Availability marked unknown
produces a tentative cottage booking. The bridal suite is reserved for the
couple and is not part of the imported guest list.
The optional lowest-price mode moves cost ahead of accommodation priority and
requires outside-stay estimates for every bed group.

`billing.ts` divides each booked cottage's discounted rent equally across its
occupied bedrooms, then between bed groups in a shared bedroom. Guests marked
for free accommodation, including a fixed bed partner by default, pay zero.
For cottages booked by the couple, guests reimburse the couple; the cash-flow
summary shows deposits, rent due, reimbursements and final cost separately.
Riverside suite rates are reference values in the wedding package, with no
extra venue bill.

The legacy private plan can be imported from
`tools/wedding-allocation/accommodation-state.json`. This file is ignored by
Git. The planner runs entirely in browser TypeScript and does not call a
planning API.
