// 图像导出下载收敛（r101-a）：png / ray 两个导出口（Toolbar capture/rayCapture 与 commands
// png/ray 命令）共用的 <a> 下载原语——此前四处各复制一份 document.createElement('a') 代码。
// svg 口已有自己的共享下载 downloadSvg（svg-export.ts，Blob 型），保持不动。
// 纯函数零依赖：不引 toast/i18n——成功/失败文案留在调用点（各处文案差异丰富）。
// 文件名构造也留在调用点（透明后缀的 tt 双语语义等随调用方语境）。

/** 把 dataURL 作为指定文件名的下载触发（浏览器惯用 <a download> 通路） */
export function downloadDataUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}
