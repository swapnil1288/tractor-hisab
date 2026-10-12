(() => {
  if (window.__tractorNative || !window.TractorNative) return;
  window.__tractorNative = true;
  const pending = new Map();
  let seq = 0;
  window.__tractorResult = (id, value, error) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    error ? entry.reject(new Error(error)) : entry.resolve(value);
  };
  function request(type, extra = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++seq);
      pending.set(id, { resolve, reject });
      TractorNative.postMessage(JSON.stringify({ id, type, ...extra }));
    });
  }
  Object.defineProperty(navigator, 'contacts', { configurable: true, value: {
    select: () => request('contact'), getProperties: async () => ['name', 'tel']
  } });
  async function saveAnchor(a) {
    try {
      const blob = await fetch(a.href).then(r => r.blob());
      if (blob.size > 20 * 1024 * 1024) throw new Error('File is too large (maximum 20 MB)');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await request('save', { data, name: a.download || 'hisab.pdf', mime: blob.type });
    } catch (e) { alert(e.message || 'Could not save file'); }
  }
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && this.href.startsWith('blob:')) {
      void saveAnchor(this); return;
    }
    return nativeClick.call(this);
  };
  document.addEventListener('click', event => {
    const a = event.target.closest && event.target.closest('a[download]');
    if (!a || !a.href.startsWith('blob:')) return;
    event.preventDefault();
    void saveAnchor(a);
  }, true);
})();
