// Locale-aware dates, numbers and the habit heatmap for Ritim's screens, formatted the way SwiftUI formats them for the
// capture's language (<html lang>). "Today" is fixed so every capture shows the same demo day.
(() => {
  const lang = document.documentElement.lang || 'en-US';
  const today = new Date(2026, 9, 27); // Tuesday, October 27, 2026
  const day = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + Number(offset));
    return d;
  };
  const formats = {
    // .dateTime.weekday(.wide).day().month(.wide) → "Tuesday, October 27" / "27 Ekim Salı"
    long: { weekday: 'long', month: 'long', day: 'numeric' },
    // .weekday(.abbreviated) and .day().month(.abbreviated) on chart axes
    weekday: { weekday: 'short' },
    monthDay: { month: 'short', day: 'numeric' },
  };
  for (const el of document.querySelectorAll('[data-date]')) {
    el.textContent = new Intl.DateTimeFormat(lang, formats[el.dataset.fmt || 'long']).format(day(el.dataset.date));
  }
  for (const el of document.querySelectorAll('[data-pct]')) {
    el.textContent = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(Number(el.dataset.pct));
  }
  for (const el of document.querySelectorAll('[data-num]')) el.textContent = new Intl.NumberFormat(lang).format(Number(el.dataset.num));
  for (const el of document.querySelectorAll('[data-time]')) {
    const [h, m] = el.dataset.time.split(':').map(Number);
    el.textContent = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 9, 27, h, m));
  }

  // HabitHeatmap: one column per week starting on the locale's first weekday, one row per weekday, today outlined.
  for (const el of document.querySelectorAll('[data-heatmap]')) {
    const weeks = Number(el.dataset.weeks || 12);
    const start = new Date(el.dataset.start + 'T00:00:00');
    const done = el.dataset.heatmap;
    const info = new Intl.Locale(lang);
    const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay ?? (lang === 'en-US' ? 7 : 1); // 1 = Monday … 7 = Sunday
    const first = firstDay % 7; // JS: 0 = Sunday
    const weekStart = day(-((today.getDay() - first + 7) % 7));
    const firstWeek = new Date(weekStart);
    firstWeek.setDate(firstWeek.getDate() - 7 * (weeks - 1));
    const narrow = new Intl.DateTimeFormat(lang, { weekday: 'narrow' });
    const labels = document.createElement('div');
    labels.className = 'hm-col';
    for (let r = 0; r < 7; r++) {
      const d = new Date(firstWeek);
      d.setDate(d.getDate() + r);
      labels.insertAdjacentHTML('beforeend', `<span class="hm-label">${narrow.format(d)}</span>`);
    }
    el.append(labels);
    for (let w = 0; w < weeks; w++) {
      const col = document.createElement('div');
      col.className = 'hm-col';
      for (let r = 0; r < 7; r++) {
        const d = new Date(firstWeek);
        d.setDate(d.getDate() + w * 7 + r);
        const index = Math.round((d - start) / 86400000);
        const state = d > today ? 'future' : index < 0 ? 'none' : done[index] === '1' ? 'on' : 'off';
        col.insertAdjacentHTML('beforeend', `<span class="hm-cell ${state}${+d === +today ? ' today' : ''}"></span>`);
      }
      el.append(col);
    }
  }
})();
