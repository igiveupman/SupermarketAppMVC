(function(){
  const root = document.documentElement;
  let rafId = null;
  let pending = false;
  const update = (x,y) => {
    root.style.setProperty('--light-x', x + 'px');
    root.style.setProperty('--light-y', y + 'px');
  };
  const handleMove = (e) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const x = e.clientX;
    const y = e.clientY;
    if (pending) return;
    pending = true;
    rafId = requestAnimationFrame(()=> { update(x,y); pending = false; });
  };
  window.addEventListener('mousemove', handleMove, { passive:true });
})();
