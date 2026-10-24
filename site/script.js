// Copy buttons, and autoplay of the style samples only while they are on screen.
document.querySelectorAll('.copy').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
      button.classList.add('done');
      setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('done');
      }, 1600);
    } catch {
      button.textContent = 'Press ⌘C';
    }
  });
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (reduceMotion) {
  // Respect the setting: show posters, let people press play themselves.
  document.querySelectorAll('video').forEach((video) => {
    video.removeAttribute('autoplay');
    video.pause();
    video.controls = true;
  });
} else if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target;
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      }
    },
    { threshold: 0.35 },
  );
  document.querySelectorAll('video[data-autoplay]').forEach((video) => observer.observe(video));
}
