# living-scriptorium.md

*A medium for co-authored, self-similar, procedurally-elaborated 3D spaces that you navigate by zooming.*

Working title. Descends from `infipoint` (the infinity-zoom substrate), `infinstance` (instances-with-identity as the payload), and `stranger` (what the medium wants to become once you stop calling it a paint program).

---

## Thesis

Everything is alive. An instance is not a copy of a thing — it is a *reference* to a type, plus a per-instance transform and a per-instance set of knob values. Edit the type, every instance updates. Tune a knob's distribution, the whole population shifts. Freeze an instance when you want to lock it forever.

The unit of authorship is not a stroke, it is a **decision**: a click at a pose, in a band, with a type in mind. The unit of work is not a canvas, it is a **grammar**. The unit of exploration is not a viewport, it is a **trail through a graph of sculptures**.

The interaction is still: look somewhere, click. The programming is implied by the gesture.

---

## The ten verbs

The entire app routes to these:

- **drop** — instantiate a type at the current camera pose
- **dive** — descend into an instance's interior (its sub-sculpt lives in a deeper band)
- **surface** — ascend out of the current sub-sculpt
- **tune** — adjust a knob's mean by dragging on an instance
- **loosen / tighten** — adjust a knob's variance (two-finger drag), affecting the whole population
- **expose** — promote a fixed property of a type into a knob
- **bind** — connect a knob to a signal (time, camera distance, seed, another knob)
- **fork** — copy a type into your own namespace before editing
- **portal** — set an instance's interior to reference a different sculpture
- **freeze** — collapse a live instance to static data, breaking the type link

Everything else is discovery: what types exist, what knobs they expose, what portals lead where.

---

## The substrate (borrowed from InfiPoint)

Every one of these problems is already solved for us. We're not rebuilding the substrate, we're changing what rides on top of it.

- **Float64 camera pose, RTC on the GPU.** Same as InfiPoint.
- **Band transport.** When focal length crosses the envelope, {E, T} rescale by 2^20 and `bandExp` increments. All instance positions within a chunk are stored relative to the chunk's native band and stay f32-clean.
- **Chunks.** Instances group into chunks the same way points do. Each chunk has a native band, a centroid, a bounding radius, and a bounded local coordinate range.
- **Three render regimes.** Near = full mesh instance. Mid = billboard. Far = single dust marker per chunk. Same fade band on projected pixel diameter, same pool budgets (though the numbers need re-tuning for meshed instances).
- **Morton ordering within chunks.** Same trick, for frustum-cull coherence.

What changes: the per-record payload. Instead of `{pos_f32×3, radius, color}`, we store `{pos_f32×3, rot_quat_f32×4, scale_f32×3, type_id_u16, seed_u32, knob_overrides}`. Roughly 48 bytes if we pack tightly, larger if the instance overrides many knobs.

**Key precision note.** Rotations are band-invariant (a quaternion doesn't care what band it lives in). Scales are band-relative — a scale of 1.0 means "one unit at my chunk's native band." This round-trips through band transport cleanly because it's just a change of frame.

---

## Types: the aliveness engine

A **type** is:

- an ID (content-addressed hash, so identical types collapse)
- a version (monotonic; increments on edit)
- a body: either a **primitive** (sphere / capsule / box / cylinder — the atoms) or a **composite** (a list of `{child_type_id, transform, knob_bindings}` records — this is how you get `branch → 3 × branch`)
- a **knob schema**: named parameters with defaults, ranges, and distribution shapes
- provenance: who authored it, what it was forked from, what license/permission it carries

An **instance** references a type by ID and holds:

- a transform (position, rotation, scale) in its parent chunk's frame
- a seed (used for procedural knob resolution)
- optional **overrides**: per-instance knob values that shadow the type's defaults

When rendering an instance, the system resolves the type at the current version, samples any un-overridden knobs from the type's distribution using the instance's seed, and recursively expands composite bodies until it hits primitives or hits the current band's LOD cutoff.

This resolution is **lazy** — driven by view. An instance you're not looking at costs nothing. This is what makes the medium performant at scale: cost follows attention.

**Invalidation, not propagation.** Type edits are O(1) — bump the version. Instances rebuild against the new version the next time they render. No wave sweeps the graph. The graph is a database with a viewport, not a scene graph with dirty flags.

---

## Knobs and variation

Knobs are the *actual craft*. Designing them is worldbuilding.

A knob has:

- a name (`hue`, `gnarliness`, `leafDensity`)
- a type (scalar, vector, color, angle, distribution, sub-type-reference)
- a default value or distribution
- a range or shape hint (for UI and mutation gestures)

Instances can override any knob with a fixed value or with their own distribution. Composite types can also *bind* their children's knobs to their own knobs — this is how a `forest` type controls the `seasonality` of every `tree` in it by exposing one knob at the top.

**Gestures on knobs.** Point at an instance and drag: if the drag is horizontal, you're adjusting the type's dominant color-channel mean; vertical, size mean; two-finger, variance of whichever channel you last touched. The mapping from gesture to knob is discoverable through direct manipulation — you drag, you see what changes, you learn the type's shape by feel.

**Expose** is the promotion gesture: right-click any fixed property of a type and turn it into a knob. This is how types grow richer over time. You start with a rigid capsule, expose `length`, then `curvature`, then `taper` — now it's a knob-rich atom that participates in higher-level grammars.

---

## Time and binding

Any knob can be **bound** to a signal. Signals are:

- `t` — global time
- `dist` — camera distance to this instance's centroid
- `band` — current camera band
- `seed` — the instance's stable random seed
- another knob (on the same type or a parent composite)

A binding is a small expression — probably a restricted arithmetic DSL, maybe just `signal * scale + offset` initially, richer later. Bound knobs animate. `angle` bound to `sin(t + seed)` is trees swaying, out of phase, forever, with no animation timeline anywhere.

**The sculpture has weather.** You didn't paint an animation; you painted a world whose knobs are functions of time.

---

## The git model

This is the framing we landed on and it maps cleanly onto everything.

- **Repository** = a namespace of types owned by an author.
- **Commit** = a type-version bump. Every edit is a commit.
- **Fork** = copy a type into your own namespace so you can edit without affecting the original.
- **Pull** = update your instances of someone else's type to their latest version (default: automatic; opt-out per instance).
- **Merge** = combine two forks of a type by merging their knob schemas and bodies. Non-trivial; probably manual for a long time.
- **Freeze** = the sculptural equivalent of publishing. An immutable snapshot. Frozen instances no longer track the type — they hold their resolved geometry directly.
- **Package** = a named, versioned bundle of types, publishable and importable.
- **Blame** = for any instance, walk the type-reference chain and show who authored what.

Permissions live on types, not on sculptures. A type can be:

- **open** (anyone can commit; wild-west; probably useful for jam sessions)
- **claimed** (only owner commits; others must fork)
- **signed** (edits by author X propagate; edits by others require your acceptance)

The frozen-vs-live distinction matters for publishing. You freeze a sculpture before showing it to preserve intent against upstream mutation. Frozen sub-sculpts are cheaper to render (no knob resolution, no version chasing), so there's natural pressure to freeze finished work. The system rewards you for deciding what's done.

---

## Portals: sculptures as hypertext

An instance's interior — the sub-sculpt inside it, one band down — can be:

1. **Empty** (no dive; it's an atom)
2. **Owned** (contains its own local sub-sculpt, authored inside this parent)
3. **Referenced** (portal: dive into it and you're inside a different sculpture entirely — yours or someone else's)

Portal instances are hyperlinks. The medium becomes a directed graph of sculptures connected by dive-links. Someone's forest contains a tree containing a pebble containing someone else's cathedral. You explore the whole network by diving.

Self-portals give you fractals for free. Point an instance at its own containing sculpture and you have Mandelbrot-style recursion, terminated only by the LOD system's band cutoff. You've painted infinite nested space without touching math.

---

## The auto-dropper and the first ten minutes

Everything above is architecture. None of it matters if the opening moment is wrong.

The first-run experience: **you're in someone else's sculpture, floating, and when you dwell somewhere, small things quietly bloom into being.** You don't know yet that you're editing anything. You're just noticing that the world responds to attention.

This is the auto-dropper: the app watches your camera, and when dwell-time exceeds a threshold in a region, it samples from the *local grammar prior* — what types are already dense here, what knobs vary in what ranges — and drops an instance consistent with that context. A temperature slider controls conformity vs surprise. Cold = the new instance is boringly consistent with its neighbors. Hot = weird stuff.

Then you find out you can dive. Then you find out you can steer the temperature. Then you find out the little dial you've been turning was actually promoting properties into knobs the whole time. Then you find out you can freeze what you've made and share the link.

That's the onboarding arc. Every reveal earns the next verb.

---

## What to prototype first

I'd sequence it roughly like this:

1. **InfiPoint-with-instances.** Same substrate, replace the point payload with `{pos, rot, scale, type_id, color}`, four primitive types (sphere/capsule/box/cylinder), no composites, no knobs yet. Prove the render regimes still work: mesh near, billboard mid, dust far. This is a real thing you can paint with, and it confirms the perf story.

2. **Composite types.** A type whose body is a list of child instances. No knobs yet — just deterministic composition. Prove that "one saved leaf, ten thousand leaves in a forest, dive to see real leaves" works. This is where the medium starts to feel different from a paint program.

3. **The type registry and versioning.** In-memory only, no network. Types have IDs and versions. Edit a type, see instances update. Prove invalidation is O(1) and rendering is truly lazy.

4. **Knobs, defaults, per-instance overrides.** Fixed values only, no distributions yet. Prove the gesture: drag on an instance, tune a knob on its type, see the population respond.

5. **Distributions and seeds.** Now knobs can be distributions. Instances resolve them with their stable seed. The `tree` becomes a *species* rather than a copy. This is the moment the medium reveals itself as grammar-authoring.

6. **Bindings.** Knobs bound to `t` and `dist`. The sculpture starts moving. Watch for how much this changes the feel — probably a lot.

7. **Freeze.** Static snapshots of live instances. Test the perf claim (frozen chunks should render faster). Test that frozen sub-sculpts survive upstream type deletion.

8. **Portals.** Instance interior can reference a different sculpture. Test self-reference (fractal) and cross-reference (hypertext). Probably breaks a bunch of assumptions in the LOD system — expect to iterate.

9. **The auto-dropper.** Sample from local grammar prior on dwell. This is the hook. Everything before this was scaffolding for this moment.

10. **The git verbs.** Fork, pull, permissions. This is when it becomes a shared medium rather than a single-player toy. Real network stuff, real hard problems, real interesting.

Each step is a demo. Each demo is a decision point on whether the medium is what we hoped.

---

## Open questions

None of these have answers yet. They're for future conversations.

- **Knob-binding DSL.** How rich? Pure algebra with restricted primitives? Node graph? Little scheme? The answer shapes what the medium can express and what it can enforce (perf, safety).
- **Merge semantics.** What does it mean to merge two forks of a type whose bodies differ structurally? Probably "manual, with visual diff" for a long time. Is there ever an automatic case?
- **Time model for shared editing.** If Alice's edits affect Bob's live view, do they replay when Bob rewinds? Is history global or per-viewer? Probably per-viewer with rebase primitives, but this is a whole design space.
- **Discovery.** How do you find types and sculptures made by others? Search? Feeds? Neighborhoods-by-band? Guilds? Some hybrid.
- **The aesthetic first-scene.** What's the launch sculpture — the one everyone starts inside? It has to demonstrate the medium's range without overwhelming. This is more of an art-direction problem than an engineering one, and it matters as much as any technical decision.
- **How much does the substrate constrain the medium.** InfiPoint's chunk/band system is beautiful for spatial data but assumes locality. Portals and cross-sculpt references break locality on purpose. How much of the substrate has to bend?

---

## The pitch, one line

You paint one tree; you get a species. You share the species; someone else grows a forest from it. They tweak the season; your tree in your sculpture, three portals away, turns autumn. You freeze your favorite and publish it. Someone dives into it a year later and it's still there, still yours, exactly as you left it, in a universe that has kept moving around it.

That's the medium.
