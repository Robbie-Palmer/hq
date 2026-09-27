# Idea map for The Philosophy of Data Science

This map audits the concepts used in
[`The Philosophy of Data Science`](../../ui/content/blog/2022-03-02-the-philosophy-of-data-science.mdx).
It separates reusable ideas from names that only organize the essay. The line references below refer to the current
source file.

## Selection rules

An idea page should explain a concept that can be used outside this essay, has a defensible primary or scholarly
source, and has useful relationships with the existing idea graph. A section heading in the essay is not enough.
Named schools stay in the essay unless readers would gain a reusable reasoning tool from a separate page.

The map uses three decisions:

* **Link** means an existing page already covers the concept.
* **Publish** means the concept belongs in the first small batch of new pages.
* **Hold** or **reject** means do not create a page now. Hold keeps a plausible later candidate. Reject keeps a term
  in the essay or folds it into a broader page.

## Existing ideas

| Concept | Source passage | Idea slug | Related ideas | Authoritative reading | Decision |
| --- | --- | --- | --- | --- | --- |
| Epistemology | Lines 11 to 13 define data science through knowledge. Lines 37 to 46 ask practitioners to expose and challenge how they know. | `epistemology` | `theory-ladenness`, `falsifiability` | [Stanford Encyclopedia of Philosophy, Epistemology](https://plato.stanford.edu/entries/epistemology/) | **Link.** This is the essay's broadest frame and should be added to its `ideas` metadata. |
| Bounded context | Lines 631 to 640 argue that a domain can maintain its own language and absorb change at its boundary. | `bounded-context` | `domain-driven-design`, `data-mesh`, `incommensurability` | [Martin Fowler, Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) | **Link.** The existing page is a better explanation than a philosophy-specific duplicate. The Kuhn comparison is the author's analogy. It is absent from the DDD definition. |
| Domain-Driven Design | Lines 643 to 680 compare context maps and model boundaries with paradigms. | `domain-driven-design` | `bounded-context`, `data-mesh`, `incommensurability` | [Eric Evans, Domain-Driven Design reference](https://www.domainlanguage.com/ddd/) | **Link.** Keep the project-neutral page. The essay may link to it after identifying the comparison as an analogy. |
| Data mesh | Lines 625 to 640 compare domain-owned analytical data with paradigm-local interpretation. | `data-mesh` | `bounded-context`, `domain-driven-design`, `theory-ladenness` | [Martin Fowler, Data Mesh Principles and Logical Architecture](https://martinfowler.com/articles/data-mesh-principles.html) | **Link.** The current page already states the four defining principles. The claimed philosophical lineage needs to remain an interpretation in the essay. |

## Reusable concepts

| Concept | Source passage | Proposed idea slug | Related ideas | Authoritative reading | Decision |
| --- | --- | --- | --- | --- | --- |
| Theory-ladenness of observation | Lines 180 to 186 say observations and datasets depend on prior theory. Lines 342 to 356 apply that dependence to standards and instruments. | `theory-ladenness` | `epistemology`, `incommensurability`, `bounded-context` | [Stanford Encyclopedia of Philosophy, Theory and Observation in Science](https://plato.stanford.edu/entries/science-theory-observation/) | **Publish.** This concept connects philosophy of science to dataset construction, measurement, and labelling. |
| Falsifiability | Lines 219 to 238 distinguish confirmation from attempted refutation. Lines 268 to 290 then expose the practical problem of auxiliary assumptions and fallible evidence. | `falsifiability` | `epistemology`, `theory-ladenness`, `duhem-quine-thesis` | [Stanford Encyclopedia of Philosophy, Scientific Method, section 3.3](https://plato.stanford.edu/entries/scientific-method/#PopFal) | **Publish.** Its use extends beyond Popper to concrete questions about tests, counterevidence, and model evaluation. |
| Duhem thesis and confirmation holism | Lines 268 to 276 and 328 to 330 note that a failed prediction tests a bundle of hypotheses, instruments, and assumptions rather than one claim in isolation. | `duhem-quine-thesis` | `falsifiability`, `theory-ladenness`, `epistemology` | [Stanford Encyclopedia of Philosophy, Pierre Duhem, section 2.1](https://plato.stanford.edu/entries/duhem/#AgaNewMetDuhThe) | **Hold.** The concept has value, but a first version can live as a detailed section of `falsifiability`. Split it only when another article needs the relation. |
| Paradigm shifts | Lines 332 to 340 introduce changes to whole scientific worldviews. Lines 342 to 381 discuss normal science, anomalies, and scientific revolutions. | `paradigm-shift` | `incommensurability`, `theory-ladenness`, `adaptive-planning` | [Stanford Encyclopedia of Philosophy, Thomas Kuhn, sections 2 and 3](https://plato.stanford.edu/entries/thomas-kuhn/#DeveScie) | **Publish.** A careful page can replace the essay's loose use of "paradigm" with Kuhn's account of normal science, crisis, and revolution. |
| Incommensurability | Lines 373 to 435 distinguish methodological, observational, and semantic limits on comparison. Lines 387 to 406 apply the first two to datasets and evaluation. | `incommensurability` | `paradigm-shift`, `theory-ladenness`, `bounded-context` | [Stanford Encyclopedia of Philosophy, Incommensurability of Scientific Theories](https://plato.stanford.edu/entries/incommensurability/) | **Publish.** The concept helps readers spot changed metrics, labels, taxonomies, and problem definitions. The page must distinguish difficult or partial comparison from total incomparability. |
| Computational irreducibility | Lines 509 to 549 claim that some systems cannot be predicted by a much shorter computation and connect that limit to simulation. | `computational-irreducibility` | `amdahls-law`, `epistemology` | [Stephen Wolfram, A New Kind of Science, section 12.6](https://www.wolframscience.com/nks/p737--computational-irreducibility/) | **Publish with caution.** Explain it as Wolfram's proposed principle and distinguish it from proved limits in computability and complexity theory. |
| Fallibilism | Lines 281 to 290 treat both theories and evidence-producing practices as open to error. Lines 619 to 623 apply that stance to data systems. | `epistemology`, section "Knowledge without certainty" | `falsifiability`, `theory-ladenness` | [Internet Encyclopedia of Philosophy, Fallibilism](https://iep.utm.edu/fallibil/) | **Reject as a new slug.** The existing epistemology page already gives it enough room. Link there rather than create a thin duplicate. |

## Named schools

These labels organize the essay's historical argument. They should not consume the first publication batch.

| School | Source passage | Possible slug | Authoritative reading | Decision |
| --- | --- | --- | --- | --- |
| Empiricism | Lines 59 to 93 | `empiricism` | [Stanford Encyclopedia of Philosophy, Rationalism vs. Empiricism](https://plato.stanford.edu/entries/rationalism-empiricism/) | **Hold.** The essay uses a narrow version that needs correction before it can support a page. |
| Logical empiricism or logical positivism | Lines 95 to 217 | `logical-empiricism` | [Stanford Encyclopedia of Philosophy, Logical Empiricism](https://plato.stanford.edu/entries/logical-empiricism/) | **Hold.** A credible page would need to cover disagreements within the Vienna Circle that the essay currently flattens. |
| Critical rationalism | Lines 219 to 340 | `critical-rationalism` | [Stanford Encyclopedia of Philosophy, Scientific Method](https://plato.stanford.edu/entries/scientific-method/#PopFal) | **Reject as a first-batch page.** Publish the reusable `falsifiability` concept instead. |
| Postpositivism | Lines 342 to 452 | `postpositivism` | [Stanford Encyclopedia of Philosophy, Thomas Kuhn](https://plato.stanford.edu/entries/thomas-kuhn/) | **Reject as currently framed.** The section combines Kuhn, Quine, theory-ladenness, pragmatism, and researcher reflexivity under one unstable label. Publish those concepts separately where needed. |
| Computationalism | Lines 454 to 557 | `computationalism` | [Stanford Encyclopedia of Philosophy, Computation in Physical Systems](https://plato.stanford.edu/entries/computation-physicalsystems/) | **Reject.** The section mixes the computational theory of mind, ontic pancomputationalism, Wolfram's principle, computability, and simulation. Those distinct positions do not form one school. |

## Terms that should stay inside broader pages

Do not create pages for `rules-of-correspondence`, `munchhausen-trilemma`, `metaphysical-naturalism`,
`methodological-naturalism`, `meaning-holism`, `indeterminacy-of-translation`, `computational-universe`, or
`computational-theory-of-mind` from this essay alone. Each appears briefly, and some belong to specialist debates
that the article does not explain well enough to support a useful standalone page. `Meaning-holism` and
`indeterminacy-of-translation` can appear in `incommensurability`. The naturalism terms can appear in a later page
only if more than one source needs them.

## First publication set

Publish five pages, in this order:

1. `theory-ladenness`
2. `falsifiability`
3. `paradigm-shift`
4. `incommensurability`
5. `computational-irreducibility`

The first four form one connected philosophy-of-science cluster. The fifth earns a place because it carries the
essay's main computational claim, but its page should make the claim's disputed status visible. Keep the
`duhem-quine-thesis` material inside `falsifiability` for now. Add `epistemology` to the essay's existing links when
the first page is published. This bounds the work at five new pages and one metadata link.

The intended edges are:

```text
epistemology
  |-- theory-ladenness -- incommensurability -- paradigm-shift
  |         |                    |
  |         |                    `-- bounded-context -- domain-driven-design
  |         |                                         `-- data-mesh
  `-- falsifiability
           `-- Duhem thesis as a section, not a node

computational-irreducibility -- amdahls-law
```

## Claims to fix or source before adding links

| Source passage | Problem | Required change or evidence |
| --- | --- | --- |
| Lines 61 to 76 | The account credits Bacon with defining the scientific method and assigns him a five-item list without a direct source. It also says repeatability and consilience are "proven" by collected data. | Replace the origin story with a narrower historical claim and cite a history of scientific method. Attribute any list to its actual source. Use "supported" or describe the inference instead of "proven." |
| Lines 79 to 93 | The essay treats "Extreme Empiricist" as representative empiricism, and the argument moves from experience to personal replication and faith. | Distinguish claims about the source of concepts or justification from the much stronger demand that each knower personally repeat every experiment. |
| Lines 97 to 136 | The essay presents logical positivism as one settled doctrine shared by all proponents. Vienna Circle members disagreed about strict verificationism and the unity of science. | Rewrite this as a family of positions. Cite the SEP logical empiricism entry and identify which claim belongs to Schlick, Carnap, Neurath, or another author. |
| Lines 140 to 217 | The essay declares logical positivism self-refuting, then extends Godel's second incompleteness theorem from formal arithmetic to a general ban on a philosophy justifying its metaphilosophy. | Remove the Godel extension unless a peer-reviewed philosophy source supplies the argument and its conditions. Present self-refutation as a criticism, not a settled proof. |
| Lines 229 to 290 | The essay describes a single counter-instance as logically decisive, but the later discussion admits that auxiliary hypotheses and faulty evidence make real tests ambiguous. | Keep the logical asymmetry, then state the Duhem problem immediately. Cite the SEP scientific method and Duhem entries rather than the New World Encyclopedia summary. |
| Lines 328 to 330 | The essay uses "Duhem-Quine thesis" for one undifferentiated claim. Duhem's narrower thesis and Quine's stronger holism differ. | Name the narrower and stronger claims. Do not attribute Quine's full position to Duhem. |
| Lines 342 to 381 and 559 to 577 | The essay credits Kuhn with "killing" logical positivism. It makes paradigm membership binary, revolutions total worldview replacements, and comparison across paradigms effectively impossible. | Remove the death metaphor and binary formulation. State that Kuhn's account changed over time and that incommensurability limits common measures without making every comparison impossible. |
| Lines 373 to 380 and 625 to 680 | The essay infers that a paradigm shift invalidates all old data, then maps data warehouse, data lake, data mesh, and DDD architectures onto philosophical schools as if evidence supported the lineage. | Mark these as the author's design analogies. Narrow "invalidates" to the specific labels, measures, assumptions, or translations that changed. Add evidence from data-management sources for any non-analogical claim. |
| Lines 454 to 549 | The computationalism section combines distinct theses. It moves from rejecting the supernatural to saying one "must" accept a computational universe, and later treats computational irreducibility as an established property of the universe. | Separate ontic pancomputationalism, computational theories of mind, computability, complexity, simulation, and Wolfram's proposed principle. Replace necessity claims with attributed arguments and cite the SEP physical computation entry. |
| Lines 489 to 549 | The three-body example, the 108 million term figure, the claim that all theoretical breakthroughs reduce computation, and the finite number of reducible processes carry much of the conclusion without suitable independent sources. | Verify each claim with mathematical or scientific literature. Remove any claim that only restates Wolfram's advocacy, or attribute it directly and include the main objections. |

## Review outcome

The article can already link to `epistemology`. The other existing links remain useful, but the essay should label its
DDD and data-mesh comparisons as original analogies. New links should wait until the five selected pages exist and
authors correct the matching claims above. This avoids turning weakly sourced prose into high-confidence graph
edges.
