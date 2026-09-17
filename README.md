# MolVision 🧬

**Professional 3D molecular visualization studio in the browser** — built with Three.js, Next.js 16 and WebGL2. Load any PDB/mmCIF structure and explore it with publication-quality cartoon ribbons, ball-and-stick models, gaussian molecular surfaces, a PyMOL-style selection language and command console.

![MolVision overview](public/screenshots/cartoon.png)

## ✨ Highlights

### Representations
| Style | Description |
|---|---|
| 🧬 **Cartoon ribbons** | Secondary-structure-aware ribbons — helices as rounded ribbons, β-sheets as flat arrows with tapered tips, loops as tubes, nucleic backbones as tubes with per-residue coloring |
| ⚪ **Ball & stick / sticks** | Per-bond two-tone cylinders (half-bond coloring), configurable radii |
| ⬤ **Space-fill (CPK)** | vdW-radius spheres, per-element Jmol palette |
| 〰️ **Wireframe** | GPU line segments |
| 🎈 **Molecular surface** | Metaball/gaussian implicit surface via marching cubes, per-atom vertex coloring, probe radius & opacity controls |
| ⚡ **Hydrogen-bond network** | Distance/angle geometry criteria (D-H…A ≤ 2.5 Å & ≥ 120° with H; D…A ≤ 3.5 Å without), dashed teal lines with endpoint markers, optional water-mediated bonds & selection-scoped display — press `B`. Structures ≥ 2,000 atoms are detected in a **background Web Worker** (UI never blocks, live progress badge) |
| 🎬 **NMR ensemble animation** | Multi-model PDB/mmCIF ensembles playback with smooth frame interpolation, speed control (2-30 fps), loop mode and frame scrubbing — press `P`, try `load 1d3z` |
| 🔀 **Structure superposition** | ChimeraX matchmaker-style alignment: Needleman-Wunsch sequence pairing + Horn quaternion rigid-body fit (Kabsch-equivalent) with per-CA RMSD report — `superpose 4HHB onto 2HHB`, one-click ⧉ button in the Structures panel, or the **matchmaker panel** with explicit chain-pair selection (`superpose 4HHB onto 1A3N chain A to A`). Aligned poses persist across sessions (rigid transform replay) |
| 🧪 **Interface contact analysis** | ChimeraX contacts-style: detect residue-residue contacts between two selections (heavy-atom distance ≤ cutoff, bonded pairs excluded), rendered as distance-coded lines (near = red, far = amber) — with a clickable **2D contact map**, interface-residue selection and per-side highlighting — `interface A B` (also `interface chain A chain B` / `interface :A :B`), `contacts chain A | within 8 of resn HEM 4.0` or the Analysis panel |
| 🌉 **Cross-structure contacts** | Detect interfacial contacts **between two different structures** (complex/docking interfaces): superpose first, then `xcontacts 1UBQ:chain A | 1D3Z:chain A 5.0` — violet result card with Top contact pairs + status-bar badge; A/B structure selectors with live atom counts in the Analysis panel |
| 🌀 **DSSP secondary structure** | Kabsch–Sander backbone H-bond energies (ideal-geometry H placement, 0.03 Å validated) with helix/turn/bridge assignment — structures lacking HELIX/SHEET records get correct cartoons automatically; force recompute with `dssp` |
| 💧 **SASA solvent accessibility** | Shrake–Rupley algorithm (FreeSASA-equivalent, ProtOr/Bondi vdW radii, 1.4 Å water probe, 64-256 Fibonacci sphere points per atom): per-atom/per-residue areas, hydrophobic vs polar decomposition, Top exposed residues, and an **exposure color scheme** (buried blue → exposed orange-red) — `sasa 1.4 256` or the Analysis panel; structures ≥ 2,200 atoms compute in a **background Web Worker** |
| 🧱 **Interface ΔSASA (BSA)** | Buried solvent-accessible area between two selections — the rigorous interface criterion: three-pass SASA (A alone / B alone / complex) with core interface residues flagged at ΔSASA > 1 Å² (PDB standard) — run contacts first, then `bsa`; compare with distance-cutoff contacts in the Analysis panel |
| 🔄 **Superpose undo** | Revert any aligned structure back to its original deposited pose — `untransform 1D3Z` or the ↩ button on structure cards |
| 🎥 **Animation recording** | Record ensemble playback / rock / spin as 30fps WebM video via MediaRecorder canvas capture — toolbar ⏺ button or `record start` |

### Coloring schemes
Element (CPK) · Chain (golden-angle palette) · Spectrum (rainbow per chain) · Residue class (10 biochemical categories) · Secondary structure · B-factor (blue→red) · **SASA exposure (buried blue → exposed orange)** · Uniform — plus **per-atom color overrides** on any selection.

![SASA exposure coloring on hemoglobin](public/screenshots/sasa.png)

### PyMOL-style selection language
```
chain A and resi 40-80
within 5 of (resn HEM)          # atoms within 5 Å of heme
byres(within 4 of ligand)       # expand to whole residues
(protein or nucleic) and not helix
name CA+CB · elem Fe · bfactor > 40 · backbone · metal
```
Full boolean grammar: `and or not ( )`, named selections, `byres`/`bychain`/`within` operators.

### Command console (press `` ` ``)
```
load 4hhb
select site = within 5 of resn HEM
color red site
show cartoon chain A
zoom site
bg black · spin on · rock on · slab 20 · label on · preset surface
ssao on 3 · hbonds on 3.2 · ensemble play · ensemble fps 15
superpose 4hhb onto 2hhb · superpose 4hhb onto 1a3n chain A to A · record start
interface A B · interface chain A chain B · contacts chain A | chain B 4.0 · dssp
xcontacts 1ubq:chain A | 1d3z:chain A 5.0 · sasa 1.4 256 · color sasa · bsa · untransform 1d3z
```

### Measurement & annotation
- **Distance / angle / dihedral** measurement with 3D labels — click atoms in measure mode
- Atom **labels** (press `L` on a selection)
- **Sequence viewer** with per-residue biochemical coloring, secondary-structure track, click-to-select / double-click-to-focus
- **Context menu** (right-click): select atom/residue/chain/same-residue, measure-from-here, label, focus

### Interface analysis (Analysis panel / `interface` command)
- Contact detection between arbitrary selections with adjustable cutoff (3–8 Å)
- **2D contact map** heatmap (rows = A-side residues, columns = B-side) — hover for residue pair + distance, click to select that pair in 3D
- One-click selection of A-side / B-side / all interface residues
- **ΔSASA buried-area analysis** — per-side burial (Å²), total interface BSA, core interface residues at the PDB-standard ΔSASA > 1 Å² criterion, one-click core-residue selection
- **SASA panel** — total / hydrophobic / polar / water+ligand areas with composition bar, Top-12 exposed residues (click to select), probe radius (0.8–2.0 Å) and sampling density (64–256 pts/atom) controls
- Secondary-structure composition bar (helix/strand/loop) + DSSP recompute

![Interface contact analysis](public/screenshots/contacts.png)

### Session persistence & `.molvision` files
Structures, representations, colors, settings, **superposition transforms** and camera orientation are auto-saved to localStorage (debounced) and restored on reload — no work lost. Manage with `session save / info / clear`.

Full sessions can also be **exported as `.molvision` files** (complete structure sources + view state) and re-imported on any device — Scene panel → Session → Export/Import.

![NMR ensemble animation](public/screenshots/ensemble.png)

### Scene & camera
- **GTAO ambient occlusion** — ground-truth AO post-processing darkens crevices, pockets and contact regions for dramatically improved depth perception; adjustable intensity & sampling radius (Å-scale, `ssao on 3`)
- **Structure superposition** — align any two structures by sequence + rigid-body fit; try `load 1ubq` then `load 1d3z` then `superpose 1ubq onto 1d3z` (ubiquitin X-ray ↔ NMR, ≈ 0.5-1.5 Å RMSD); aligned poses survive reload
- **Animation recording** — capture molecular motion as WebM video (toolbar ⏺ / `record start`)
- Perspective/orthographic toggle, FOV control
- **Depth-cue fog**, **slab clipping** (near/far planes along the view axis)
- Auto-rotate (spin `S`), **camera rock** (`R`, ±26° oscillation for inspecting pockets & grooves), background presets, 2×/4×/transparent PNG export
- Hide/show hydrogens & water globally

![Structure superposition](public/screenshots/superpose.png)

![GTAO ambient occlusion](public/screenshots/ssao.png)

## ⌨️ Shortcuts
`1-7` presets · `F` fit view · `S` spin · `R` rock · `H` hydrogens · `W` waters · `B` hydrogen bonds · `P` ensemble play/pause · `L` label · `` ` `` console · `Esc` exit mode/clear · `Ctrl+click` single atom · `Shift+click` add · `Alt+click` remove · double-click focus residue

## 🚀 Quick start

```bash
bun install
bun run dev        # http://localhost:3000
```

Paste a **PDB ID** (e.g. `4HHB`) or drag & drop a local `.pdb` / `.cif` file onto the viewport.

## 🏗️ Tech stack
- **Next.js 16** (App Router) + React 19 + TypeScript
- **Three.js** — InstancedMesh geometry, PMREM environment lighting, ACES tone mapping, clipping planes, MarchingCubes surfaces, GTAO post-processing (EffectComposer)
- **Web Workers** for hydrogen-bond detection and SASA/ΔSASA computation on large structures
- **DSSP** secondary-structure engine (Kabsch–Sander electrostatic H-bond energies)
- **Shrake–Rupley SASA** engine (FreeSASA-equivalent) with three-pass ΔSASA interface analysis
- **Zustand** state · **shadcn/ui** + Tailwind CSS 4 · **sonner** toasts
- Zero-backend parsing: PDB & mmCIF parsed in-browser; RCSB fetched through a tiny API proxy (`/api/pdb/[id]`)

## 📁 Structure
```
src/lib/molecular/   parser (PDB/mmCIF) · chemistry data · selection engine ·
                     color schemes · representations · renderer engine · store ·
                     commands · DSSP · contacts · superpose · hbonds (worker) ·
                     sasa + ΔSASA (worker)
src/components/
  molecular/         WebGL viewport wrapper (picking, hover, context menu, shortcuts)
  studio/            toolbar · panels (structures/reps/colors/selection/measure/analysis/scene/info) ·
                     sequence bar · command console · status bar · dialogs
src/app/             single-page studio + /api/pdb proxy
```

## 🗺️ Roadmap
- Cross-structure ΔSASA (joint buried area after superpose) · iterative multi-chain matchmaker (auto chain-pair iteration) · ensemble GPU-matrix playback for very large systems · unified Web Worker pool for hbond/SASA/contacts

## License
MIT
