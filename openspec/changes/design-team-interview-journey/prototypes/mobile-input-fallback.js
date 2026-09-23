(() => {
  const FALLBACK_TEXT = 'Для ввода поверните iPhone вертикально';
  const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'password', 'tel', 'url', 'number']);
  const ua = navigator.userAgent || '';
  const iphoneSafari = /iPhone/i.test(ua)
    && /AppleWebKit/i.test(ua)
    && /Safari/i.test(ua)
    && !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)/i.test(ua);
  let lastBlockedField = null;
  let rotateField = null;
  let settleTimer = 0;
  let savedScroll = [];

  const isLandscape = () => {
    const visual = window.visualViewport;
    return window.matchMedia?.('(orientation: landscape)').matches
      || Boolean(visual && visual.width > visual.height)
      || window.innerWidth > window.innerHeight;
  };

  const editableField = (node) => {
    const field = node?.closest?.('textarea, input, [contenteditable="true"]');
    if (!field || field.disabled || field.readOnly || field.getAttribute('aria-disabled') === 'true') return null;
    if (field.matches('textarea, [contenteditable="true"]')) return field;
    return TEXT_INPUT_TYPES.has((field.getAttribute('type') || '').toLowerCase()) ? field : null;
  };

  const fallback = document.createElement('aside');
  fallback.className = 'iphone-orientation-fallback';
  fallback.dataset.iphoneSafariOrientationFallback = '';
  fallback.hidden = true;
  fallback.setAttribute('role', 'alert');
  fallback.setAttribute('aria-live', 'assertive');
  fallback.setAttribute('aria-label', 'Ограничение ввода в горизонтальной ориентации');
  fallback.innerHTML = `
    <span class="iphone-orientation-fallback__mark" aria-hidden="true">↻</span>
    <span class="iphone-orientation-fallback__copy"><strong>${FALLBACK_TEXT}</strong><small>Просмотр и навигация остаются доступны. Черновик не отправлен.</small></span>
    <button type="button" data-orientation-fallback-close aria-label="Вернуться к просмотру">Понятно</button>
  `;

  const style = document.createElement('style');
  style.textContent = `
    .iphone-orientation-fallback {
      position: fixed;
      z-index: 10020;
      left: max(12px, env(safe-area-inset-left, 0px), var(--safe-left, 0px));
      right: max(12px, env(safe-area-inset-right, 0px), var(--safe-right, 0px));
      bottom: max(12px, env(safe-area-inset-bottom, 0px));
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 8px 8px 8px 12px;
      color: #10272b;
      background: #fff8df;
      border: 2px solid #b56a08;
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(16, 39, 43, .28);
    }
    .iphone-orientation-fallback[hidden] { display: none !important; }
    .iphone-orientation-fallback__mark { flex: 0 0 auto; font-size: 24px; line-height: 1; }
    .iphone-orientation-fallback__copy { display: grid; min-width: 0; gap: 1px; line-height: 1.15; }
    .iphone-orientation-fallback__copy strong,
    .iphone-orientation-fallback__copy small { overflow-wrap: anywhere; }
    .iphone-orientation-fallback__copy small { font-size: 11px; }
    .iphone-orientation-fallback button {
      flex: 0 0 auto;
      min-width: 72px;
      min-height: 44px;
      padding: 8px 12px;
      color: #10272b;
      background: white;
      border: 2px solid #10272b;
      border-radius: 4px;
      font: inherit;
      font-weight: 800;
      touch-action: manipulation;
    }
    .iphone-orientation-fallback button:focus-visible {
      outline: 3px solid #c85f16;
      outline-offset: 3px;
    }
    @media (max-width: 700px) and (orientation: landscape) {
      .iphone-orientation-fallback { bottom: 8px; padding-block: 5px; }
      .iphone-orientation-fallback__copy small { display: none; }
    }
  `;
  document.head.append(style);
  document.body.append(fallback);
  document.body.dataset.iphoneSafariInputFallback = 'off';
  document.body.dataset.iphoneSafariInputPolicy = iphoneSafari ? 'portrait-only' : 'not-claimed';

  const captureScroll = (field) => {
    const candidates = [document.scrollingElement, ...document.querySelectorAll('*')];
    savedScroll = candidates
      .filter((node) => node && (node.scrollTop || node.scrollLeft || node === document.scrollingElement || node.contains?.(field)))
      .map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft }));
  };

  const restoreScroll = () => {
    savedScroll.forEach(({ node, top, left }) => {
      if (node?.isConnected) {
        node.scrollTop = top;
        node.scrollLeft = left;
      }
    });
  };

  const preserveSelection = (field) => {
    if (!field || typeof field.setSelectionRange !== 'function') return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const direction = field.selectionDirection;
    requestAnimationFrame(() => {
      if (!field.isConnected || start == null || end == null) return;
      field.setSelectionRange(start, end, direction || 'none');
    });
  };

  const viewingFocusTarget = () => document.querySelector(
    '[data-room-open][aria-current="page"], [data-room-open][aria-pressed="true"], nav a[aria-current], main[tabindex], #main[tabindex]'
  );

  const showFallback = (field, { moveFocus = true } = {}) => {
    lastBlockedField = field || lastBlockedField;
    fallback.hidden = false;
    document.body.dataset.iphoneSafariInputFallback = 'shown';
    document.body.classList.add('iphone-safari-landscape-input-fallback');
    if (moveFocus) fallback.querySelector('[data-orientation-fallback-close]')?.focus({ preventScroll: true });
  };

  const hideFallback = () => {
    fallback.hidden = true;
    document.body.dataset.iphoneSafariInputFallback = iphoneSafari ? 'ready' : 'off';
    document.body.classList.remove('iphone-safari-landscape-input-fallback');
  };

  const blockDirectFocus = (event) => {
    if (!iphoneSafari || !isLandscape()) return;
    const field = editableField(event.target);
    if (!field) return;
    captureScroll(field);
    preserveSelection(field);
    event.preventDefault();
    event.stopImmediatePropagation();
    showFallback(field);
    requestAnimationFrame(restoreScroll);
  };

  ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach((type) => {
    document.addEventListener(type, blockDirectFocus, { capture: true, passive: false });
  });

  document.addEventListener('focusin', (event) => {
    if (!iphoneSafari || !isLandscape()) return;
    const field = editableField(event.target);
    if (!field) return;
    captureScroll(field);
    preserveSelection(field);
    field.blur();
    showFallback(field);
    requestAnimationFrame(restoreScroll);
  }, true);

  const settleOrientation = () => {
    if (!iphoneSafari) return;
    window.clearTimeout(settleTimer);
    const field = editableField(document.activeElement);
    if (isLandscape()) {
      if (field) {
        rotateField = field;
        lastBlockedField = field;
        captureScroll(field);
        preserveSelection(field);
        field.blur();
      }
      if (!rotateField) return;
      settleTimer = window.setTimeout(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          restoreScroll();
          showFallback(rotateField);
        }));
      }, 140);
      return;
    }
    rotateField = null;
    hideFallback();
    requestAnimationFrame(restoreScroll);
  };

  window.addEventListener('orientationchange', settleOrientation, true);
  window.addEventListener('resize', settleOrientation, true);
  window.visualViewport?.addEventListener('resize', settleOrientation, true);

  fallback.querySelector('[data-orientation-fallback-close]').addEventListener('click', () => {
    hideFallback();
    const target = viewingFocusTarget();
    target?.focus?.({ preventScroll: true });
  });

  window.__prototypeMobileInputFallback = {
    isIPhoneSafari: () => iphoneSafari,
    isLandscape,
    show: () => showFallback(lastBlockedField),
    hide: hideFallback,
    snapshot: () => ({
      iPhoneSafari: iphoneSafari,
      landscape: isLandscape(),
      shown: !fallback.hidden,
      lastField: lastBlockedField?.id || lastBlockedField?.dataset?.roomPanel || lastBlockedField?.tagName || null,
      rotateField: rotateField?.id || rotateField?.tagName || null,
    }),
  };
})();
