import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
const files = process.argv.slice(2);
const zai = await ZAI.create();
for (const f of files) {
  const b64 = fs.readFileSync(f).toString('base64');
  const res = await zai.chat.completions.create({
    messages: [{ role: 'user', content: [
      { type: 'text', text: '这是一个分子可视化工具的截图。请描述：1) 当前显示的是什么表示法？2) 是否可见青色(cyan)虚线（氢键网络）？3) 页面整体是否正常渲染，有无明显 UI 错乱或报错浮层？简洁回答（3行内）。' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }
    ]}],
    model: 'glm-4.5v', max_tokens: 300
  });
  console.log('===', f, '=>\n', res.choices[0].message.content);
}
