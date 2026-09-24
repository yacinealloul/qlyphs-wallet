/** Local, interruptible motion. No delays in navigation or wallet actions. */
export function walletMotion(nav: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const indicator = document.createElement('span');
  indicator.className = 'tab-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  nav.prepend(indicator);
  let frame = 0,
    last = 0,
    x = 0,
    velocity = 0,
    target = 0,
    ready = false;
  const animations = new Map<HTMLElement, Animation>();
  function paint() {
    indicator.style.transform = `translateX(${x}px)`;
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    velocity = 0;
    x = target;
    paint();
    nav.dataset.motionState = 'idle';
  }
  function tick(time: number) {
    // Fixed-size substeps keep the critically damped spring stable after slow frames.
    let remaining = Math.min((time - last) / 1000, 0.064);
    last = time;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 120);
      velocity += (800 * (target - x) - 57 * velocity) * dt;
      x += velocity * dt;
      remaining -= dt;
    }
    paint();
    if (Math.abs(target - x) < 0.08 && Math.abs(velocity) < 0.15) stop();
    else frame = requestAnimationFrame(tick);
  }
  function select(animate = false) {
    const selected = nav.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selected || !nav.getClientRects().length || !selected.offsetWidth) return;
    target = selected.offsetLeft;
    indicator.style.width = selected.offsetWidth + 'px';
    indicator.style.height = selected.offsetHeight + 'px';
    indicator.style.top = selected.offsetTop + 'px';
    if (!ready || !animate || reduced.matches) stop();
    else if (!frame && Math.abs(target - x) > 0.08) {
      last = performance.now();
      nav.dataset.motionState = 'moving';
      frame = requestAnimationFrame(tick);
    }
    ready = true;
    nav.dataset.motionReady = 'true';
  }
  function cancel() {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  }
  function reveal(element: HTMLElement, animate: boolean, flow = false) {
    cancel();
    if (!animate || reduced.matches || !element.getClientRects().length) return;
    const animation = element.animate(
      flow
        ? [
            { opacity: 0.65, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ]
        : [{ opacity: 0.72 }, { opacity: 1 }],
      { duration: flow ? 170 : 120, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    animations.set(element, animation);
    void animation.finished
      .then(() => {
        if (animations.get(element) === animation) animations.delete(element);
      })
      .catch(() => undefined);
  }
  const observer = new ResizeObserver(() => select());
  observer.observe(nav);
  nav.querySelectorAll<HTMLElement>('[role=tab]').forEach((tab) => observer.observe(tab));
  const onReduce = () => {
    cancel();
    select();
  };
  const onVisibility = () => {
    if (document.hidden) {
      cancel();
      stop();
    }
  };
  reduced.addEventListener('change', onReduce);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener(
    'pagehide',
    () => {
      stop();
      cancel();
      observer.disconnect();
      reduced.removeEventListener('change', onReduce);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    { once: true },
  );
  return { select, reveal, cancel };
}

/** Every wallet tab shares native scrolling and a sticky navigation landmark. */
export function walletScroll(wallet: HTMLElement) {
  const home = wallet.querySelector<HTMLElement>('.wallet-home')!;
  let frame = 0;
  const sync = () => {
    frame = 0;
    wallet.dataset.scrolled = String(wallet.scrollTop >= home.offsetHeight + 12);
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(sync);
  };
  wallet.addEventListener('scroll', onScroll, { passive: true });
  const observer = new ResizeObserver(onScroll);
  observer.observe(home);
  window.addEventListener(
    'pagehide',
    () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      wallet.removeEventListener('scroll', onScroll);
    },
    { once: true },
  );
  return sync;
}
