import { describe, it, expect, vi } from 'vitest';
import { html, h, map, when, raw, text } from '../html';

describe('html', () => {
  describe('html 标签模板函数', () => {
    it('应该创建简单的 DOM 元素', () => {
      const element = html`<div>Hello</div>`;
      expect(element).toBeInstanceOf(HTMLElement);
      expect(element.textContent).toBe('Hello');
    });

    it('应该创建带属性的元素', () => {
      const element = html`<div class="test" id="my-id">Content</div>`;
      expect(element.className).toBe('test');
      expect(element.id).toBe('my-id');
      expect(element.textContent).toBe('Content');
    });

    it('应该创建带样式的元素', () => {
      const element = html`<div style="color: red; font-size: 14px;">Styled</div>`;
      expect(element.style.color).toBe('red');
      expect(element.style.fontSize).toBe('14px');
    });

    it('应该处理嵌套元素', () => {
      const element = html`
        <div>
          <span>Child 1</span>
          <span>Child 2</span>
        </div>
      `;
      expect(element.children.length).toBe(2);
      expect(element.children[0].textContent).toBe('Child 1');
      expect(element.children[1].textContent).toBe('Child 2');
    });

    it('应该处理动态值', () => {
      const name = 'World';
      const element = html`<div>Hello ${name}</div>`;
      expect(element.textContent).toBe('Hello World');
    });

    it('应该处理数字值', () => {
      const count = 42;
      const element = html`<div>Count: ${count}</div>`;
      expect(element.textContent).toBe('Count: 42');
    });

    it('应该忽略 null 和 undefined', () => {
      const element = html`<div>${null}${undefined}Text</div>`;
      expect(element.textContent).toBe('Text');
    });

    it('应该处理数组', () => {
      const items = ['Item 1', 'Item 2', 'Item 3'];
      const element = html`<ul>${items.map(item => html`<li>${item}</li>`)}</ul>`;
      expect(element.children.length).toBe(3);
    });

    it('应该处理 SVG', () => {
      const element = html`<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>`;
      expect(element).toBeInstanceOf(SVGElement);
      expect(element.getAttribute('width')).toBe('16');
    });

    it('应该处理条件渲染', () => {
      const show = true;
      const element = html`<div>${show ? html`<span>Visible</span>` : ''}</div>`;
      expect(element.querySelector('span')).toBeTruthy();
      expect(element.querySelector('span')?.textContent).toBe('Visible');
    });

    it('应该处理 DOM 元素插入', () => {
      const child = html`<span>Dynamic</span>`;
      const parent = html`<div>${child}</div>`;
      expect(parent.querySelector('span')?.textContent).toBe('Dynamic');
    });
  });

  describe('h 辅助函数', () => {
    it('应该创建简单的元素', () => {
      const element = h('div', null, 'Hello');
      expect(element).toBeInstanceOf(HTMLElement);
      expect(element.tagName).toBe('DIV');
      expect(element.textContent).toBe('Hello');
    });

    it('应该创建带属性的元素', () => {
      const element = h('div', { class: 'test', id: 'my-id' }, 'Content');
      expect(element.className).toBe('test');
      expect(element.id).toBe('my-id');
    });

    it('应该创建带样式的元素', () => {
      const element = h('div', { style: 'color: red' }, 'Styled');
      expect(element.style.color).toBe('red');
    });

    it('应该创建带事件处理器的元素', () => {
      let clicked = false;
      const handler = () => { clicked = true; };

      const element = h('button', { onclick: handler }, 'Click');
      element.click();

      expect(clicked).toBe(true);
    });

    it('应该处理多个子元素', () => {
      const child1 = h('span', null, 'Child 1');
      const child2 = h('span', null, 'Child 2');

      const parent = h('div', null, child1, child2);
      expect(parent.children.length).toBe(2);
    });

    it('应该处理文本和数字子元素', () => {
      const element = h('div', null, 'Text', 123);
      expect(element.textContent).toBe('Text123');
    });

    it('应该忽略 null 子元素', () => {
      const element = h('div', null, null, 'Visible', null);
      expect(element.textContent).toBe('Visible');
    });

    it('应该处理 DOM 子元素', () => {
      const child = h('span', null, 'Nested');
      const parent = h('div', null, child);
      expect(parent.children.length).toBe(1);
      expect(parent.children[0].textContent).toBe('Nested');
    });
  });

  describe('map 辅助函数', () => {
    it('应该映射数组', () => {
      const items = [1, 2, 3];
      const result = map(items, (item) => item * 2);
      expect(result).toEqual([2, 4, 6]);
    });

    it('应该提供索引', () => {
      const items = ['a', 'b', 'c'];
      const result = map(items, (item, index) => `${item}${index}`);
      expect(result).toEqual(['a0', 'b1', 'c2']);
    });
  });

  describe('when 辅助函数', () => {
    it('应该在条件为真时返回 trueCase', () => {
      const result = when(true, () => 'yes');
      expect(result).toBe('yes');
    });

    it('应该在条件为假时返回 falseCase', () => {
      const result = when(false, () => 'yes', () => 'no');
      expect(result).toBe('no');
    });

    it('应该在条件为假且无 falseCase 时返回 null', () => {
      const result = when(false, () => 'yes');
      expect(result).toBeNull();
    });

    it('应该处理 falsy 值', () => {
      const result = when(0, () => 'yes', () => 'no');
      expect(result).toBe('no');
    });
  });

  describe('text 辅助函数', () => {
    it('应该创建文本节点', () => {
      const node = text('Hello');
      expect(node).toBeInstanceOf(Text);
      expect(node.textContent).toBe('Hello');
    });

    it('应该转换数字为字符串', () => {
      const node = text(42);
      expect(node.textContent).toBe('42');
    });
  });

  // ── 变异测试补充用例：覆盖各分支的具体输出 ──

  describe('模板值处理分支', () => {
    it('布尔值 true 应渲染为文本 true，false 应被忽略', () => {
      const element = html`<div>${false}-${true}</div>`;
      expect(element.textContent).toBe('-true');
    });

    it('应转义 HTML 特殊字符并原样显示', () => {
      // 所有普通字符串一律转义，尖括号不会变成标签
      const element = html`<div>${'a & b'}${'a<b'}${'a > b'}${'say "hi"'}${"it's"}</div>`;
      expect(element.textContent).toBe('a & ba<ba > bsay "hi"it\'s');
    });

    it('以 < 开头的普通字符串应按文本转义，不得注入元素', () => {
      const element = html`<div>${'<b>hi</b>'}</div>`;
      expect(element.querySelector('b')).toBeNull();
      expect(element.textContent).toBe('<b>hi</b>');
    });

    it('仓库数据形态的 <img onerror> 不得产生元素（存储型 XSS 回归）', () => {
      // 提交信息 / 分支名 / 文件路径都可能长成这样，原样插入 innerHTML 就是可执行脚本
      const payload = '<img src=x onerror="window.__xss=1">';
      const element = html`<div>${payload}</div>`;
      expect(element.querySelector('img')).toBeNull();
      expect(element.textContent).toBe(payload);
    });

    it('只有 raw() 标记的片段才作为原始 HTML 注入', () => {
      const trusted = html`<div>${raw('<b>hi</b>')}</div>`;
      expect(trusted.querySelector('b')?.textContent).toBe('hi');

      const escaped = html`<div>${'<b>hi</b>'}</div>`;
      expect(escaped.querySelector('b')).toBeNull();
    });

    it('数组中形似标签的字符串同样要转义，raw() 片段则原样插入', () => {
      const element = html`<div>${['<b>a</b>', '<img src=x onerror=alert(1)>']}</div>`;
      expect(element.querySelector('b')).toBeNull();
      expect(element.querySelector('img')).toBeNull();
      expect(element.textContent).toBe('<b>a</b><img src=x onerror=alert(1)>');

      const mixed = html`<div>${[raw('<b>b</b>'), 'c']}</div>`;
      expect(mixed.querySelector('b')?.textContent).toBe('b');
      expect(mixed.textContent).toBe('bc');
    });

    it('不以 < 开头但包含尖括号的文本应被转义而非当成 HTML', () => {
      // 如作者字段 `张三 <zhangsan@example.com>`，中段的 <...> 不应被当成标签吞掉
      const element = html`<div>${'张三 <zhangsan@example.com>'}</div>`;
      expect(element.textContent).toBe('张三 <zhangsan@example.com>');
      // 不应产生任何子元素（邮箱未被解析为标签）
      expect(element.children.length).toBe(0);
    });

    it('属性值中只含左尖括号时应转义，防止属性被截断注入', () => {
      const element = html`<div class="${'a<b" data-hack="yes'}"></div>`;
      expect(element.getAttribute('class')).toBe('a<b" data-hack="yes');
      expect(element.getAttribute('data-hack')).toBeNull();
    });

    it('属性值中只含右尖括号时应转义，防止属性被截断注入', () => {
      const element = html`<div class="${'a>b" id="hack'}"></div>`;
      expect(element.getAttribute('class')).toBe('a>b" id="hack');
      expect(element.getAttribute('id')).toBeNull();
    });

    it('普通对象值应被忽略', () => {
      const element = html`<div>${{}}</div>`;
      expect(element.textContent).toBe('');
    });
  });

  describe('html 临时容器', () => {
    it('临时容器应设置 display:none 且不携带多余前缀内容', () => {
      let container: HTMLElement | null = null;
      const createElementSpy = vi.spyOn(document, 'createElement');
      try {
        html`<div>hello</div>`;
        container = createElementSpy.mock.results[0]?.value as HTMLElement;
      } finally {
        createElementSpy.mockRestore();
      }
      expect(container).not.toBeNull();
      expect(container!.style.display).toBe('none');
      expect(container!.innerHTML).toBe('<div>hello</div>');
    });

    it('空模板字符串数组应抛出解析错误', () => {
      const emptyStrings = Object.assign([], { raw: [] }) as unknown as TemplateStringsArray;
      expect(() => html(emptyStrings, '<div>x</div>')).toThrow('无法解析 HTML 模板');
    });

    it('只有文本没有标签的模板应抛出解析错误', () => {
      expect(() => html`Just text`).toThrow('无法解析 HTML 模板');
    });
  });

  describe('数组插值分支', () => {
    it('纯字符串数组应逐项渲染为文本', () => {
      const element = html`<div>${['a', 'b']}</div>`;
      expect(element.textContent).toBe('ab');
    });

    it('数组中的 null 和 undefined 应渲染为空文本', () => {
      const element = html`<div>${[null, undefined]}</div>`;
      expect(element.textContent).toBe('');
    });
  });

  describe('标记注释替换', () => {
    it('只应替换格式完全匹配的标记注释，保留近似注释', () => {
      const child = html`<span>D</span>`;
      const element = html`<div>${child}<!--x m-0-0--><!--m-0-0 y--></div>`;
      expect(element.childNodes.length).toBe(3);
      expect(element.innerHTML).toContain('<!--x m-0-0-->');
      expect(element.innerHTML).toContain('<!--m-0-0 y-->');
    });

    it('应支持两位数分组索引的标记替换', () => {
      const element = html`<div>${h('a')}${h('b')}${h('c')}${h('d')}${h('e')}${h('f')}${h('g')}${h('i')}${h('j')}${h('k')}${h('l')}</div>`;
      expect(element.children.length).toBe(11);
    });

    it('应支持两位数元素索引的标记替换', () => {
      const kids = Array.from({ length: 11 }, (_, index) => h('i', null, String(index)));
      const element = html`<div>${kids}</div>`;
      expect(element.children.length).toBe(11);
    });

    it('应忽略指向不存在分组的标记注释', () => {
      const element = html`<div><!--m-99-0--></div>`;
      expect(element.innerHTML).toContain('<!--m-99-0-->');
    });

    it('应忽略指向不存在元素的标记注释', () => {
      const child = html`<span>D</span>`;
      const element = html`<div>${child}<!--m-0-5--></div>`;
      expect(element.children.length).toBe(1);
      expect(element.innerHTML).toContain('<!--m-0-5-->');
    });

    it('纯文本数组不应登记 DOM 替换分组（字面量 m-1-0 标记应原样保留）', () => {
      const child = html`<span>D</span>`;
      const element = html`<div>${['a']}${child}<!--m-1-0--></div>`;
      // 纯文本数组不含 DOM 元素 → 不占用分组索引 → 字面量标记指向的分组不存在，注释保留
      expect(element.innerHTML).toContain('<!--m-1-0-->');
      expect(element.querySelector('span')).not.toBeNull();
    });
  });

  describe('h 属性与子元素分支', () => {
    it('布尔子元素应渲染为文本', () => {
      const element = h('div', null, true, false);
      expect(element.textContent).toBe('truefalse');
    });

    it('非节点对象子元素应被忽略', () => {
      const element = h('div', null, {} as never);
      expect(element.textContent).toBe('');
    });

    it('数组形式的 class 应过滤空值并用空格连接', () => {
      const element = h('div', { class: ['a', '', 'b'] } as never);
      expect(element.className).toBe('a b');
    });

    it('非字符串非数组的 class 值应被忽略', () => {
      const element = h('div', { class: 123 as never });
      expect(element.className).toBe('');
    });

    it('对象形式的 style 应应用各条样式', () => {
      const element = h('div', { style: { color: 'blue', fontSize: '10px' } });
      expect(element.style.color).toBe('blue');
      expect(element.style.fontSize).toBe('10px');
    });

    it('ref 属性应保存元素引用', () => {
      const ref: { current: HTMLElement | null } = { current: null };
      const element = h('div', { ref });
      expect(ref.current).toBe(element);
    });

    it('非 ref 的对象属性应字符串化为属性值', () => {
      const element = h('div', { custom: { a: 1 } } as never);
      expect(element.getAttribute('custom')).toBe('[object Object]');
    });

    it('true 布尔属性应设置为空值属性', () => {
      const element = h('div', { hidden: true });
      expect(element.hasAttribute('hidden')).toBe(true);
      expect(element.getAttribute('hidden')).toBe('');
    });

    it('false 布尔属性不应出现在元素上', () => {
      const element = h('div', { hidden: false });
      expect(element.hasAttribute('hidden')).toBe(false);
    });

    it('布尔属性为 false 时应调用 removeAttribute 清除同名属性', () => {
      const removeSpy = vi.spyOn(Element.prototype, 'removeAttribute');
      try {
        h('div', { hidden: false });
        expect(removeSpy).toHaveBeenCalledWith('hidden');
      } finally {
        removeSpy.mockRestore();
      }
    });

    it('style 为函数时不应把函数自身属性拷入样式（仅字符串与普通对象可用）', () => {
      const fnStyle = Object.assign(() => {}, { color: 'red' });
      const element = h('div', { style: fnStyle } as never);
      expect(element.getAttribute('style')).toBeNull();
      expect(element.style.color).toBe('');
    });

    it('非函数的 on* 值应退化为普通属性', () => {
      const element = h('div', { onclick: 'alert(1)' } as never);
      expect(element.getAttribute('onclick')).toBe('alert(1)');
    });

    it('非 on 开头的函数值应字符串化为属性值', () => {
      function handler(): void {}
      const element = h('div', { ref: handler } as never);
      expect(element.getAttribute('ref')).toMatch(/^function/);
    });
  });
});
