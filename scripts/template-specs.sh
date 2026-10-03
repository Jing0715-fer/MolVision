#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# template-specs.sh —— 模板运营规格的单一事实源（r98-f4 重构）
#
# 背景：SPECS（id:wait:demo:idx[:vp]）此前分散在 gen-template-thumbs.sh 与
# health-check-templates.sh 两处——后者 r75 后停更（27/46 漂移，19 支模板
# 体检盲区）。现抽离为本文件，两个消费方 source 之，新增模板只改这里。
# id 顺序与数量以 src/lib/molecular/figure-templates.ts 为权威源（下方断言
# 强制对齐——漂移即 fail-fast，杜绝第三处漂移）。
# 用法：source "$(dirname "$0")/template-specs.sh"
# -----------------------------------------------------------------------------
# 字段：id:等待秒数:demo结构:grid序号[:视口档]
# 各 wait 的依据见 gen-template-thumbs.sh 头注（r72-r97 逐批实测记录）
SPECS=(
  rainbow-overview:10:4HHB:0
  chain-assembly:10:4HHB:1
  ss-motif:10:1AKI:2
  ligand-pocket:11:6LU7:3
  sasa-surface:13:4HHB:4
  density-map:22:3EKJ:5
  interface-contacts:11:6LU7:6
  symmetry-assembly:11:1CRN:7
  ensemble-dynamics:10:1D3Z:8
  publication-ready:18:4HHB:9
  pore-analysis:14:1BL8:10
  membrane-embed:15:1FX8:11
  salt-bridge-network:11:1AKI:12
  hbond-network:12:6LU7:13
  dna-protein-complex:12:1LMB:14
  domain-coloring:10:6LU7:15
  mutation-hotspots:12:4HHB:16
  disulfide-bonds:11:3INS:17
  metal-center:12:2CBA:18
  cpk-spacefill:10:1CRN:19
  mobility-bfactor:10:3INS:20
  heme-pocket:12:1MBO:21
  cation-pi:11:1AKI:22
  conformational-morph:24:4AKE:23
  two-state-comparison:20:4Q21:24
  ghost-surface:14:4HHB:25
  catalytic-residues:12:1AKI:26
  ink-night-cover:11:4HHB:27
  ballstick-chemistry:10:1CRN:28
  stereo-anaglyph:10:1AKI:29
  putty-flexibility:10:3INS:30
  slab-cutaway:30:4HHB:31:1280x720
  wire-skeleton:10:1CRN:32
  grayscale-print:10:4HHB:33
  electrostatic-surface:13:4HHB:34
  hydration-shell:11:4HHB:35
  unit-cell-context:10:4HHB:36
  cinematic-spotlight:10:4HHB:37
  chalk-wireframe:10:1AKI:38
  pastel-macaron:10:3INS:39
  duotone-poster:10:4HHB:40
  sepia-vintage:10:1MBO:41
  neon-night:10:1CRN:42
  textbook-annotated:12:1AKI:43
  nucleosome-dna:12:1AOI:44
  gfp-chromophore:12:1EMA:45
)

# 对齐断言：SPECS 与 figure-templates.ts 的 id 数量一致（漂移即中止——新模板
# 忘登记时此处报错，而非体检/缩略图静默漏拍）
_tpl_ftpl_n=$(rg -c --no-messages "id: '[a-z-]+'" "$(dirname "${BASH_SOURCE[0]}")/../src/lib/molecular/figure-templates.ts" 2>/dev/null || echo 0)
_tpl_specs_n=${#SPECS[@]}
if [ "${_tpl_ftpl_n:-0}" -ne "${_tpl_specs_n:-0}" ]; then
  echo "template-specs.sh: SPECS($_tpl_specs_n) 与 figure-templates.ts($_tpl_ftpl_n) 数量漂移——请对齐" >&2
  return 1 2>/dev/null || exit 1
fi
unset _tpl_ftpl_n _tpl_specs_n
