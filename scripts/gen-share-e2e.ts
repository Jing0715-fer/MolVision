// r86 E2E 辅助：手工构造合法 ShareSnapshot → base64url 分享链接（模拟发送方产物）。
// 与 r85 接收端 E2E 同法；用于欢迎页「从分享链接加载」粘贴卡全旅程。
// 用法：bunx tsx scripts/gen-share-e2e.ts [full|bare]  → stdout 输出链接文本
const SNAP = {
  format: 'molvision-share',
  version: 1,
  savedAt: Date.now(),
  activeIndex: 0,
  structures: [
    {
      name: '4HHB',
      format: 'pdb',
      pdbId: '4HHB',
      reps: [
        {
          id: 'e2e00001',
          type: 'cartoon',
          selection: 'all',
          colorScheme: 'spectrum',
          uniformColor: '#c9cdd4',
          visible: true,
          ballScale: 1,
          stickRadius: 0.3,
          cartoonWidth: 1,
          probe: 1.4,
          opacity: 1,
          puttyRange: 0,
        },
      ],
      colorOverrides: {},
      visible: true,
    },
  ],
  skippedLocal: 0,
  settings: { background: '#ffffff', backgroundPinned: true, showHBonds: false },
  camera: {
    pos: [42.5, 31.2, 58.9],
    target: [0.5, -0.3, 0.2],
    up: [0, 1, 0],
    fov: 50,
  },
  namedSelections: [],
}

const json = JSON.stringify(SNAP)
const bytes = new TextEncoder().encode(json)
let bin = ''
for (let i = 0; i < bytes.length; i += 0x8000) {
  bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
}
const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const mode = process.argv[2] ?? 'full'
if (mode === 'bare') {
  console.log(`#s=${b64}`)
} else {
  console.log(`http://localhost:3000/#s=${b64}`)
}
