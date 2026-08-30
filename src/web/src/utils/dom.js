/**
 * jQuery 없이 쓰는 DOM 조작 유틸 모음(select/class/style/content/애니메이션 등). window/global에도 노출되며, 실제로는 select,
 * selectAll, on, find, closest, hasClass, addClass, removeClass 정도만 코드베이스 전반에서 쓰이고 나머지 메서드는 현재 호출부가
 * 없다.
 *
 * jQuery-free DOM utility collection (selection/class/style/content/animation helpers), exposed on
 * window/global; in practice only select, selectAll, on, find, closest, hasClass, addClass and
 * removeClass are actually called anywhere in the codebase today.
 */

const DOM = {
  // 요소 선택
  select: selector => document.querySelector(selector),
  selectAll: selector => [...document.querySelectorAll(selector)],
  exists: selector => document.querySelector(selector) !== null,

  // 이벤트 바인딩
  on: (element, event, handler) => element.addEventListener(event, handler),
  off: (element, event, handler) => element.removeEventListener(event, handler),
  trigger: (element, event, data = {}) => {
    const customEvent = new CustomEvent(event, { detail: data });
    element.dispatchEvent(customEvent);
  },

  // DOM 탐색
  find: (element, selector) => element.querySelector(selector),
  findAll: (element, selector) => [...element.querySelectorAll(selector)],
  closest: (element, selector) => element.closest(selector),
  parent: element => element.parentElement,
  children: element => [...element.children],
  siblings: element => [...element.parentElement.children].filter(el => el !== element),

  // 클래스 조작
  hasClass: (element, className) => element.classList.contains(className),
  addClass: (element, className) => element.classList.add(className),
  removeClass: (element, className) => element.classList.remove(className),
  toggleClass: (element, className) => element.classList.toggle(className),

  // 스타일 조작 (get/set 겸용)
  css: (element, property, value) => {
    if (typeof property === 'object') {
      // Set multiple styles: DOM.css(el, {color: 'red', fontSize: '14px'})
      Object.entries(property).forEach(([prop, val]) => {
        element.style[prop] = val;
      });
    } else if (value !== undefined) {
      // Set single style: DOM.css(el, 'color', 'red')
      element.style[property] = value;
    } else {
      // Get style: DOM.css(el, 'color')
      return getComputedStyle(element)[property];
    }
  },

  // 크기 측정
  width: element => element.offsetWidth,
  height: element => element.offsetHeight,
  outerWidth: element => {
    const rect = element.getBoundingClientRect();
    const computedStyle = getComputedStyle(element);
    return (
      rect.width + parseFloat(computedStyle.marginLeft) + parseFloat(computedStyle.marginRight)
    );
  },
  outerHeight: element => {
    const rect = element.getBoundingClientRect();
    const computedStyle = getComputedStyle(element);
    return (
      rect.height + parseFloat(computedStyle.marginTop) + parseFloat(computedStyle.marginBottom)
    );
  },

  // 콘텐츠 get/set
  html: (element, content) => {
    if (content !== undefined) {
      element.innerHTML = content;
    } else {
      return element.innerHTML;
    }
  },
  text: (element, content) => {
    if (content !== undefined) {
      element.textContent = content;
    } else {
      return element.textContent;
    }
  },
  val: (element, value) => {
    if (value !== undefined) {
      element.value = value;
    } else {
      return element.value;
    }
  },

  // 속성 get/set
  attr: (element, name, value) => {
    if (value !== undefined) {
      element.setAttribute(name, value);
    } else {
      return element.getAttribute(name);
    }
  },
  removeAttr: (element, name) => element.removeAttribute(name),
  data: (element, key, value) => {
    const dataKey = `data-${key}`;
    if (value !== undefined) {
      element.setAttribute(dataKey, value);
    } else {
      return element.getAttribute(dataKey);
    }
  },

  // 요소 삽입/삭제
  append: (parent, child) => {
    if (typeof child === 'string') {
      parent.insertAdjacentHTML('beforeend', child);
    } else {
      parent.appendChild(child);
    }
  },
  prepend: (parent, child) => {
    if (typeof child === 'string') {
      parent.insertAdjacentHTML('afterbegin', child);
    } else {
      parent.insertBefore(child, parent.firstChild);
    }
  },
  after: (element, newElement) => {
    if (typeof newElement === 'string') {
      element.insertAdjacentHTML('afterend', newElement);
    } else {
      element.parentNode.insertBefore(newElement, element.nextSibling);
    }
  },
  before: (element, newElement) => {
    if (typeof newElement === 'string') {
      element.insertAdjacentHTML('beforebegin', newElement);
    } else {
      element.parentNode.insertBefore(newElement, element);
    }
  },
  remove: element => element.remove(),
  clone: (element, deep = true) => element.cloneNode(deep),

  // 표시/숨김
  show: element => {
    element.style.display = '';
  },
  hide: element => {
    element.style.display = 'none';
  },
  toggle: element => {
    element.style.display = element.style.display === 'none' ? '' : 'none';
  },

  // 슬라이드/페이드 애니메이션 (jQuery 스타일)
  // NOTE: For new code, prefer using Bootstrap 5's Collapse component:
  //   - Add 'collapse' class to element
  //   - Use data-bs-toggle="collapse" on trigger
  //   - Or use: new bootstrap.Collapse(element).show/hide()
  // These functions are kept for backward compatibility with existing code.
  slideDown: (element, duration = 300) => {
    element.style.height = '0px';
    element.style.overflow = 'hidden';
    element.style.transition = `height ${duration}ms ease`;
    element.style.display = 'block';

    // Get the natural height
    const height = element.scrollHeight + 'px';

    // Animate to natural height
    requestAnimationFrame(() => {
      element.style.height = height;
    });

    // Clean up after animation
    setTimeout(() => {
      element.style.height = 'auto';
      element.style.overflow = '';
      element.style.transition = '';
    }, duration);
  },

  slideUp: (element, duration = 300) => {
    element.style.height = element.scrollHeight + 'px';
    element.style.overflow = 'hidden';
    element.style.transition = `height ${duration}ms ease`;

    // Animate to zero height
    requestAnimationFrame(() => {
      element.style.height = '0px';
    });

    // Hide element after animation
    setTimeout(() => {
      element.style.display = 'none';
      element.style.height = '';
      element.style.overflow = '';
      element.style.transition = '';
    }, duration);
  },

  slideToggle: (element, duration = 300) => {
    if (element.style.display === 'none' || element.offsetHeight === 0) {
      DOM.slideDown(element, duration);
    } else {
      DOM.slideUp(element, duration);
    }
  },

  fadeIn: (element, duration = 300) => {
    element.style.opacity = '0';
    element.style.display = 'block';
    element.style.transition = `opacity ${duration}ms ease`;

    requestAnimationFrame(() => {
      element.style.opacity = '1';
    });

    setTimeout(() => {
      element.style.transition = '';
    }, duration);
  },

  fadeOut: (element, duration = 300) => {
    element.style.transition = `opacity ${duration}ms ease`;
    element.style.opacity = '0';

    setTimeout(() => {
      element.style.display = 'none';
      element.style.transition = '';
      element.style.opacity = '';
    }, duration);
  },

  // DOMContentLoaded 이후 실행 보장
  ready: callback => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
    } else {
      callback();
    }
  },

  // 위치/오프셋
  offset: element => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX
    };
  },

  position: element => {
    return {
      top: element.offsetTop,
      left: element.offsetLeft
    };
  },

  // 스크롤 위치 get/set
  scrollTop: (element, value) => {
    if (value !== undefined) {
      element.scrollTop = value;
    } else {
      return element.scrollTop;
    }
  },

  scrollLeft: (element, value) => {
    if (value !== undefined) {
      element.scrollLeft = value;
    } else {
      return element.scrollLeft;
    }
  }
};

// 전역에도 노출 (레거시 코드/콘솔 디버깅용)
window.DOM = DOM;
globalThis.DOM = DOM;

// Export for module usage
export default DOM;
