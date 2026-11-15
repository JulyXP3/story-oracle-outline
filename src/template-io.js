// 模块：模板导入 / 导出
// 作用：提供 .txt 文件形式的模板导入（多选）与导出（当前选中模板）。
// 导入的文件：文件名（去 .txt 后缀）= 模板名，文件全文 = 模板内容；重名自动加「（2）」后缀，不覆盖。
// 导出的文件：'<模板名>.txt'，可直接再导入，形成分享闭环。
import { LOG_PREFIX } from './constants.js';
import { addTemplates, getTemplate } from './templates.js';
import { currentTier } from './storage.js';
import { showToast } from './toast.js';

const TXT_EXT = /\.txt$/i;

// 同一批导入在存储写队列中计算重名后缀，不逐个保存整张模板表。

// 读取 File 对象文本。File.text() 在旧浏览器缺失时退回 FileReader。
function readAsText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// 批量导入：files 为 input.files。返回成功数。
export async function importTemplatesFromFiles(files) {
  const list = Array.from(files || []).filter((f) => TXT_EXT.test(f.name));
  if (!list.length) {
    showToast('未选择 .txt 文件', 'warning');
    return 0;
  }
  const candidates = [];
  for (const file of list) {
    try {
      const content = await readAsText(file);
      candidates.push({ name: file.name.replace(TXT_EXT, '') || '导入模板', content });
    } catch (e) {
      console.warn(LOG_PREFIX + '导入模板读取失败:', file.name, e);
      showToast('读取「' + file.name + '」失败，其他可读文件仍会导入', 'error');
    }
  }
  if (!candidates.length) return 0;
  const created = await addTemplates(candidates);
  if (!created) {
    showToast('导入未保存，请保留原文件后重试', 'error');
    return 0;
  }
  const tier = currentTier();
  const destination = tier === 'server' ? '服务端' : '本浏览器（' + (tier === 'idb' ? 'IndexedDB' : 'localStorage') + '，尚未同步服务端）';
  showToast('已导入 ' + created.length + ' 个模板到' + destination, tier === 'server' ? 'success' : 'warning');
  return created.length;
}

// 导出单个模板为 .txt 下载。
export function exportTemplateAsFile(templateId) {
  const t = getTemplate(templateId);
  if (!t || !t.id) {
    showToast('未找到要导出的模板', 'warning');
    return;
  }
  const blob = new Blob([t.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (t.name || '模板') + '.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
