# Idea map for The Philosophy of Data Science

This map audits the concepts used in
[`The Philosophy of Data Science`](../../ui/content/blog/2022-03-02-the-philosophy-of-data-science.mdx).
It identifies reusable ideas, including schools of thought that deserve their own pages. The line references below
refer to the current source file.

## Selection rules

An idea page should explain a concept that can be used outside this essay, has a defensible primary or scholarly
source, and has useful relationships with the existing idea graph. Named schools qualify when the school gives
readers a coherent way to reason, even when its members disagree about details.

The map uses four decisions:

* **Link** means an existing page already covers the concept.
* **First wave** means the concept belongs in the first publication batch.
* **Queue** means the concept warrants a page in a later named wave.
* **Fold** means another page can cover the concept without losing useful detail.

## Existing ideas

| Concept | Source passage | Idea slug | Related ideas | Authoritative reading | Decision |
| --- | --- | --- | --- | --- | --- |
| Epistemology | Lines 11 to 13 define data science through knowledge. Lines 37 to 46 ask practitioners to expose and challenge how they know. | `epistemology` | `theory-ladenness`, `falsifiability` | [Stanford Encyclopedia of Philosophy, Epistemology](https://plato.stanford.edu/entries/epistemology/) | **Link.** This is the essay's broadest frame and should be added to its `ideas` metadata. |
| Bounded context | Lines 631 to 640 argue that a domain can maintain its own language and absorb change at its boundary. | `bounded-context` | `domain-driven-design`, `data-mesh`, `incommensurability` | [Martin Fowler, Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) | **Link.** The existing page defines the DDD concept. The essay contributes an original comparison with Kuhnian paradigms. |
| Domain-Driven Design | Lines 643 to 680 compare context maps and model boundaries with paradigms. | `domain-driven-design` | `bounded-context`, `data-mesh`, `incommensurability`, `meaning-holism` | [Eric Evans, Domain-Driven Design reference](https://www.domainlanguage.com/ddd/) | **Link.** Keep the project-neutral page and link back to the essay as an application of philosophy of language and science to DDD. |
| Data mesh | Lines 625 to 640 compare domain-owned analytical data with paradigm-local interpretation. | `data-mesh` | `bounded-context`, `domain-driven-design`, `theory-ladenness`, `postpositivism` | [Martin Fowler, Data Mesh Principles and Logical Architecture](https://martinfowler.com/articles/data-mesh-principles.html) | **Link.** The current page states the four defining principles. The essay's proposed postpositivist lineage is a useful interpretation and should remain part of its argument. |

## Reusable concepts

| Concept | Source passage | Proposed idea slug | Related ideas | Authoritative reading | Decision |
| --- | --- | --- | --- | --- | --- |
| Theory-ladenness of observation | Lines 180 to 186 say observations and datasets depend on prior theory. Lines 342 to 356 apply that dependence to standards and instruments. | `theory-ladenness` | `epistemology`, `incommensurability`, `bounded-context` | [Stanford Encyclopedia of Philosophy, Theory and Observation in Science](https://plato.stanford.edu/entries/science-theory-observation/) | **First wave.** This concept connects philosophy of science to dataset construction, measurement, and labelling. |
| Falsifiability | Lines 219 to 238 distinguish confirmation from attempted refutation. Lines 268 to 290 then expose the practical problem of auxiliary assumptions and fallible evidence. | `falsifiability` | `epistemology`, `theory-ladenness`, `duhem-quine-thesis` | [Stanford Encyclopedia of Philosophy, Scientific Method, section 3.3](https://plato.stanford.edu/entries/scientific-method/#PopFal) | **First wave.** Its use extends beyond Popper to concrete questions about tests, counterevidence, and model evaluation. |
| Duhem thesis and confirmation holism | Lines 268 to 276 and 328 to 330 note that a failed prediction tests a bundle of hypotheses, instruments, and assumptions rather than one claim in isolation. | `duhem-quine-thesis` | `falsifiability`, `theory-ladenness`, `epistemology` | [Stanford Encyclopedia of Philosophy, Pierre Duhem, section 2.1](https://plato.stanford.edu/entries/duhem/#AgaNewMetDuhThe) | **Fold.** Give this a detailed section in `falsifiability` first. Split it when another article needs a direct relation. |
| Paradigm shifts | Lines 332 to 340 introduce changes to whole scientific worldviews. Lines 342 to 381 discuss normal science, anomalies, and scientific revolutions. | `paradigm-shift` | `incommensurability`, `theory-ladenness`, `adaptive-planning` | [Stanford Encyclopedia of Philosophy, Thomas Kuhn, sections 2 and 3](https://plato.stanford.edu/entries/thomas-kuhn/#DeveScie) | **First wave.** The page should explain Kuhn's account and leave room for the essay's stronger interpretation of its consequences for data systems. |
| Incommensurability | Lines 373 to 435 distinguish methodological, observational, and semantic limits on comparison. Lines 387 to 406 apply the first two to datasets and evaluation. | `incommensurability` | `paradigm-shift`, `theory-ladenness`, `bounded-context` | [Stanford Encyclopedia of Philosophy, Incommensurability of Scientific Theories](https://plato.stanford.edu/entries/incommensurability/) | **First wave.** The concept helps readers spot changed metrics, labels, taxonomies, and problem definitions. |
| Meaning holism | Lines 408 to 435 argue that the meanings of related terms can change together and connect this to translation across paradigms. | `meaning-holism` | `incommensurability`, `bounded-context`, `domain-driven-design`, `ontology-engineering` | [Stanford Encyclopedia of Philosophy, Meaning Holism](https://plato.stanford.edu/entries/meaning-holism/) | **Queue, language and domain wave.** This deserves its own page. Its research on inferential roles, instability, disagreement, and communication gives the DDD comparison real depth. |
| Münchhausen trilemma | Lines 140 to 153 and 298 to 306 use the regress, circularity, and arbitrary stopping problem to test philosophical justification. | `munchhausen-trilemma` | `epistemology`, `falsifiability`, `logical-empiricism` | [Stanford Encyclopedia of Philosophy, Epistemology, section 4.3](https://plato.stanford.edu/entries/epistemology/#WhyFoun) | **Queue, language and domain wave.** The regress problem is reusable across philosophy, scientific justification, and system design. |
| Metaphysical naturalism | Lines 188 to 200 distinguish a claim about reality from a working scientific method. | `metaphysical-naturalism` | `methodological-naturalism`, `epistemology`, `computationalism` | [Stanford Encyclopedia of Philosophy, Naturalism](https://plato.stanford.edu/entries/naturalism/) | **Queue, language and domain wave.** A separate page keeps an ontological commitment distinct from a rule for inquiry. |
| Methodological naturalism | Lines 314 to 326 use naturalism as a working method without requiring the stronger metaphysical claim. | `methodological-naturalism` | `metaphysical-naturalism`, `falsifiability`, `postpositivism` | [Stanford Encyclopedia of Philosophy, Religion and Science](https://plato.stanford.edu/entries/religion-science/#NatuScie) | **Queue, language and domain wave.** Data science needs this distinction because a method can constrain explanations without settling metaphysics. |
| Computational theory of mind | Lines 454 to 467 connect a computational universe claim with a computational account of cognition. | `computational-theory-of-mind` | `computationalism`, `computational-irreducibility`, `epistemology` | [Stanford Encyclopedia of Philosophy, Computational Theory of Mind](https://plato.stanford.edu/entries/computational-mind/) | **Queue, computation wave.** It informs how data scientists model cognition and where a computational account supplies a viable scope of work. |
| Computational irreducibility | Lines 509 to 549 argue that some systems cannot be predicted by a much shorter computation and connect that limit to simulation. | `computational-irreducibility` | `computationalism`, `computational-theory-of-mind`, `amdahls-law` | [Stephen Wolfram, A New Kind of Science, section 12.6](https://www.wolframscience.com/nks/p737--computational-irreducibility/) | **Queue, computation wave.** State Wolfram's broad principle in his terms and distinguish it from narrower theorems in computability and complexity. That distinction makes the page more useful; it is not a reason to doubt the topic. |
| Fallibilism | Lines 281 to 290 treat both theories and evidence-producing practices as open to error. Lines 619 to 623 apply that stance to data systems. | `epistemology`, section "Knowledge without certainty" | `falsifiability`, `theory-ladenness` | [Internet Encyclopedia of Philosophy, Fallibilism](https://iep.utm.edu/fallibil/) | **Fold.** The existing epistemology page already gives it enough room. Link there rather than create a duplicate. |

## Named schools

These schools organize the essay's historical argument and can also support reusable pages. A page should describe
the shared position and its internal disagreements without pretending every member held the same view.

| School | Source passage | Possible slug | Authoritative reading | Decision |
| --- | --- | --- | --- | --- |
| Empiricism | Lines 59 to 93 | `empiricism` | [Stanford Encyclopedia of Philosophy, Rationalism vs. Empiricism](https://plato.stanford.edu/entries/rationalism-empiricism/) | **Queue.** The page can explain the family of empiricist positions and identify the deliberately strong version tested by the essay. |
| Logical empiricism or logical positivism | Lines 95 to 217 | `logical-empiricism` | [Stanford Encyclopedia of Philosophy, Logical Empiricism](https://plato.stanford.edu/entries/logical-empiricism/) | **Queue.** Internal disagreements within the Vienna Circle belong on the page and do not make the grouping illegitimate. |
| Critical rationalism | Lines 219 to 340 | `critical-rationalism` | [Stanford Encyclopedia of Philosophy, Scientific Method](https://plato.stanford.edu/entries/scientific-method/#PopFal) | **Queue.** Publish `falsifiability` first, then give the broader school its own page. |
| Postpositivism | Lines 342 to 452 | `postpositivism` | [Phillips and Burbules, Postpositivism and Educational Research](https://www.bloomsbury.com/us/postpositivism-and-educational-research-9780847691227/) | **First wave.** Postpositivism is a recognized metatheoretical grouping. Its inclusion of Kuhn, theory-ladenness, fallibilism, values, and attempts at objectivity is the reason to publish the page. |
| Computationalism | Lines 454 to 557 | `computationalism` | [Stanford Encyclopedia of Philosophy, Computational Theory of Mind](https://plato.stanford.edu/entries/computational-mind/) | **Queue, computation wave.** Computationalism is an established family of doctrines about cognition as computation. The page should map its variants and distinguish them from the computational-universe thesis without denying their connections. |

## Concepts to fold into broader pages

Keep `rules-of-correspondence` within `logical-empiricism` and treat `indeterminacy-of-translation` in depth within
`incommensurability` and `meaning-holism`. Keep the `computational-universe` thesis within `computationalism` until
another article needs a direct relation. The Münchhausen trilemma, both forms of naturalism, meaning holism, and the
computational theory of mind all warrant standalone pages.

## First publication set

The bounded publication set contains twelve pages in three waves:

1. Scientific reasoning: `postpositivism`, `theory-ladenness`, `falsifiability`, `paradigm-shift`, and
   `incommensurability`.
2. Language and domains: `meaning-holism`, `munchhausen-trilemma`, `metaphysical-naturalism`, and
   `methodological-naturalism`.
3. Computation: `computationalism`, `computational-theory-of-mind`, and `computational-irreducibility`.

The first wave gives the essay its main philosophy-of-science cluster. The second develops the article's account of
justification, language, and domain boundaries. The third separates three connected computational claims so readers
can see where each applies. Keep the `duhem-quine-thesis` material inside `falsifiability` for now. Add `epistemology`
to the essay's existing links when the first page is published.

The intended edges are:

```text
epistemology
  |-- postpositivism -- theory-ladenness -- incommensurability -- paradigm-shift
  |                            |                    |
  |                            |                    `-- meaning-holism
  |                            |                               `-- bounded-context -- DDD -- data-mesh
  |                            `-- falsifiability -- Münchhausen trilemma
  `-- metaphysical naturalism -- methodological naturalism

computationalism -- computational theory of mind
  `-- computational irreducibility -- amdahls-law
```

## Factual checks and editorial opportunities

This editorial essay states a point of view. Academic neutrality would weaken it. Its original analogies and
first-person conclusions should remain. The checks below distinguish factual attribution from interpretation. A
source should establish what another thinker claimed. The author's synthesis only needs to identify itself as an
argument and explain the reasoning.

| Source passage | Problem | Required change or evidence |
| --- | --- | --- |
| Lines 61 to 76 | The account credits Bacon with defining the scientific method and assigns him a five-item list without a direct source. It also says repeatability and consilience are "proven" by collected data. | Replace the origin story with a narrower historical claim and cite a history of scientific method. Attribute any list to its actual source. Use "supported" or describe the inference instead of "proven." |
| Lines 79 to 93 | The essay's "Extreme Empiricist" is a deliberately strong position used to test the view's limit. | Keep the device. One sentence can say that this is the extreme version under examination rather than a definition shared by every empiricist. |
| Lines 97 to 136 | The section synthesizes logical positivism into one position even though Vienna Circle members disagreed about strict verificationism and the unity of science. | Keep the synthesis. Define the version used by the essay, then cite the broader school's internal disagreements on its idea page. The blog post does not need a scholar-by-scholar survey. |
| Lines 140 to 217 | The essay extends Gödel's second incompleteness theorem from formal arithmetic into an argument about a philosophy justifying its metaphilosophy. | Keep this as the author's argument, but mark the move from theorem to philosophical analogy. Source the theorem itself and explain why the author thinks the structure carries across. |
| Lines 229 to 290 | The essay first gives Popper's logical account of a counter-instance, then develops the practical ambiguity caused by auxiliary hypotheses and faulty evidence. | Preserve this progression. Stronger sources for Popper and Duhem would improve the factual foundation without changing the essay's conclusion. |
| Lines 328 to 330 | The essay uses "Duhem-Quine thesis" for one undifferentiated claim. Duhem's narrower thesis and Quine's stronger holism differ. | Name the narrower and stronger claims. Do not attribute Quine's full position to Duhem. |
| Lines 342 to 381 and 559 to 577 | The essay uses forceful shorthand such as Kuhn "killing" logical positivism and develops a stronger view of paradigm membership and comparison. | Keep the voice and the stronger reading. Attribute the historical shorthand, then distinguish Kuhn's published claims from the consequences the author draws for data science. |
| Lines 373 to 380 and 625 to 680 | The claim that paradigm shifts invalidate old data, followed by the mappings between philosophical schools and data architectures, is the essay's central original thesis. | Keep it. Define the relevant sense of "invalidate" through changed labels, measures, assumptions, or translations, then let the concrete architecture examples carry the argument. No external source needs to have proposed the same analogy. |
| Lines 454 to 549 | The section connects computationalism, a computational-universe thesis, the computational theory of mind, and computational irreducibility. | Keep the synthesis while naming each component. This lets readers see which parts concern cognition, physical reality, or limits on prediction without pretending the connections are accidental. |
| Lines 489 to 549 | The three-body example and its 108 million term figure are factual claims. The remaining claims report or develop Wolfram's view. | Verify the number and mathematical description independently. Attribute Wolfram's claims to him, then keep the essay's conclusions and criticism in the author's voice. |

## Review outcome

The article can already link to `epistemology`. Treat its DDD and data-mesh comparisons as original contributions.
A literature-review rewrite would erase the essay's point. The twelve-page set should give those arguments stronger
concepts to link to while preserving the essay's voice. Only factual attribution and numerical claims need
verification before publication. The author's stated worldview does not need an external source to authorize it.
