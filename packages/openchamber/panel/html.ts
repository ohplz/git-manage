/**
 * html 标签模板函数
 * 用于创建 DOM 元素，替代 document.createElement
 *
 * 使用示例:
 * const el = html`<div class="foo">${content}</div>`;
 * const el = html`<button onclick=${handler}>Click</button>`;
 *
 * 插值一律按文本转义后插入，只有 raw() 显式标记的片段才作为 HTML 原样插入。
 * 不要把「字符串以 < 开头」当作可信依据：提交信息、分支名、文件路径等来自 git
 * 的数据完全可以以 < 开头（如 `<img src=x onerror=...>`），
 * 一旦原样插入 innerHTML 就是可执行的脚本。
 */

type EventAttributes = {
  [K in keyof HTMLElementEventMap as `on${K}`]?: (e: HTMLElementEventMap[K]) => void;
};

type HtmlAttributes = Partial<Omit<HTMLElement, 'style' | 'children'>> & EventAttributes & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  ref?: { current: HTMLElement | null };
};

/**
 * 可信 HTML 标记
 * 只有经 raw() 包装的片段才会被原样插入；模块外部无法伪造该 Symbol
 */
const TRUSTED_HTML: unique symbol = Symbol('gm.trusted-html');

/** raw() 生成的可信 HTML 片段 */
export interface TrustedHtml {
  readonly [TRUSTED_HTML]: string;
}

/**
 * 把扩展自身生成的 HTML 片段标记为可信（原样插入，不再转义）
 * 只能用于常量或由常量拼出的静态结构（如内置 svg 图标、已自行转义的列片段）；
 * 任何来自 git、用户输入或网络的数据都必须保持普通字符串。
 * @param markup 扩展自身生成的 HTML 文本
 * @returns 带可信标记的片段
 */
export function raw(markup: string): TrustedHtml {
  return { [TRUSTED_HTML]: markup };
}

/**
 * 判断插值是否为 raw() 生成的可信 HTML 片段
 * @param value 模板插值
 * @returns 是可信片段返回 true
 */
function isTrustedHtml(value: unknown): value is TrustedHtml {
  return typeof value === 'object' && value !== null && TRUSTED_HTML in value;
}

/**
 * html 标签模板函数
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): HTMLElement {
  const parts: string[] = [];
  const domElements: (HTMLElement | SVGElement)[][] = [];

  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i]);
    if (i < values.length) {
      const value = values[i];
      if (value == null || value === false) {
        // 忽略 null/undefined/false
      } else if (isTrustedHtml(value)) {
        // 仅 raw() 显式标记的片段原样插入（内置图标等），逐字来自仓库的文本永远走转义分支
        parts.push(value[TRUSTED_HTML]);
      } else if (typeof value === 'string') {
        parts.push(escapeHTML(value));
      } else if (typeof value === 'number') {
        parts.push(String(value));
      } else if (typeof value === 'boolean') {
        parts.push(value ? 'true' : '');
      } else if (Array.isArray(value)) {
        const arrElements: (HTMLElement | SVGElement)[] = [];
        for (const item of value) {
          if (item instanceof HTMLElement || item instanceof SVGElement) {
            arrElements.push(item);
            parts.push(`<!--m-${domElements.length}-${arrElements.length - 1}-->`);
          } else if (isTrustedHtml(item)) {
            parts.push(item[TRUSTED_HTML]);
          } else {
            parts.push(escapeHTML(String(item ?? '')));
          }
        }
        if (arrElements.length > 0) {
          domElements.push(arrElements);
        }
      } else if (value instanceof HTMLElement || value instanceof SVGElement) {
        const idx = domElements.length;
        domElements.push([value]);
        parts.push(`<!--m-${idx}-0-->`);
      }
    }
  }

  const rawHTML = parts.join('');
  const container = document.createElement('div');
  container.style.display = 'none';
  document.body.appendChild(container);

  try {
    container.innerHTML = rawHTML;

    const root = container.firstElementChild as HTMLElement;
    if (!root) {
      throw new Error('无法解析 HTML 模板');
    }

    // 遍历所有注释节点，替换为实际的 DOM 元素
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null);
    const comments: Comment[] = [];
    let node: Comment | null;
    while ((node = walker.nextNode() as Comment | null)) {
      comments.push(node);
    }

    for (const comment of comments) {
      const text = comment.textContent || '';
      const match = text.match(/^m-(\d+)-(\d+)$/);
      if (match) {
        const [, groupIdx, elemIdx] = match;
        const group = domElements[parseInt(groupIdx)];
        if (group) {
          const elem = group[parseInt(elemIdx)];
          if (elem) {
            comment.parentNode?.replaceChild(elem, comment);
          }
        }
      }
    }

    return root;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 辅助函数：创建带属性的元素
 */
export function h(
  tag: string,
  attrs?: HtmlAttributes | null,
  ...children: (HTMLElement | string | number | boolean | null)[]
): HTMLElement {
  const el = document.createElement(tag);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value != null) {
        setAttribute(el, key, value);
      }
    }
  }

  for (const child of children) {
    if (child == null) {
      continue;
    }
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(String(child)));
    } else if (typeof child === 'boolean') {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      // 走到这里 child 已排除原始类型；运行时可能混入 SVG 元素（非 HTMLElement 实例）。
      // instanceof 左侧若直接用 child 会被收窄为 never 触发 TS2358，先声明为 Node 再判断
      const node: Node = child;
      if (node instanceof HTMLElement || node instanceof SVGElement) {
        el.appendChild(node);
      }
    }
  }

  return el;
}

/**
 * 设置属性
 */
function setAttribute(el: HTMLElement, key: string, value: unknown): void {
  if (key.startsWith('on') && typeof value === 'function') {
    const eventName = key.slice(2).toLowerCase();
    el.addEventListener(eventName, value as EventListener);
  } else if (key === 'class') {
    if (typeof value === 'string') {
      el.className = value;
    } else if (Array.isArray(value)) {
      el.className = value.filter(Boolean).join(' ');
    }
  } else if (key === 'style') {
    if (typeof value === 'string') {
      el.style.cssText = value;
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(el.style, value);
    }
  } else if (key === 'ref' && typeof value === 'object' && value !== null) {
    (value as { current: HTMLElement | null }).current = el;
  } else if (typeof value === 'boolean') {
    if (value) {
      el.setAttribute(key, '');
    } else {
      el.removeAttribute(key);
    }
  } else if (value != null) {
    el.setAttribute(key, String(value));
  }
}

/**
 * 辅助函数：渲染列表
 */
export function map<T, R extends HTMLElement | string | number = HTMLElement | string>(
  items: T[],
  render: (item: T, index: number) => R
): R[] {
  return items.map(render);
}

/**
 * 辅助函数：条件渲染
 */
export function when(
  condition: unknown,
  trueCase: () => HTMLElement | string,
  falseCase?: () => HTMLElement | string
): HTMLElement | string | null {
  if (condition) {
    return trueCase();
  }
  return falseCase ? falseCase() : null;
}

/**
 * 辅助函数：创建文本节点
 */
export function text(content: string | number): Text {
  return document.createTextNode(String(content));
}
