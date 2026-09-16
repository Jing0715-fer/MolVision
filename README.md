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
| ⚡ **Hydrogen-bond network** | Distance/angle geometry criteria (D-H…A ≤ 2.5 Å & ≥ 120° with H; D…A ≤ 3.5 Å without), dashed teal lines with endpoint markers, optional water-mediated bonds & selection-scoped display — press `B` |
| 🎬 **NMR ensemble animation** | Multi-model PDB/mmCIF ensembles playback with smooth frame interpolation, speed control (2-30 fps), loop mode and frame scrubbing — press `P`, try `load 1d3z` |

### Coloring schemes
Element (CPK) · Chain (golden-angle palette) · Spectrum (rainbow per chain) · Residue class (10 biochemical categories) · Secondary structure · B-factor (blue→red) · Uniform — plus **per-atom color overrides** on any selection.

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
ensemble play · ensemble frame 3 · ensemble fps 15
```

### Measurement & annotation
- **Distance / angle / dihedral** measurement with 3D labels — click atoms in measure mode
- Atom **labels** (press `L` on a selection)
- **Sequence viewer** with per-residue biochemical coloring, secondary-structure track, click-to-select / double-click-to-focus
- **Context menu** (right-click): select atom/residue/chain/same-residue, measure-from-here, label, focus

### Session persistence & `.molvision` files
Structures, representations, colors, settings and camera orientation are auto-saved to localStorage (debounced) and restored on reload — no work lost. Manage with `session save / info / clear`.

Full sessions can also be **exported as `.molvision` files** (complete structure sources + view state) and re-imported on any device — Scene panel → Session → Export/Import.

![NMR ensemble animation](public/screenshots/ensemble.png)

### Scene & camera
- Perspective/orthographic toggle, FOV control
- **Depth-cue fog**, **slab clipping** (near/far planes along the view axis)
- Auto-rotate (spin `S`), **camera rock** (`R`, ±26° oscillation for inspecting pockets & grooves), background presets, 2×/4×/transparent PNG export
- Hide/show hydrogens & water globally

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
- **Three.js** — InstancedMesh geometry, PMREM environment lighting, ACES tone mapping, clipping planes, MarchingCubes surfaces
- **Zustand** state · **shadcn/ui** + Tailwind CSS 4 · **sonner** toasts
- Zero-backend parsing: PDB & mmCIF parsed in-browser; RCSB fetched through a tiny API proxy (`/api/pdb/[id]`)

## 📁 Structure
```
src/lib/molecular/   parser (PDB/mmCIF) · chemistry data · selection engine ·
                     color schemes · representations · renderer engine · store · commands
src/components/
  molecular/         WebGL viewport wrapper (picking, hover, context menu, shortcuts)
  studio/            toolbar · panels (structures/reps/colors/selection/measure/scene/info) ·
                     sequence bar · command console · status bar · dialogs
src/app/             single-page studio + /api/pdb proxy
```

## 🗺️ Roadmap
- SSAO ambient occlusion · align/superpose · DSSP fallback for sheets · hydrogen-bond detection in a Web Worker

## License
MIT
