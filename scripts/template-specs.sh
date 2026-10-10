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
  interface-contacts:11:4HHB:6
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
  # r99：1280x720 在当前环境 SwiftShader 下仍饿死（GPU 进程 4s/帧持续饱和 →
  # CDP captureScreenshot 三重试全超时）；实测 800x450（288k px = 31% 像素量）
  # 一击即中 + 等待 35s。真 GPU 用户端不受影响
  slab-cutaway:35:4HHB:31:800x450
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
  # r99 六新模板：xray/porcelain/comic 即成 10s；zn-finger 12s（1AAY 143KB 拉取 +
  # 双表示切换）；bdna 10s（1BNA 76KB 纯核酸）；antibody 18s（1IGT 1.14MB 大结构）
  xray-film:10:4HHB:46
  porcelain-studio:10:1CRN:47
  comic-pop:10:4HHB:48
  zn-finger-dna:12:1AAY:49
  bdna-dodecamer:10:1BNA:50
  antibody-architecture:18:1IGT:51
  # r104 膜类四新模板（wait 依据 r104 主代理 agent-browser 活体实测：装载 7-9s 由
  # 管线固定 sleep 7 吸收，此处 wait=apply 后命令执行+相机飞行+settling）：
  # selectivity 12s（12 命令 + zoom 特写飞行）；gpcr 15s（16 命令 + create 53ms +
  # 膜定位 + 开窗 + 40° 俯角 + zoom 飞行——膜类最长链）；porin 11s（9 命令 + 膜 +
  # orient 飞行）；toxin 13s（10 命令 + pore 计算 145ms/20324 原子 + 膜 + 顶视）
  selectivity-filter:12:1K4C:52
  gpcr-retinal-pocket:15:1F88:53
  beta-barrel-porin:11:1PHO:54
  toxin-pore-assembly:13:7AHL:55
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
