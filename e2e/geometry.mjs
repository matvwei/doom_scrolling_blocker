/**
 * Геометрические инварианты UI настроек и popup — проверка только в реальном
 * браузере (jsdom не имеет layout, поэтому этих проверок нет в unit-тестах).
 *
 * Инвариант (горизонтальный; вертикаль не проверяется — popup и страница
 * легитимно скроллятся по вертикали, и top/bottom у элементов за пределами
 * вьюпорта — норма):
 *
 *  1. Каждый проверяемый элемент (видимые интерактивные контролы и
 *     текстовые элементы, CHECKED_SELECTOR) целиком помещается внутри
 *     ближайшего контейнера-предка (CONTAINER_SELECTOR) по горизонтали:
 *     left >= container.left − EPS и right <= container.right + EPS.
 *  2. Текстовые диапазоны элемента (Range.getClientRects по текстовым узлам):
 *     (a) внутри его собственной border box (допуск EPS_TEXT на кернинг/
 *     начертание), (b) внутри ближайшего контейнера (EPS). Это ловит «буквы
 *     за пределами контейнера» даже тогда, когда box самого элемента выглядит
 *     нормально (регресс: `.field input { width:100% }` растягивало radio
 *     input на всю ширину label и выталкивало текст за правый край карточки).
 *  3. Нет отрицательных горизонтальных координат и выхода вправо за
 *     viewport: left >= −EPS и right <= documentElement.clientWidth + EPS
 *     для элементов и текстовых диапазонов.
 *  4. Горизонтального переполнения нет: у каждого контейнера
 *     scrollWidth <= clientWidth + EPS; то же для document/body.
 *
 * Разумный набор проверяемых элементов (не буквально все DOM-узлы):
 *  - интерактивные: button, input, select, textarea, label;
 *  - текстовые: h1–h3, p, code, .field__label, .field__error, .status,
 *    .card__title, .service__name, .service__blocked, .stat__label,
 *    .stat__value, .popup__footer.
 *
 * Осознанные ограничения:
 *  - Скрытые элементы пропускаются: display:none/visibility:hidden поддеревья
 *    (например, поле URL перенаправления при действии != redirect) геометрии
 *    не имеют; визуально скрытые controls (switch input 0×0) проверяются по
 *    box, текстовых диапазонов у них нет.
 *  - input/select/textarea не проверяются на text-range: их значение — не
 *     текстовые узлы; для них проверяется только box элемента.
 *  - Pixel-perfect снапшоты не используются: только инклюзия в контейнеры
 *    с малым допуском, поэтому проверка не хрупкая к шрифтам/платформе.
 */

/** Допуск на субпиксельные/округлительные различия box-границ, px. */
const EPS = 1;
/** Допуск для «текст внутри собственной box элемента», px (кернинг/начертание). */
const EPS_TEXT = 2;

/**
 * Контейнеры, задающие границы контента. Каждый проверяемый элемент и его
 * текстовые диапазоны обязаны помещаться в ближайший контейнер-предок;
 * дополнительно у контейнера не должно быть горизонтального переполнения.
 */
const CONTAINER_SELECTOR = [
  '.popup',
  '.popup__panel',
  '.popup__header',
  '.services',
  '.service',
  '.service__head',
  '.service__stats',
  '.settings',
  '.settings__bar',
  '.options',
  '.options__header',
  '.options__cards',
  '.options__custom',
  '.options__custom-head',
  '.options__actions',
  '.card',
  '.card__head',
  '.card__head-actions',
  '.add-site',
  '.field',
  '.radio-row',
  '.radio',
].join(', ');

/** Проверяемые элементы: видимые интерактивные контролы и текстовые. */
const CHECKED_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'h1',
  'h2',
  'h3',
  'p',
  'code',
  '.field__label',
  '.field__error',
  '.status',
  '.card__title',
  '.service__name',
  '.service__blocked',
  '.stat__label',
  '.stat__value',
  '.popup__footer',
].join(', ');

/**
 * Собирает нарушения геометрии на странице (без побочных эффектов).
 * Возвращает { violations: string[], stats: { containers, checked, textRects } }.
 */
export async function collectGeometryViolations(page) {
  return page.evaluate(
    ({ containerSelector, checkedSelector, eps, epsText }) => {
      const violations = [];
      const describe = (el) => {
        const id = el.id ? `#${el.id}` : '';
        const cls =
          typeof el.className === 'string' && el.className
            ? `.${el.className.trim().split(/\s+/).join('.')}`
            : '';
        return `${el.tagName.toLowerCase()}${id}${cls}`;
      };
      const isRendered = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
      };
      const fmt = (n) => n.toFixed(1);
      const doc = document.documentElement;
      const docWidth = doc.clientWidth;

      // Ин. 4: у контейнеров нет горизонтального переполнения.
      let containerCount = 0;
      for (const el of document.querySelectorAll(containerSelector)) {
        if (!isRendered(el)) continue;
        containerCount += 1;
        if (el.scrollWidth > el.clientWidth + eps) {
          violations.push(
            `контейнер ${describe(el)}: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
          );
        }
      }

      // Текстовые диапазоны элемента (значения input/select/textarea — не текстовые узлы).
      const textRectsOf = (el) => {
        const rects = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) rects.push(r);
        }
        return rects;
      };

      let checkedCount = 0;
      let textRectCount = 0;
      for (const el of document.querySelectorAll(checkedSelector)) {
        if (!isRendered(el)) continue;
        checkedCount += 1;
        const r = el.getBoundingClientRect();
        // Ближайший контейнер-предок (не сам элемент: .radio и контейнер, и label).
        const container = el.parentElement ? el.parentElement.closest(containerSelector) : null;
        const cr = container ? container.getBoundingClientRect() : null;

        // Ин. 3: нет отрицательных координат и выхода вправо за viewport.
        if (r.left < -eps) violations.push(`${describe(el)}: left ${fmt(r.left)} < 0`);
        if (r.right > docWidth + eps) {
          violations.push(`${describe(el)}: right ${fmt(r.right)} > ширина документа ${docWidth}`);
        }
        // Ин. 1: box элемента внутри ближайшего контейнера.
        if (cr && (r.left < cr.left - eps || r.right > cr.right + eps)) {
          violations.push(
            `${describe(el)}: box [${fmt(r.left)}..${fmt(r.right)}] вне контейнера ` +
              `${describe(container)} [${fmt(cr.left)}..${fmt(cr.right)}]`,
          );
        }

        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
          continue;
        }
        for (const tr of textRectsOf(el)) {
          textRectCount += 1;
          if (tr.left < -eps) violations.push(`текст в ${describe(el)}: left ${fmt(tr.left)} < 0`);
          if (tr.right > docWidth + eps) {
            violations.push(`текст в ${describe(el)}: right ${fmt(tr.right)} > ширина документа ${docWidth}`);
          }
          // Ин. 2a: текст внутри собственной box элемента.
          if (tr.left < r.left - epsText || tr.right > r.right + epsText) {
            violations.push(
              `текст [${fmt(tr.left)}..${fmt(tr.right)}] вне box элемента ` +
                `${describe(el)} [${fmt(r.left)}..${fmt(r.right)}]`,
            );
          }
          // Ин. 2b: текст внутри ближайшего контейнера.
          if (cr && (tr.left < cr.left - eps || tr.right > cr.right + eps)) {
            violations.push(
              `текст [${fmt(tr.left)}..${fmt(tr.right)}] вне контейнера ` +
                `${describe(container)} [${fmt(cr.left)}..${fmt(cr.right)}]`,
            );
          }
        }
      }

      // Ин. 4: документ без горизонтального переполнения.
      if (doc.scrollWidth > doc.clientWidth + eps) {
        violations.push(`document: scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}`);
      }
      if (document.body.scrollWidth > doc.clientWidth + eps) {
        violations.push(`body: scrollWidth ${document.body.scrollWidth} > clientWidth ${doc.clientWidth}`);
      }

      return {
        violations,
        stats: { containers: containerCount, checked: checkedCount, textRects: textRectCount },
      };
    },
    { containerSelector: CONTAINER_SELECTOR, checkedSelector: CHECKED_SELECTOR, eps: EPS, epsText: EPS_TEXT },
  );
}

/**
 * Прогоняет геометрические проверки страницы и регистрирует результат
 * через переданный check(name, condition) из e2e.mjs (общий счётчик).
 */
export async function checkGeometry(check, name, page) {
  const { violations, stats } = await collectGeometryViolations(page);
  if (violations.length > 0) {
    console.error(`    нарушения геометрии (${violations.length}):`);
    for (const v of violations.slice(0, 12)) console.error(`      - ${v}`);
  }
  check(
    `${name} [контейнеров: ${stats.containers}, элементов: ${stats.checked}, текст. диапазонов: ${stats.textRects}]`,
    violations.length === 0,
  );
}
