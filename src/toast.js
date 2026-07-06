// 模块：提示消息
// 作用：统一显示插件内的成功/警告/错误提示。优先复用 SillyTavern 的 toastr，
// 不可用时退回到一个轻量 DOM toast。
export function showToast(message, type = 'success') {
  if (window.toastr && typeof window.toastr[type] === 'function') {
    window.toastr[type](message);
    return;
  }

  const colors = {
    success: 'rgba(74, 222, 128, 0.92)',
    warning: 'rgba(251, 191, 36, 0.92)',
    error: 'rgba(239, 68, 68, 0.92)',
  };
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10001;max-width:320px;padding:12px 20px;border-radius:8px;font-size:14px;white-space:pre-line;background:' +
    (colors[type] || colors.success) + ';color:' + (type === 'warning' ? '#000' : '#fff');
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}
