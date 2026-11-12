/**
 * 提交列表组件单元测试
 * 覆盖：提交行/工具栏渲染、单选、Ctrl/Cmd 多选、Shift 范围选、
 * 全选切换、右键单提交/批量菜单、logBranch 分支过滤（无工具栏标签，状态由分支面板高亮承载）、搜索过滤、
 * 刷新、订阅局部渲染、dispose 取消订阅、排序模式与排序标签、
 * displaySettings 列显隐、工具栏按钮接线（拉取/对比/搜索/设置/跳转）与 title i18n、
 * filterCommits 导出直调（活动过滤与排序的重应用）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCommitListPanel, filterCommits } from '../components/commit-list';
import { createInitialState, getState, setState, stateManager, CommitInfo } from '../state';
import { ServiceClient } from '../service';
import { setLocale } from '../i18n';
import {
  expectSemanticClass,
} from './theme-helpers';

/** 宿主 toast 断言句柄（vi.mock 工厂在提升阶段执行，只能引用外部变量以外的东西，故用 vi.hoisted） */
const { toastMock, writeClipboardMock } = vi.hoisted(() => ({
  toastMock: vi.fn().mockResolvedValue(undefined),
  writeClipboardMock: vi.fn().mockResolvedValue(undefined),
}));

// 宿主模块打桩：避免真实 connectHost 握手，并在用例中断言 toast 调用
vi.mock('../host', () => ({
  host: {
    toast: toastMock,
    writeClipboard: writeClipboardMock,
  },
}));

/** 构造组件所需的 service mock，getLog/pull/diffVsLocal/listFiles 单独暴露用于断言 */
function createServiceMock(): {
  service: ServiceClient;
  getLogMock: ReturnType<typeof vi.fn>;
  pullMock: ReturnType<typeof vi.fn>;
  diffVsLocalMock: ReturnType<typeof vi.fn>;
  listFilesMock: ReturnType<typeof vi.fn>;
} {
  const getLogMock = vi.fn().mockResolvedValue([]);
  const pullMock = vi.fn().mockResolvedValue(undefined);
  const diffVsLocalMock = vi.fn().mockResolvedValue([]);
  // 路径勾选树对话框打开即调 listFiles，返回空数组为安全默认（候选行为空）
  const listFilesMock = vi.fn().mockResolvedValue([]);
  const service = {
    getLog: getLogMock,
    pull: pullMock,
    diffVsLocal: diffVsLocalMock,
    cherryPick: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    checkoutNewBranch: vi.fn().mockResolvedValue(undefined),
    getBranches: vi.fn().mockResolvedValue([]),
    listFiles: listFilesMock,
    // 右键菜单打开前会查询工作区状态，默认干净（否则改写历史的项会被置灰）
    isWorkingTreeClean: vi.fn().mockResolvedValue(true),
  } as unknown as ServiceClient;
  return { service, getLogMock, pullMock, diffVsLocalMock, listFilesMock };
}

/**
 * 构造提交夹具（新→旧 4 条）
 * 每次调用返回全新对象，保证可与 state 中的引用做严格比较
 */
/**
 * 由简短标识生成 40 位完整哈希（前 7 位即短哈希）
 * 所有夹具统一走这里，保证形状与真实 git 输出一致
 * @param id 简短标识（如 t1、h2）
 * @returns 完整哈希
 */
/**
 * 从完整或短哈希中取出精简标识（去掉尾部补零），用于断言比较
 * @param hash 完整哈希或短哈希
 * @returns 精简标识（如 h1）
 */
export function prefixOf(hash: string): string {
  return hash.slice(0, 7).replace(/0+$/, '');
}

export function fullHash(id: string): string {
  const short = id.length >= 7 ? id.slice(0, 7) : `${id}${'0'.repeat(7 - id.length)}`;
  return `${short}${'0'.repeat(40 - short.length)}`;
}

function makeCommits(): CommitInfo[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  // 哈希必须复刻真实 git 的 40 位形式：短哈希取前 7 位。
  // 若用 'h1' 这类短占位，会掩盖「分支短哈希与提交完整哈希不匹配」等真实缺陷
  const raw = [
    ['h1', 'feat: 新增分支面板', '张三', 'a@example.com'],
    ['h2', 'fix: 修复提交列表渲染', '李四', 'b@example.com'],
    ['h3', 'docs: 更新说明文档', '张三', 'a@example.com'],
    ['h4', 'chore: 调整构建脚本', '王五', 'c@example.com'],
  ] as const;
  return raw.map(([prefix, message, authorName, authorEmail], i) => {
    const hash = fullHash(prefix);
    return {
      hash,
      shortHash: hash.slice(0, 7),
      message,
      authorName,
      authorEmail,
      date: new Date(now - (i + 1) * day).toISOString(),
      parents: [],
    };
  });
}

/**
 * 构造覆盖各个相对时间档位的提交夹具（用于验证 formatDate）
 * 覆盖：刚刚 / N分钟前 / N小时前 / N天前 / 本地日期回退
 */
function makeRelativeCommits(): CommitInfo[] {
  const now = Date.now();
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const pick = (id: string, message: string, agoMs: number): CommitInfo => ({
    hash: fullHash(id),
    shortHash: fullHash(id).slice(0, 7),
    message,
    authorName: '张三',
    authorEmail: 'a@example.com',
    date: new Date(now - agoMs).toISOString(),
    parents: [],
  });
  return [
    pick('t1', 'feat: 即时提交', 0),
    pick('t2', 'feat: 一分钟前提交', min),
    pick('t6', 'feat: 一小时前提交', hour),
    pick('t3', 'feat: 三小时前提交', 3 * hour),
    pick('t4', 'feat: 一天前提交', day),
    pick('t5', 'feat: 七天前提交', 7 * day),
  ];
}

/**
 * 构造专用于排序断言的提交夹具（原序：s1→s4，日期新→旧）
 * 作者与消息全部使用 ASCII 且全小写，规避 locale 排序差异导致断言不稳定
 * - 作者：carol / alice / bob（alice 两条，验证同作者按日期降序）
 * - 消息：'fix: a' 两条（s1/s4），验证同消息按日期降序
 */
function makeSortCommits(): CommitInfo[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const pick = (hash: string, message: string, author: string, agoMs: number): CommitInfo => ({
    hash,
    shortHash: hash,
    message,
    authorName: author,
    authorEmail: 'sort@example.com',
    date: new Date(now - agoMs).toISOString(),
    parents: [],
  });
  return [
    pick('s1', 'fix: a', 'carol', day),
    pick('s2', 'feat: a', 'alice', 2 * day),
    pick('s3', 'docs: c', 'bob', 3 * day),
    pick('s4', 'fix: a', 'alice', 4 * day),
  ];
}

describe('commit-list', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | null = null;
  let service: ServiceClient;
  let getLogMock: ReturnType<typeof vi.fn>;
  let listFilesMock: ReturnType<typeof vi.fn>;
  /**
   * 本次用例内捕获到的窗口 error 事件（事件回调异常经 jsdom reportException 派发到 window）
   * 同时 preventDefault 阻止 jsdom 上报 jsdomError，避免回调异常使 vitest runner 崩溃，
   * 从而可以把“回调是否抛错”转成普通断言失败（用于杀死 RuntimeError 类变异体）
   */
  let windowErrors: ErrorEvent[] = [];
  let onWindowError: ((e: ErrorEvent) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    setLocale('zh-CN'); // 固定右键菜单文案语言，避免受其他用例影响
    // 重置全局状态
    setState(s => Object.assign(s, createInitialState()));
    container = document.createElement('div');
    document.body.appendChild(container);
    ({ service, getLogMock, listFilesMock } = createServiceMock());
    // jsdom 未实现 scrollIntoView：部分下拉/列表滚动会调用，注入空实现兜底
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    // 安装窗口错误捕获：记录回调异常并阻止其冒泡到 runner
    windowErrors = [];
    onWindowError = (e: ErrorEvent) => {
      windowErrors.push(e);
      e.preventDefault();
    };
    window.addEventListener('error', onWindowError);
  });

  afterEach(() => {
    // 移除窗口错误捕获
    if (onWindowError) {
      window.removeEventListener('error', onWindowError);
      onWindowError = null;
    }
    // 清理可能残留的下拉菜单（Escape 关闭并注销其 document 监听）
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    // 取消订阅并清理 DOM（含右键菜单），防止跨用例泄漏
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  /**
   * 创建提交列表面板并登记 dispose（由 afterEach 统一调用）
   * @param onCommitSelect 提交选择回调
   */
  function createPanel(onCommitSelect: ReturnType<typeof vi.fn> = vi.fn()) {
    const panel = createCommitListPanel(container, service, '/repo', onCommitSelect);
    dispose = panel.dispose;
    return { panel, onCommitSelect };
  }

  /**
   * 初始化提交数据（需在创建面板前调用）
   * @param commits 提交夹具，默认 4 条
   */
  function setupCommits(commits: CommitInfo[] = makeCommits()): CommitInfo[] {
    setState(s => {
      s.allCommits = [...commits];
      s.filteredCommits = [...commits];
    });
    return commits;
  }

  /**
   * 获取提交行元素
   * 入参可用 h1/h2 这类前缀简写，内部补全为 40 位完整哈希
   * @param hash 完整哈希或前缀简写
   * @returns 行元素
   */
  const row = (hash: string) => {
    // 已是完整哈希（40 位）时原样使用；否则按夹具规则补成 40 位
    if (hash.length === 40) {
      return container.querySelector(`[data-hash="${hash}"]`) as HTMLElement;
    }
    const short = hash.length < 7 ? `${hash}${'0'.repeat(7 - hash.length)}` : hash.slice(0, 7);
    const full = `${short}${'0'.repeat(40 - short.length)}`;
    return container.querySelector(`[data-hash="${full}"]`) as HTMLElement;
  };

  /** 点击提交行（可带修饰键） */
  const clickRow = (hash: string, init: MouseEventInit = {}) =>
    row(hash).dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));

  /** 右键提交行 */
  /**
   * 右键提交行并等待菜单渲染
   * 菜单打开前会异步查询工作区状态，故需等待一个微任务周期
   * @param hash 提交哈希
   */
  const contextRow = async (hash: string) => {
    row(hash).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
  };

  /** 读取多选集合（排序后返回，便于断言） */
  // 返回精简标识（h1/h2）：去掉补零，便于与测试夹具前缀断言
  const selectedHashes = () =>
    [...getState().selectedCommits].map(h => h.slice(0, 7).replace(/0+$/, '')).sort();

  /**
   * 把夹具中的完整哈希转成精简标识（h1/h2），用于与 selectedHashes 比较
   * @param list 哈希数组（完整或任意形式）
   * @returns 精简标识数组
   */
  const shortIds = (list: string[]) => list.map(h => h.slice(0, 7).replace(/0+$/, ''));

  /** 获取右键菜单元素 */
  const menuEl = () => document.getElementById('git-context-menu');

  /** 读取当前过滤结果的哈希列表 */
  // 返回精简标识（h1/h2），与夹具前缀断言保持一致
  const filteredHashes = () => shortIds(getState().filteredCommits.map(c => c.hash));

  /** 读取 DOM 中提交行的渲染顺序（哈希列表） */
  // 返回精简标识（h1/h2），与夹具前缀断言保持一致
  const rowOrder = () =>
    [...container.querySelectorAll('[data-hash]')]
      .map(el => (el.getAttribute('data-hash') ?? '').slice(0, 7).replace(/0+$/, ''));

  /** 读取全局状态管理器当前的监听器数量（用于断言 dispose 是否真正取消订阅） */
  const listenerCount = () =>
    (stateManager as unknown as { listeners: Set<unknown> }).listeners.size;

  /**
   * 从 console.debug 捕获的调用中解析出结构化日志负载数组
   * @param spy console.debug 的 spy（或任意 mock）
   */
  function parseDebugLogs(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
    return spy.mock.calls
      .map(args => String(args[0]))
      .filter(l => l.startsWith('{'))
      .map(l => JSON.parse(l) as Record<string, unknown>);
  }

  /**
   * 在搜索框输入关键字并派发 input 事件
   * @param keyword 搜索关键字
   */
  function inputSearch(keyword: string): void {
    const input = container.querySelector('input[placeholder="文本或哈希"]') as HTMLInputElement;
    input.value = keyword;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** 跳转对话框输入框（SDK UI Kit mountTextField，槽位 [data-goto-input]） */
  function gotoInput(): HTMLInputElement {
    return document.querySelector('[data-goto-input] .oc-sdk-input') as HTMLInputElement;
  }

  /** 在跳转对话框输入并派发 input 事件（Kit 受控输入需 dispatch 才触发 onChange） */
  function typeGoto(value: string): void {
    const input = gotoInput();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** 点击跳转对话框确定按钮（Kit mountButton） */
  function clickGotoOk(): void {
    (document.querySelector('[data-goto-ok] .oc-sdk-btn') as HTMLElement).click();
  }

  /** 跳转对话框未找到提示（Kit mountBanner tone=error），无提示时为 null */
  function gotoErrorText(): string | null {
    return document.querySelector('[data-goto-error] .oc-sdk-banner-title')?.textContent ?? null;
  }

  /** 点击日期范围对话框确定按钮（Kit mountButton；date 输入仍为自绘 #daterange-*） */
  function clickDaterangeOk(): void {
    (document.querySelector('[data-daterange-ok] .oc-sdk-btn') as HTMLElement).click();
  }

  /** 点击路径编辑对话框确定按钮（Kit mountButton） */
  function clickPathfilterOk(): void {
    (document.querySelector('[data-pathfilter-ok] .oc-sdk-btn') as HTMLElement).click();
  }

  /** 路径编辑对话框多行输入（Kit mountTextField multiline） */
  function pathfilterInput(): HTMLTextAreaElement {
    return document.querySelector('[data-pathfilter-input] textarea.oc-sdk-input') as HTMLTextAreaElement;
  }

  /** 设置路径编辑对话框多行输入值并派发 input 事件 */
  function typePathfilter(value: string): void {
    const input = pathfilterInput();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** 路径勾选树对话框确定按钮（Kit mountButton） */
  function pathtreeOkButton(): HTMLButtonElement {
    return document.querySelector('[data-pathtree-ok] .oc-sdk-btn') as HTMLButtonElement;
  }

  /**
   * 通过 commitSearch 变化间接触发模块内的 filterCommits
   * （filterCommits 仅由 commitSearch 订阅与刷新按钮触发）
   */
  function triggerFilter(): void {
    setState(s => { s.commitSearch = '@@'; }); // 先置为无效关键字，制造字段变化
    setState(s => { s.commitSearch = ''; });   // 再清空，走“无搜索 + 其余过滤条件”路径
  }

  it('应该渲染提交行与工具栏按钮', () => {
    const commits = setupCommits();
    createPanel();

    const rows = container.querySelectorAll('[data-hash]');
    expect(rows.length).toBe(4);
    expect(row('h1').textContent).toContain(commits[0].message);
    expect(row('h1').textContent).toContain('张三');
    // 未选中行：带基础行类，无选中/悬停态类（主题样式由 CSS 类承担）
    expectSemanticClass(row('h1'), 'gm-commit-row');
    expect(row('h1').classList.contains('gm-commit-row-selected')).toBe(false);
    expect(row('h1').classList.contains('gm-commit-row-hover')).toBe(false);

    // 左侧过滤控件 + 右侧角三项（刷新 / 设置 / 跳转）
    // 全部为自绘按钮（分支/用户为带 .gm-filter-btn-value 的下拉按钮）
    for (const action of ['btn-regex', 'btn-case', 'btn-filter-date', 'btn-filter-path', 'btn-refresh', 'btn-settings', 'btn-goto']) {
      expect(container.querySelector(`[data-action="${action}"]`)).toBeTruthy();
    }
    // 分支/用户过滤为自绘下拉按钮，当前值文案承载在 .gm-filter-btn-value
    for (const slot of ['filter-branch', 'filter-user']) {
      expect(container.querySelector(`[data-action="${slot}"] .gm-filter-btn-value`)).toBeTruthy();
    }
    // 已按 IDEA 移除的按钮不应存在
    for (const action of ['btn-select-all', 'btn-download', 'btn-compare', 'btn-search', 'btn-filter-branch', 'btn-filter-user']) {
      expect(container.querySelector(`[data-action="${action}"]`)).toBeNull();
    }
    expect(container.querySelector('input[placeholder="文本或哈希"]')).toBeTruthy();
  });

  it('无提交时应该显示暂无提交记录占位', () => {
    createPanel();

    expect(container.textContent).toContain('暂无提交记录');
    expect(container.querySelectorAll('[data-hash]').length).toBe(0);
  });

  it('提交标题以 < 开头时应按文本渲染，不得注入元素（存储型 XSS 回归）', () => {
    // 仓库里的提交标题完全可能长成这样：打开不受信任的仓库即触发
    const payload = '<img src=x onerror="window.__xss=1">';
    const commits = makeCommits();
    commits[0] = { ...commits[0], message: payload };
    setupCommits(commits);
    createPanel();

    const msg = row('h1').querySelector('.gm-commit-msg') as HTMLElement;
    expect(msg).toBeTruthy();
    expect(msg.textContent).toBe(payload);
    // 整行与整棵树里都不应出现被解析出来的 img 元素
    expect(row('h1').querySelector('img')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('作者名以 < 开头时应按文本渲染，不得注入元素（存储型 XSS 回归）', () => {
    const payload = '<img src=x onerror="window.__xss=1">';
    const commits = makeCommits();
    commits[1] = { ...commits[1], authorName: payload };
    setupCommits(commits);
    createPanel();

    const author = row('h2').querySelector('.gm-commit-col-author') as HTMLElement;
    expect(author.textContent).toBe(payload);
    expect(container.querySelector('img')).toBeNull();
  });

  it('普通点击应该单选提交并触发 onCommitSelect', () => {
    const commits = setupCommits();
    const { onCommitSelect } = createPanel();

    clickRow('h2');

    expect(onCommitSelect).toHaveBeenCalledTimes(1);
    expect(onCommitSelect).toHaveBeenCalledWith(commits[1]);
    expect(getState().selectedCommit).toBe(commits[1]);
    expect(selectedHashes()).toEqual(['h2']);
    // 选中行带选中态语义类
    expectSemanticClass(row('h2'), ['gm-commit-row', 'gm-commit-row-selected']);
    expect(row('h1').classList.contains('gm-commit-row-selected')).toBe(false);
  });

  it('Ctrl/Cmd 点击应该切换多选集合', () => {
    setupCommits();
    const { onCommitSelect } = createPanel();

    clickRow('h1'); // 单选
    expect(selectedHashes()).toEqual(['h1']);

    clickRow('h2', { ctrlKey: true }); // 追加
    expect(selectedHashes()).toEqual(['h1', 'h2']);

    clickRow('h2', { ctrlKey: true }); // 取消
    expect(selectedHashes()).toEqual(['h1']);

    clickRow('h3', { metaKey: true }); // Cmd 追加
    expect(selectedHashes()).toEqual(['h1', 'h3']);

    expect(onCommitSelect).toHaveBeenCalledTimes(4);
  });

  it('Shift 点击应该按锚点做范围选择', () => {
    setupCommits();
    createPanel();

    clickRow('h2'); // 普通点击建立锚点（idx=1）
    clickRow('h4', { shiftKey: true }); // 范围 1..3
    expect(selectedHashes()).toEqual(['h2', 'h3', 'h4']);
    expect(getState().selectedCommit?.hash.slice(0, 7).replace(/0+$/, '')).toBe('h4');

    clickRow('h1', { shiftKey: true }); // 锚点保持不变 → 范围 0..1
    expect(selectedHashes()).toEqual(['h1', 'h2']);
    expect(getState().selectedCommit?.hash.slice(0, 7).replace(/0+$/, '')).toBe('h1');
  });

  it('无锚点时 Shift 点击应该退化为单选', () => {
    setupCommits();
    createPanel();

    clickRow('h3', { shiftKey: true });

    expect(selectedHashes()).toEqual(['h3']);
  });

  it('右键单选状态的提交应该显示单提交菜单', async () => {
    setupCommits();
    createPanel();

    clickRow('h1');
    await contextRow('h1');

    expect(menuEl()).toBeTruthy();
    expect(menuEl()!.textContent).toContain('复制提交哈希');
    expect(menuEl()!.textContent).not.toContain('已选中');
  });

  it('右键多选集合内的提交应该显示批量菜单并包含数量', async () => {
    setupCommits();
    createPanel();

    clickRow('h1');
    clickRow('h2', { ctrlKey: true });
    await contextRow('h2'); // 右键目标在多选集合内且选中数 > 1

    expect(menuEl()).toBeTruthy();
    expect(menuEl()!.textContent).toContain('已选中 2 个提交');
    expect(menuEl()!.textContent).toContain('复制哈希列表');
  });

  it('右键未选中的提交应该显示单提交菜单', async () => {
    setupCommits();
    createPanel();

    clickRow('h1');
    clickRow('h2', { ctrlKey: true });
    await contextRow('h3'); // 目标不在多选集合内

    expect(menuEl()).toBeTruthy();
    expect(menuEl()!.textContent).toContain('复制提交哈希');
    expect(menuEl()!.textContent).not.toContain('已选中');
  });

  it('logBranch 切换不应出现分支过滤标签且重置范围锚点（不清空选中）', () => {
    setupCommits();
    createPanel();

    clickRow('h1'); // 锚点 idx=0
    clickRow('h2', { ctrlKey: true }); // {h1, h2}
    setState(s => { s.logBranch = 'dev'; });

    // 分支过滤标签已移除（对齐 IDEA：无分支胶囊，过滤状态由分支面板选中高亮承载）
    expect(container.textContent).not.toContain('分支:');
    expect(container.querySelector('[data-action="btn-clear-branch"]')).toBeNull();
    // 源码实际行为：logBranch 切换不清空 selectedCommits
    expect(selectedHashes()).toEqual(['h1', 'h2']);

    // 锚点已重置 → Shift 点击退化为单选；若锚点未重置应得到 0..3 的范围选
    clickRow('h4', { shiftKey: true });
    expect(selectedHashes()).toEqual(['h4']);
  });

  it('搜索输入应该过滤提交列表', () => {
    setupCommits();
    createPanel();

    const input = container.querySelector('input[placeholder="文本或哈希"]') as HTMLInputElement;
    input.value = 'fix';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(getState().commitSearch).toBe('fix');
    expect(container.querySelectorAll('[data-hash]').length).toBe(1);
    expect(row('h2')).toBeTruthy();

    // 清空搜索恢复全部
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(getState().commitSearch).toBe('');
    expect(container.querySelectorAll('[data-hash]').length).toBe(4);
  });

  it('刷新按钮应该调用 getLog 并更新提交列表', async () => {
    setupCommits();
    createPanel();

    const newCommits: CommitInfo[] = [
      { hash: fullHash('h9'), shortHash: fullHash('h9').slice(0, 7), message: 'feat: 刷新后的提交', authorName: '张三', authorEmail: 'a@example.com', date: new Date().toISOString(), parents: [] },
    ];
    getLogMock.mockResolvedValue(newCommits);

    kitBtn('btn-refresh').click();

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-hash]').length).toBe(1);
    });
    expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, undefined);
    expect(getState().filteredCommits.map(c => prefixOf(c.hash))).toEqual(['h9']);
    expect(row('h9')).toBeTruthy();
  });

  it('filteredCommits 变化应该通过订阅局部更新而不重建工具栏', () => {
    setupCommits();
    createPanel();

    const selectAllBtn = container.querySelector('[data-action="btn-select-all"]');
    setState(s => { s.filteredCommits = s.allCommits.slice(0, 2); });

    expect(container.querySelectorAll('[data-hash]').length).toBe(2);
    expect(container.querySelector('[data-action="btn-select-all"]')).toBe(selectAllBtn);
  });

  it('dispose 后状态变化不应再更新列表', () => {
    setupCommits();
    const baseListeners = listenerCount();
    createPanel();
    // 面板应注册两份订阅：subscribeFields + displaySettings 按值订阅
    expect(listenerCount()).toBe(baseListeners + 2);
    expect(container.querySelectorAll('[data-hash]').length).toBe(4);

    dispose?.();
    // dispose 必须真正注销两份订阅（监听器数量回到基线）
    expect(listenerCount()).toBe(baseListeners);

    setState(s => { s.filteredCommits = s.allCommits.slice(0, 1); });

    // DOM 保持旧的 4 行
    expect(container.querySelectorAll('[data-hash]').length).toBe(4);
  });

  it('渲染应该只产生工具栏与列表两个顶层区块且 Kit 控件就位', () => {
    setupCommits();
    createPanel();

    // 顶层只有工具栏与列表两个节点（容器清空逻辑不应残留任何文本）
    expect(container.childNodes.length).toBe(2);
    expect(container.textContent).not.toContain('Stryker was here!');

    // 右侧角三项都应渲染出自绘图标按钮（button+getIcon，含 svg 图标）
    for (const action of ['btn-refresh', 'btn-settings', 'btn-goto']) {
      const btn = container.querySelector(`[data-action="${action}"]`) as HTMLElement;
      expect(btn, `${action} 应渲染图标按钮`).toBeTruthy();
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.querySelector('svg'), `${action} 应含 svg 图标`).toBeTruthy();
    }

    // 搜索框为 Kit mountSearchField，自带放大镜前缀图标
    const searchSlot = container.querySelector('[data-action="search-box"] .oc-sdk-search') as HTMLElement;
    expect(searchSlot, '搜索框应挂载 Kit mountSearchField').toBeTruthy();
    expect(searchSlot.querySelector('.oc-sdk-input'), '搜索框应含输入控件').toBeTruthy();
    expect(searchSlot.querySelector('svg'), '搜索框前缀应含 svg 图标').toBeTruthy();

    // 列表区只应包含提交行，不应有占位残留文本
    const list = row('h1').parentElement as HTMLElement;
    expect(list.textContent).not.toContain('Stryker was here!');
    expect(list.querySelectorAll('[data-hash]').length).toBe(4);
  });

  it('悬停与移出提交行应该切换背景高亮（含捕获阶段与未命中场景）', () => {
    setupCommits();
    createPanel();
    const list = row('h1').parentElement as HTMLElement;

    // 未选中：悬停行内子元素（非冒泡事件在捕获阶段命中）→ 悬停态类
    const inner1 = row('h1').querySelector('span') as HTMLElement;
    inner1.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(row('h1').classList.contains('gm-commit-row-hover')).toBe(true);

    // 目标没有 data-hash 祖先：不应改写列表容器状态
    list.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(list.classList.contains('gm-commit-row-hover')).toBe(false);
    expect(list.classList.contains('gm-commit-row-selected')).toBe(false);

    // 移出未选中行 → 移除悬停态且无选中态
    inner1.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    expect(row('h1').classList.contains('gm-commit-row-hover')).toBe(false);
    expect(row('h1').classList.contains('gm-commit-row-selected')).toBe(false);

    list.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    expect(list.classList.contains('gm-commit-row-hover')).toBe(false);

    // 选中后：移出应回到选中态
    clickRow('h1');
    const inner2 = row('h1').querySelector('span') as HTMLElement;
    inner2.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(row('h1').classList.contains('gm-commit-row-hover')).toBe(true);
    inner2.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    expect(row('h1').classList.contains('gm-commit-row-hover')).toBe(false);
    expect(row('h1').classList.contains('gm-commit-row-selected')).toBe(true);

    // 直接派发到列表容器（closest 未命中）的悬停/移出不应抛出异常
    expect(windowErrors).toEqual([]);
  });

  it('仅主提交选中（不在多选集合）时行仍应高亮且移出保持', () => {
    const commits = setupCommits();
    createPanel();
    // 只改 selectedCommit，保证订阅回调的 changed 仅含该字段
    setState(s => { s.selectedCommit = commits[0]; });
    expect(row('h1').classList.contains('gm-commit-row-selected')).toBe(true);

    const target = row('h1');
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(target.classList.contains('gm-commit-row-hover')).toBe(true);
    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    expect(target.classList.contains('gm-commit-row-hover')).toBe(false);
    expect(target.classList.contains('gm-commit-row-selected')).toBe(true);
  });

  it('分支标签应该按提交映射渲染本地/远程配色并在分支变化时刷新', () => {
    const commits = setupCommits();
    setState(s => {
      // 真实 git 返回的 branch.commit 是 7 位短哈希，测试须复刻该形状，
      // 否则用完整哈希喂进去会掩盖「短哈希 vs 完整哈希匹配失败」的缺陷
      s.branches = [
        { name: 'dev', isCurrent: true, isRemote: false, commit: commits[0].hash.slice(0, 7) },
        { name: 'feature/x', isCurrent: false, isRemote: true, commit: commits[0].hash.slice(0, 7) },
        { name: 'origin/main', isCurrent: false, isRemote: true, commit: commits[1].hash.slice(0, 7) },
        { name: 'HEAD', isCurrent: false, isRemote: false, commit: commits[2].hash.slice(0, 7) },
        { name: 'wip', isCurrent: false, isRemote: false }, // 无 commit，不应映射到任何提交
      ];
    });
    createPanel();

    /** 取某提交行上的引用徽标容器（data-ref 槽位）内挂载的 Kit badge 元素 */
    const badgeOf = (hash: string, name: string): HTMLElement | null => {
      const slot = [...row(hash).querySelectorAll<HTMLElement>('span[data-ref]')]
        .find(el => el.getAttribute('data-ref') === name);
      return slot?.querySelector('.oc-sdk-badge') ?? null;
    };

    // 同一提交上的多个分支标签都要保留
    expect(row('h1').textContent).toContain('dev');
    expect(row('h1').textContent).toContain('feature/x');
    expect(row('h1').textContent).not.toContain('Stryker was here');

    // 本地分支 → Kit mountBadge（tone=primary）
    const devTag = badgeOf('h1', 'dev');
    expect(devTag).toBeTruthy();
    expect(devTag!.textContent).toBe('dev');
    expect(devTag!.getAttribute('data-tone')).toBe('primary');

    // 远程分支（含 '/'）→ tone=info
    const featureTag = badgeOf('h1', 'feature/x');
    expect(featureTag).toBeTruthy();
    expect(featureTag!.getAttribute('data-tone')).toBe('info');
    const originTag = badgeOf('h2', 'origin/main');
    expect(originTag).toBeTruthy();
    expect(originTag!.getAttribute('data-tone')).toBe('info');

    // HEAD 不算本地分支 → tone=info
    const headTag = badgeOf('h3', 'HEAD');
    expect(headTag).toBeTruthy();
    expect(headTag!.getAttribute('data-tone')).toBe('info');

    // 无分支的提交：没有徽标、没有残留占位文本
    expect(row('h4').querySelectorAll('span[data-ref]').length).toBe(0);
    expect(row('h4').textContent).not.toContain('Stryker was here');

    // 分支字段变化通过订阅局部刷新出新标签
    setState(s => { s.branches = [{ name: 'feature/y', isCurrent: false, isRemote: true, commit: commits[3].hash.slice(0, 7) }]; });
    expect(row('h4').textContent).toContain('feature/y');
    expect(badgeOf('h4', 'feature/y')!.getAttribute('data-tone')).toBe('info');
  });

  it('创建面板时若已有 logBranch 不应出现分支过滤标签', () => {
    setupCommits();
    setState(s => { s.logBranch = 'dev'; });
    createPanel();

    // 分支过滤标签已移除：容器与分支胶囊均不渲染，过滤状态仍保留在 state 中
    expect(container.textContent).not.toContain('分支:');
    expect(container.querySelector('[data-action="btn-clear-branch"]')).toBeNull();
    expect(getState().logBranch).toBe('dev');
    // 不应因缺少标签元素抛出异常
    expect(windowErrors).toEqual([]);
  });

  it('点击列表与工具栏的空白区域不应触发选择或过滤动作', () => {
    const { onCommitSelect } = createPanel(); // 空提交场景下点击空白也不应抛错

    const list = container.querySelector('[data-hash]')?.parentElement
      ?? (container.lastElementChild as HTMLElement);
    list.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCommitSelect).not.toHaveBeenCalled();
    expect(selectedHashes()).toEqual([]);

    // 点击工具栏内没有 data-action 的搜索框区域
    const input = container.querySelector('input[placeholder="文本或哈希"]') as HTMLElement;
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(getState().commitSearch).toBe('');
    expect(onCommitSelect).not.toHaveBeenCalled();

    // 空白区域点击的各处 closest 未命中分支都不应抛出异常
    expect(windowErrors).toEqual([]);
  });

  it('右键列表空白处不应弹出菜单且右键提交会阻止默认菜单', async () => {
    setupCommits();
    createPanel();

    const list = row('h1').parentElement as HTMLElement;
    list.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menuEl()).toBeNull();

    // 右键真实提交行：preventDefault 生效（dispatchEvent 返回 false）
    const allowed = row('h1').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(allowed).toBe(false);
    // 菜单在异步查询工作区状态后才渲染
    await new Promise(r => setTimeout(r, 0));
    expect(menuEl()).toBeTruthy();
  });

  it('右键批量菜单复制哈希应该按新到旧顺序写入剪贴板', async () => {
    setupCommits();
    createPanel();
    clickRow('h1');
    clickRow('h2', { ctrlKey: true });

    const clipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: writeTextMock }, configurable: true });
    // 宿主通道不可用，验证回退到浏览器 Clipboard API 的路径
    writeClipboardMock.mockRejectedValueOnce(new Error('host 通道不可用'));
    try {
      await contextRow('h2');
      const menu = menuEl() as HTMLElement;
      const copyItem = [...menu.children].find(el => el.textContent === '复制哈希列表') as HTMLElement;
      expect(copyItem).toBeTruthy();
      copyItem.click();

      await vi.waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(`${fullHash('h2')}\n${fullHash('h1')}`);
      });
    } finally {
      if (clipboardDesc) {
        Object.defineProperty(navigator, 'clipboard', clipboardDesc);
      } else {
        delete (navigator as unknown as Record<string, unknown>).clipboard;
      }
    }
  });

  it('状态订阅应该输出带前缀的结构化调试日志', () => {
    setupCommits();
    createPanel();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      setState(s => { s.filteredCommits = s.allCommits.slice(0, 2); });
      const logs = debugSpy.mock.calls.map(args => String(args[0]));
      expect(logs.some(l => l.includes('"event":"sub_changed"') && l.includes('"prefix":"[commit-list]"'))).toBe(true);
      expect(logs.some(l => l.includes('"event":"render_list"') && l.includes('"prefix":"[commit-list]"'))).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('仅 logBranch 变化不应出现分支过滤标签且不重建提交行', () => {
    setupCommits();
    createPanel();

    const before = row('h1');
    setState(s => { s.logBranch = 'dev'; });

    expect(row('h1')).toBe(before); // 行元素引用未变 → 未整体重渲染
    expect(container.querySelector('[data-action="btn-clear-branch"]')).toBeNull();
    expect(container.textContent).not.toContain('分支:');
  });

  it('Ctrl 建立的锚点与普通点击锚点都应支持后续 Shift 范围选', () => {
    setupCommits();
    createPanel();

    // 普通点击第 1 行（idx=0）建立锚点
    clickRow('h1');
    clickRow('h3', { shiftKey: true });
    expect(selectedHashes()).toEqual(['h1', 'h2', 'h3']);

    // Ctrl 点击第 1 行（idx=0）重新建立锚点后，Shift 仍应能范围选
    clickRow('h1', { ctrlKey: true });
    expect(selectedHashes()).toEqual(['h2', 'h3']);
    clickRow('h3', { shiftKey: true });
    expect(selectedHashes()).toEqual(['h1', 'h2', 'h3']);
  });

  it('搜索应该大小写不敏感地匹配短哈希与作者', () => {
    const commits = makeCommits();
    commits.push({
      hash: `h500000${'0'.repeat(33)}`,
      shortHash: 'h500000',
      message: 'refactor: 重命名模块',
      authorName: 'alice',
      authorEmail: 'd@example.com',
      date: new Date().toISOString(),
      parents: [],
    });
    setupCommits(commits);
    createPanel();

    // 按短哈希搜索（小写关键字应匹配）
    inputSearch('h1');
    expect(container.querySelectorAll('[data-hash]').length).toBe(1);
    expect(row('h1')).toBeTruthy();

    // 按作者名搜索（小写关键字应匹配小写英文作者）
    inputSearch('alice');
    expect(container.querySelectorAll('[data-hash]').length).toBe(1);
    expect(row('h5')).toBeTruthy();
  });

  it('作者过滤应该只保留指定作者的提交', () => {
    setupCommits();
    createPanel();

    setState(s => { s.filterAuthor = '张三'; });
    triggerFilter();

    expect(filteredHashes()).toEqual(['h1', 'h3']);
  });

  it('起始日期过滤应该按“不早于”边界保留提交', () => {
    const commits = setupCommits();
    createPanel();

    // 边界取 h2 的日期：>= 应保留 h2 自身
    setState(s => { s.filterDateFrom = commits[1].date; });
    triggerFilter();

    expect(filteredHashes()).toEqual(['h1', 'h2']);
  });

  it('截止日期过滤应该按“不晚于”边界保留提交', () => {
    const commits = setupCommits();
    createPanel();

    // 边界取 h3 的日期：<= 应保留不晚于该时点的 h3 与更早的 h4
    setState(s => { s.filterDateTo = commits[2].date; });
    triggerFilter();

    expect(filteredHashes()).toEqual(['h3', 'h4']);
  });

  it('刷新后应该按当前过滤条件重新计算列表', async () => {
    const commits = setupCommits();
    createPanel();
    setState(s => { s.filterAuthor = '张三'; });
    getLogMock.mockResolvedValue(commits);

    kitBtn('btn-refresh').click();

    await vi.waitFor(() => {
      expect(filteredHashes()).toEqual(['h1', 'h3']);
    });
  });

  it('刷新失败时应提示用户并保留原列表', async () => {
    setupCommits();
    createPanel();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    toastMock.mockClear();
    try {
      getLogMock.mockRejectedValue(new Error('网络异常'));
      kitBtn('btn-refresh').click();

      // 回归：此前失败只写 console，用户点刷新后看不出任何变化
      await vi.waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
          kind: 'error',
          message: expect.stringContaining('加载提交列表失败'),
        }));
      });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('refresh_commits_error'));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('提交时间应该按相对时间格式化并回退到本地日期', () => {
    const commits = makeRelativeCommits();
    setupCommits(commits);
    createPanel();

    expect(row('t1').textContent).toContain('刚刚');
    expect(row('t2').textContent).toContain('1分钟前');
    expect(row('t6').textContent).toContain('1小时前');
    expect(row('t3').textContent).toContain('3小时前');
    expect(row('t4').textContent).toContain('1天前');

    // 超过 7 天回退到本地日期，而不是“7天前”
    expect(row('t5').textContent).not.toContain('7天前');
    expect(row('t5').textContent).toContain(new Date(commits[5].date).toLocaleDateString('zh-CN'));
  });

  // ===== 排序（sortMode） =====

  it('sortMode 为 default 时应保持提交原序（过滤重算后仍为原序）', () => {
    setupCommits();
    createPanel();

    expect(rowOrder()).toEqual(['h1', 'h2', 'h3', 'h4']);
    setState(s => { s.sortMode = 'default'; }); // 同值赋值不触发订阅
    triggerFilter(); // 走 filterCommits 过滤管道重算
    expect(rowOrder()).toEqual(['h1', 'h2', 'h3', 'h4']);
    expect(filteredHashes()).toEqual(['h1', 'h2', 'h3', 'h4']);
  });

  it('date-asc 模式应按日期升序渲染', () => {
    setupCommits();
    createPanel();

    setState(s => { s.sortMode = 'date-asc'; });

    expect(filteredHashes()).toEqual(['h4', 'h3', 'h2', 'h1']);
    expect(rowOrder()).toEqual(['h4', 'h3', 'h2', 'h1']);
  });

  it('author-asc 模式应按作者升序且同作者按日期降序', () => {
    setupCommits(makeSortCommits());
    createPanel();

    setState(s => { s.sortMode = 'author-asc'; });

    // alice(s2,s4) → bob(s3) → carol(s1)；alice 内部按日期降序 s2 在前
    expect(filteredHashes()).toEqual(['s2', 's4', 's3', 's1']);
    expect(rowOrder()).toEqual(['s2', 's4', 's3', 's1']);
  });

  it('message-asc 模式应按消息升序且同消息按日期降序', () => {
    setupCommits(makeSortCommits());
    createPanel();

    setState(s => { s.sortMode = 'message-asc'; });

    // docs: c(s3) → feat: a(s2) → fix: a(s1,s4 按日期降序)
    expect(filteredHashes()).toEqual(['s3', 's2', 's1', 's4']);
    expect(rowOrder()).toEqual(['s3', 's2', 's1', 's4']);
  });

  it('排序模式下重新触发过滤管道应保持排序结果', () => {
    setupCommits();
    createPanel();
    setState(s => { s.sortMode = 'date-asc'; });

    triggerFilter(); // filterCommits 末尾应再次应用排序

    expect(rowOrder()).toEqual(['h4', 'h3', 'h2', 'h1']);
  });

  it('排序模式生效后外部按原序写入列表应被自动重排', () => {
    setupCommits();
    createPanel();
    setState(s => { s.sortMode = 'date-asc'; });
    expect(rowOrder()).toEqual(['h4', 'h3', 'h2', 'h1']);

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      // 模拟外部（如 main.ts 数据加载）直接按原序写入 filteredCommits
      setState(s => { s.filteredCommits = [...s.allCommits]; });

      expect(filteredHashes()).toEqual(['h4', 'h3', 'h2', 'h1']);
      expect(rowOrder()).toEqual(['h4', 'h3', 'h2', 'h1']);

      // 兜底重排应输出带前缀/事件/排序模式的结构化日志
      const realignLog = parseDebugLogs(debugSpy).find(p => p.event === 'sort_realign');
      expect(realignLog).toMatchObject({
        prefix: '[commit-list]',
        event: 'sort_realign',
        sortMode: 'date-asc',
      });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('非默认排序模式应显示排序标签且点击 × 恢复默认排序', () => {
    setupCommits();
    createPanel();

    setState(s => { s.sortMode = 'date-asc'; });
    const clearSort = container.querySelector('[data-action="btn-clear-sort"]') as HTMLElement;
    expect(clearSort).toBeTruthy();
    expect(clearSort.textContent).toBe('×');
    expect(clearSort.parentElement?.textContent).toContain('排序: 日期升序');
    expect(rowOrder()).toEqual(['h4', 'h3', 'h2', 'h1']);

    clearSort.click();

    expect(getState().sortMode).toBe('default');
    expect(container.querySelector('[data-action="btn-clear-sort"]')).toBeNull();
    expect(rowOrder()).toEqual(['h1', 'h2', 'h3', 'h4']);
  });

  it('logBranch 与非默认排序并存时过滤容器应只含排序标签且文案随排序模式切换', () => {
    setupCommits();
    createPanel();
    setState(s => {
      s.logBranch = 'dev';
      s.sortMode = 'author-asc';
    });

    // 容器只含排序标签：分支过滤标签已移除，不出现分支胶囊与清除按钮
    const clearSort = container.querySelector('[data-action="btn-clear-sort"]') as HTMLElement;
    expect(clearSort.parentElement?.textContent).toContain('排序: 作者');
    expect(container.textContent).not.toContain('分支:');
    expect(container.querySelector('[data-action="btn-clear-branch"]')).toBeNull();

    // 排序标签 × 只重置排序，不影响分支过滤状态
    clearSort.click();
    expect(getState().sortMode).toBe('default');
    expect(getState().logBranch).toBe('dev');
    expect(container.querySelector('[data-action="btn-clear-sort"]')).toBeNull();

    // message-asc 文案切换
    setState(s => { s.sortMode = 'message-asc'; });
    expect(
      (container.querySelector('[data-action="btn-clear-sort"]') as HTMLElement)
        .parentElement?.textContent
    ).toContain('排序: 消息');
  });

  it('sortMode 变化应通过订阅重算并重渲染列表', () => {
    setupCommits();
    createPanel();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      setState(s => { s.sortMode = 'date-asc'; });
      const payloads = parseDebugLogs(debugSpy);
      const events = payloads.map(p => p.event);
      expect(events).toContain('sort_changed');
      expect(events).toContain('render_list');
      // sort_changed 日志的前缀字段也必须完整
      const sortLog = payloads.find(p => p.event === 'sort_changed');
      expect(sortLog).toMatchObject({
        prefix: '[commit-list]',
        event: 'sort_changed',
        sortMode: 'date-asc',
      });
    } finally {
      debugSpy.mockRestore();
    }

    expect(rowOrder()).toEqual(['h4', 'h3', 'h2', 'h1']);
  });

  // ===== 显示设置（displaySettings） =====

  it('关闭作者列后作者内容应从行中消失且重新开启恢复', () => {
    setupCommits();
    createPanel();
    expect(row('h1').querySelector('[data-col="author"]')).toBeTruthy();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      // settings-menu 原地改写对象（引用不变），订阅需按值感知
      setState(s => { s.displaySettings.showAuthor = false; });
      expect(row('h1').querySelector('[data-col="author"]')).toBeNull();
      expect(row('h1').textContent).not.toContain('张三');

      setState(s => { s.displaySettings.showAuthor = true; });
      expect(row('h1').querySelector('[data-col="author"]')).toBeTruthy();
      expect(row('h1').textContent).toContain('张三');

      // 显示设置变化应输出带前缀/事件/设置快照的结构化日志（两次变化）
      const displayLogs = parseDebugLogs(debugSpy).filter(p => p.event === 'display_changed');
      expect(displayLogs.length).toBe(2);
      expect(displayLogs[0]).toMatchObject({
        prefix: '[commit-list]',
        event: 'display_changed',
        settings: { showAuthor: false, showDate: true, showHash: true },
      });
      expect(displayLogs[1]).toMatchObject({
        settings: { showAuthor: true, showDate: true, showHash: true },
      });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('关闭日期列后日期内容应从行中消失且重新开启恢复', () => {
    setupCommits();
    createPanel();
    expect(row('h1').querySelector('[data-col="date"]')).toBeTruthy();

    setState(s => { s.displaySettings.showDate = false; });
    expect(row('h1').querySelector('[data-col="date"]')).toBeNull();
    expect(row('h1').textContent).not.toContain('天前');

    setState(s => { s.displaySettings.showDate = true; });
    expect(row('h1').querySelector('[data-col="date"]')).toBeTruthy();
    expect(row('h1').textContent).toContain('天前');
  });

  it('关闭哈希列后哈希内容应从行中消失且重新开启恢复', () => {
    setupCommits();
    createPanel();
    const hashCol = row('h1').querySelector('[data-col="hash"]');
    expect(hashCol).toBeTruthy();
    expect(prefixOf(hashCol!.textContent ?? '')).toBe('h1');

    setState(s => { s.displaySettings.showHash = false; });
    expect(row('h1').querySelector('[data-col="hash"]')).toBeNull();

    setState(s => { s.displaySettings.showHash = true; });
    expect(prefixOf(row('h1').querySelector('[data-col="hash"]')?.textContent ?? '')).toBe('h1');
  });

  it('全部列关闭时提交行仍应渲染并保留消息列', () => {
    setupCommits();
    createPanel();

    setState(s => {
      s.displaySettings = { showAuthor: false, showDate: false, showHash: false, showLongEdges: true, showTagNames: true, compactReferences: false, preferCommitDate: false, referencesOnLeft: false };
    });

    expect(container.querySelectorAll('[data-hash]').length).toBe(4);
    const h1 = row('h1');
    expect(h1.querySelector('[data-col="author"]')).toBeNull();
    expect(h1.querySelector('[data-col="date"]')).toBeNull();
    expect(h1.querySelector('[data-col="hash"]')).toBeNull();
    expect(h1.textContent).toContain('feat: 新增分支面板');
    // 列关闭时的空串不应被替换为占位文本
    expect(h1.textContent).not.toContain('Stryker was here!');
  });

  // ===== 工具栏按钮接线 =====

  it('设置按钮应打开显示设置菜单并可通过菜单项联动列显隐', () => {
    setupCommits();
    createPanel();

    kitBtn('btn-settings').click();

    const menu = document.getElementById('git-settings-menu');
    expect(menu).toBeTruthy();
    expect(menu!.textContent).toContain('显示作者列');

    // 点击菜单项关闭日期列：状态与行渲染同步变化
    (menu!.querySelector('[data-key="showDate"]') as HTMLElement).click();
    expect(getState().displaySettings.showDate).toBe(false);
    expect(row('h1').querySelector('[data-col="date"]')).toBeNull();
  });

  it('工具栏操作按钮 title 应为 zh-CN 的 i18n 文案', () => {
    setupCommits();
    createPanel();

    const titles: Record<string, string> = {
      'btn-refresh': '刷新',
      'btn-cherry-pick': 'Cherry-pick',
      'btn-settings': '显示设置',
      'btn-goto': '跳转到引用',
    };
    for (const [action, title] of Object.entries(titles)) {
      const btn = container.querySelector(`[data-action="${action}"]`) as HTMLElement;
      expect(btn.title, `${action} 的 title`).toBe(title);
    }
  });

  it('跳转对话框：哈希前缀命中应单选提交、滚动定位并关闭对话框', () => {
    const commits = setupCommits();
    const { onCommitSelect } = createPanel();

    // jsdom 未实现 scrollIntoView，注入桩以断言滚动调用
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const hadOwn = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
    const original = proto['scrollIntoView'];
    const scrollSpy = vi.fn();
    proto['scrollIntoView'] = scrollSpy;
    try {
      kitBtn('btn-goto').click();
      expect(gotoInput()).toBeTruthy();
      typeGoto('H2'); // 大小写不敏感的哈希前缀
      clickGotoOk();

      expect(gotoInput()).toBeNull(); // 对话框已关闭
      expect(getState().selectedCommit).toBe(commits[1]);
      expect(selectedHashes()).toEqual(['h2']);
      expect(onCommitSelect).toHaveBeenCalledWith(commits[1]);
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      if (hadOwn) proto['scrollIntoView'] = original;
      else delete proto['scrollIntoView'];
    }
  });

  it('跳转对话框：分支名精确命中应写入 logBranch 并选中分支首条提交', () => {
    const commits = setupCommits();
    const { onCommitSelect } = createPanel();
    setState(s => {
      s.branches = [
        { name: 'dev', isCurrent: true, isRemote: false, commit: fullHash('h3').slice(0, 7) },
        { name: 'feature/x', isCurrent: false, isRemote: true },
      ];
    });

    kitBtn('btn-goto').click();
    typeGoto('dev');
    clickGotoOk();

    expect(gotoInput()).toBeNull();
    expect(getState().logBranch).toBe('dev');
    // 分支首条提交 = 分支 tip（commit: h3）
    expect(getState().selectedCommit).toBe(commits[2]);
    expect(selectedHashes()).toEqual(['h3']);
    expect(onCommitSelect).toHaveBeenCalledWith(commits[2]);
    // 分支过滤标签已移除：不渲染分支胶囊与清除按钮（过滤状态由分支面板高亮承载）
    expect(container.querySelector('[data-action="btn-clear-branch"]')).toBeNull();
    expect(container.textContent).not.toContain('分支:');
  });

  it('跳转对话框：未命中应显示未找到提示且保持打开', () => {
    setupCommits();
    createPanel();

    kitBtn('btn-goto').click();
    typeGoto('不存在的引用');
    clickGotoOk();

    expect(gotoErrorText()).toBe('未找到匹配项');
    // 对话框未关闭，状态未变化
    expect(gotoInput()).toBeTruthy();
    expect(getState().selectedCommit).toBeNull();
    expect(getState().logBranch).toBeNull();
  });

  // ===== 跳转（goto）：结构化日志与边界场景 =====

  it('跳转查询为单字符前缀时应按 startsWith 命中首个匹配提交', () => {
    const commits = setupCommits();
    createPanel();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      kitBtn('btn-goto').click();
      typeGoto('h'); // startsWith('h') 命中 h1；endsWith('h') 不会命中任何提交
      clickGotoOk();

      expect(gotoInput()).toBeNull(); // 对话框已关闭
      expect(getState().selectedCommit).toBe(commits[0]);
      expect(selectedHashes()).toEqual(['h1']);
      expect(windowErrors).toEqual([]);
      const log = parseDebugLogs(debugSpy).find(p => p.event === 'goto_commit');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'goto_commit', hash: fullHash('h1') });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('跳转分支匹配应取查询名本身而非分支列表首项', () => {
    const commits = setupCommits();
    createPanel();
    setState(s => {
      s.branches = [
        { name: 'other', isCurrent: false, isRemote: false }, // 首项非查询名
        { name: 'dev', isCurrent: true, isRemote: false, commit: fullHash('h3').slice(0, 7) },
      ];
    });

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      kitBtn('btn-goto').click();
      typeGoto('dev');
      clickGotoOk();

      expect(gotoInput()).toBeNull();
      expect(getState().logBranch).toBe('dev');
      expect(getState().selectedCommit).toBe(commits[2]); // 分支 tip = h3
      expect(windowErrors).toEqual([]);
      const log = parseDebugLogs(debugSpy).find(p => p.event === 'goto_branch');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'goto_branch', branchName: 'dev' });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('跳转到无提交记录的分支时应只写入 logBranch 且不选中提交', () => {
    setupCommits([]); // 无任何提交
    const { onCommitSelect } = createPanel();
    setState(s => {
      s.branches = [{ name: 'dev', isCurrent: true, isRemote: false }]; // 分支无 commit
    });

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      kitBtn('btn-goto').click();
      typeGoto('dev');
      clickGotoOk();

      expect(gotoInput()).toBeNull();
      expect(getState().logBranch).toBe('dev');
      expect(getState().selectedCommit).toBeNull();
      expect(onCommitSelect).not.toHaveBeenCalled();
      // branchCommit 为空时不得解引用（否则回调抛错会进入 window error）
      expect(windowErrors).toEqual([]);
      const log = parseDebugLogs(debugSpy).find(p => p.event === 'goto_branch');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'goto_branch', branchName: 'dev' });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('跳转未命中时应输出 goto_not_found 结构化日志', () => {
    setupCommits();
    createPanel();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      kitBtn('btn-goto').click();
      typeGoto('不存在的引用');
      clickGotoOk();

      expect(gotoInput()).toBeTruthy(); // 保持打开
      expect(windowErrors).toEqual([]);
      const log = parseDebugLogs(debugSpy).find(p => p.event === 'goto_not_found');
      expect(log).toMatchObject({
        prefix: '[commit-list]',
        event: 'goto_not_found',
        query: '不存在的引用',
      });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('搜索过滤隐藏目标行后跳转定位不应抛出异常', () => {
    const commits = setupCommits();
    createPanel();
    inputSearch('fix'); // 过滤后 h1 行不在 DOM 中
    expect(row('h1')).toBeNull();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      kitBtn('btn-goto').click();
      typeGoto('h');
      clickGotoOk();

      expect(getState().selectedCommit).toBe(commits[0]);
      // 目标行缺失时应直接返回，不得解引用 null
      expect(windowErrors).toEqual([]);
      const log = parseDebugLogs(debugSpy).find(p => p.event === 'goto_commit');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'goto_commit', hash: fullHash('h1') });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('环境未实现 scrollIntoView 时应按行偏移量滚动容器降级', () => {
    const commits = setupCommits();
    createPanel();

    // 在原型链上定位 scrollIntoView 的定义并临时移除（jsdom 可能定义在上层原型或未实现）
    let ownerProto: object | null = null;
    let sivDesc: PropertyDescriptor | undefined;
    for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptor(p, 'scrollIntoView');
      if (d) {
        ownerProto = p;
        sivDesc = d;
        break;
      }
    }
    if (ownerProto) delete (ownerProto as Record<string, unknown>)['scrollIntoView'];

    // 覆盖 offsetTop 使降级滚动量可断言
    const offsetDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get: () => 120 });

    // 捕获对 container.scrollTop 的写入
    let scrolledTo: number | null = null;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => scrolledTo ?? 0,
      set: (v: number) => { scrolledTo = v; },
    });

    try {
      kitBtn('btn-goto').click();
      typeGoto('H2');
      clickGotoOk();

      expect(getState().selectedCommit).toBe(commits[1]);
      expect(scrolledTo).toBe(120); // 降级分支必须写入 container.scrollTop = row.offsetTop
      expect(windowErrors).toEqual([]);
    } finally {
      if (ownerProto && sivDesc) Object.defineProperty(ownerProto, 'scrollIntoView', sivDesc);
      if (offsetDesc) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetDesc);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)['offsetTop'];
      delete (container as unknown as Record<string, unknown>)['scrollTop'];
    }
  });

  // ===== 工具栏错误日志与点击边界 =====

  it('点击分支过滤下拉不应打开跳转对话框', () => {
    setupCommits();
    createPanel();

    // 分支过滤为自绘下拉按钮，点击它弹出下拉而非跳转对话框
    openKitSelect('filter-branch');

    expect(gotoInput()).toBeNull();
    expect(windowErrors).toEqual([]);
    // 清理弹层，避免跨用例残留
    closeKitSelect('filter-branch');
  });

  // ===== 订阅与渲染边界 =====

  it('无关状态变化不应重建过滤标签容器', () => {
    setupCommits();
    createPanel();
    setState(s => { s.sortMode = 'date-asc'; }); // 排序标签是容器当前唯一承载
    const clearSort = container.querySelector('[data-action="btn-clear-sort"]') as HTMLElement;
    expect(clearSort).toBeTruthy();

    // 外部写入满足 date-asc 的子集：不含 logBranch/sortMode 字段，不触发标签刷新
    setState(s => { s.filteredCommits = [s.allCommits[3], s.allCommits[2]]; });

    expect(clearSort.isConnected).toBe(true); // 标签元素引用未被移除
    expect(container.querySelector('[data-action="btn-clear-sort"]')).toBe(clearSort);
    expect(rowOrder()).toEqual(['h4', 'h3']);
  });

  it('显示设置变化后无关状态变化不应重复输出 display_changed 日志', () => {
    setupCommits();
    createPanel();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      setState(s => { s.displaySettings.showDate = false; }); // 首次变化 → 1 条日志
      setState(s => { s.filteredCommits = s.allCommits.slice(0, 2); }); // 无关变化 → 不应再记日志

      const displayLogs = parseDebugLogs(debugSpy).filter(p => p.event === 'display_changed');
      expect(displayLogs.length).toBe(1);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('无分支与排序条件时工具栏不应追加过滤标签占位', () => {
    setupCommits();
    createPanel();

    const toolbar = container.firstElementChild as HTMLElement;
    /** 统计工具栏直属 span 子元素（过滤标签根节点为 span，其余子元素为 div/button） */
    const spanCount = () => [...toolbar.children].filter(el => el.tagName === 'SPAN').length;
    expect(spanCount()).toBe(0);

    setState(s => { s.sortMode = 'date-asc'; }); // 反向确认：有条件时确实追加标签
    expect(spanCount()).toBe(1);
  });

  it('作者列左边距应随日期列显隐在 12px 与 auto 间切换', () => {
    setupCommits();
    createPanel();

    // 日期列显示 → 作者列走基础类（左边距 12px 由 CSS 类承担）
    const authorCol = row('h1').querySelector('[data-col="author"]') as HTMLElement;
    expectSemanticClass(authorCol, 'gm-commit-col-author');
    expect(authorCol.classList.contains('gm-commit-col-author-shift')).toBe(false);

    // 日期列隐藏 → 作者列接替右对齐（shift 类）
    setState(s => { s.displaySettings.showDate = false; });
    const authorCol2 = row('h1').querySelector('[data-col="author"]') as HTMLElement;
    expectSemanticClass(authorCol2, ['gm-commit-col-author', 'gm-commit-col-author-shift']);
  });

  it('作者名中的特殊字符应经转义后按原文渲染', () => {
    const commits = makeCommits();
    commits.unshift({
      hash: fullHash('hx'),
      shortHash: fullHash('hx').slice(0, 7),
      message: 'feat: 特殊字符',
      authorName: 'A&quot;B<C>D"E', // 含实体样序列、尖括号与引号
      authorEmail: 'x@example.com',
      date: new Date().toISOString(),
      parents: [],
    });
    setupCommits(commits);
    createPanel();

    const authorCol = row('hx').querySelector('[data-col="author"]') as HTMLElement;
    expect(authorCol.textContent).toBe('A&quot;B<C>D"E'); // 转义后解析回原文
    expect(authorCol.children.length).toBe(0); // 未转义时 <C> 会被解析成元素
  });

  it('已排序列表被外部原样写入时不应触发兜底重排日志（含同日期提交）', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    /** 构造指定时间差的提交（date-asc 下已按升序排列） */
    const mk = (hash: string, agoMs: number): CommitInfo => ({
      hash,
      shortHash: hash,
      message: `feat: ${hash}`,
      authorName: '张三',
      authorEmail: 'a@example.com',
      date: new Date(now - agoMs).toISOString(),
      parents: [],
    });
    // e3 最旧在前；e1/e2 同日期相邻（compare = 0）
    const commits = [mk('e3', 3 * day), mk('e1', day), mk('e2', day)];
    setupCommits(commits);
    createPanel();
    setState(s => { s.sortMode = 'date-asc'; });
    expect(rowOrder()).toEqual(['e3', 'e1', 'e2']);

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      setState(s => { s.filteredCommits = [...s.allCommits] }); // 外部按已排序顺序原样写入

      const realignLogs = parseDebugLogs(debugSpy).filter(p => p.event === 'sort_realign');
      expect(realignLogs).toEqual([]); // 相邻同日期比较为 0，不应判为无序
      expect(rowOrder()).toEqual(['e3', 'e1', 'e2']);
    } finally {
      debugSpy.mockRestore();
    }
  });

  // ===== filterCommits 导出直调（main.ts loadData 刷新场景复用） =====

  it('外部替换 allCommits 后直接调用 filterCommits 应按活动搜索过滤重算', () => {
    setupCommits();
    setState(s => { s.commitSearch = 'fix'; }); // 活动过滤：仅命中消息含 fix 的提交

    // 模拟刷新场景：外部只替换 allCommits，filteredCommits 仍为旧列表
    const fresh: CommitInfo[] = [
      { hash: 'n1', shortHash: 'n1', message: 'fix: 新列表命中项', authorName: '张三', authorEmail: 'a@example.com', date: new Date().toISOString(), parents: [] },
      { hash: 'n2', shortHash: 'n2', message: 'feat: 新列表未命中项', authorName: '李四', authorEmail: 'b@example.com', date: new Date().toISOString(), parents: [] },
    ];
    setState(s => { s.allCommits = fresh; });

    filterCommits();

    // 只保留新列表中命中过滤条件的提交，旧列表的 h2 不应残留
    expect(filteredHashes()).toEqual(['n1']);
  });

  it('非默认排序模式下直接调用 filterCommits 应对新替换的 allCommits 排序', () => {
    setupCommits();
    setState(s => { s.sortMode = 'date-asc'; });

    // 外部按原序（新→旧）同时替换 allCommits 与 filteredCommits（不创建面板，
    // 避免订阅兜底重排掩盖 filterCommits 自身的排序行为）
    const fresh = makeCommits();
    setState(s => {
      s.allCommits = fresh;
      s.filteredCommits = fresh;
    });

    filterCommits();

    expect(filteredHashes()).toEqual(['h4', 'h3', 'h2', 'h1']);
  });

  // ===== 过滤工具栏接线（Cc / .* / 分支▾ / 用户▾ / 日期▾ / 路径▾） =====

  /** 过滤按钮激活态语义类 */
  const ACTIVE_CLASS = 'gm-commit-filter-btn-active';

  /** 获取当前打开的下拉菜单容器（不存在返回 null） */
  const dropdownMenu = () => document.getElementById('git-dropdown-menu');

  /** 按 id 取下拉菜单行元素 */
  const dropdownRow = (id: string) =>
    dropdownMenu()?.querySelector(`[data-id="${id}"]`) as HTMLElement | null;

  /** 读取下拉行的选中标记文本（无标记返回空串，行不存在返回 null） */
  const dropdownChecked = (id: string) =>
    dropdownRow(id)?.querySelector('.git-dropdown-check')?.textContent ?? null;

  /** 按 data-action 取工具栏按钮（自绘过滤按钮：正则/大小写/日期/路径） */
  const toolbarBtn = (action: string) =>
    container.querySelector(`[data-action="${action}"]`) as HTMLElement;

  /**
   * 取工具栏右侧图标按钮（自绘 button+getIcon）。
   * 刷新/Cherry-pick/设置/跳转 保持自绘图标按钮：mountButton 仅支持文本 label、无图标插槽，
   * 图标型按钮用 Kit 会退化为空白，故直接点击按钮本体即可触发委托处理。
   */
  const kitBtn = (action: 'btn-refresh' | 'btn-cherry-pick' | 'btn-settings' | 'btn-goto') =>
    container.querySelector(`[data-action="${action}"]`) as HTMLElement;

  /** 读取路径下拉中已选路径条目的 data-id 列表（p: 前缀，按渲染顺序） */
  const pathEntryIds = () =>
    Array.from(dropdownMenu()?.querySelectorAll('[data-id^="p:"]') ?? []).map(el =>
      el.getAttribute('data-id'),
    );

  // ===== 自绘 dropdown-menu（分支/用户过滤单选下拉）交互辅助 =====
  // 与日期/路径下拉同源：点击自绘按钮弹出 #git-dropdown-menu，选中态存于 .git-dropdown-check 勾选标记

  /** 取分支/用户过滤触发按钮（自绘 button，点它弹出 dropdown-menu） */
  const kitSelect = (slot: 'filter-branch' | 'filter-user'): HTMLElement => {
    const btn = toolbarBtn(slot);
    expect(btn, `槽位 ${slot} 应为自绘过滤按钮`).toBeTruthy();
    return btn;
  };

  /** 取触发按钮本体（自绘下拉由按钮 toggle，与 kitSelect 同元素） */
  const kitTrigger = (slot: 'filter-branch' | 'filter-user'): HTMLButtonElement =>
    kitSelect(slot) as HTMLButtonElement;

  /** 打开分支/用户过滤下拉（点击自绘按钮） */
  const openKitSelect = (slot: 'filter-branch' | 'filter-user') => {
    kitTrigger(slot).click();
  };

  /** 取当前打开的下拉容器（未打开返回 null） */
  const kitPopup = (): HTMLElement | null => dropdownMenu() as HTMLElement | null;

  /**
   * 取下拉内指定 id 的行，并包装为兼容旧 aria-selected 断言的代理对象。
   * 自绘行无 aria-selected 属性，选中态存于 .git-dropdown-check 勾选标记；
   * 代理把 getAttribute('aria-selected') 映射为：选中→'true'、未选→'false'，
   * 其余成员（click/querySelector/textContent 等）原样透传真实行元素。
   * @param id 行的 data-id（分支=纯分支名，用户=作者名，all=全部）
   * @returns 行代理；行不存在返回 null
   */
  const kitOption = (id: string): HTMLElement | null => {
    const row = dropdownRow(id);
    if (!row) return null;
    return new Proxy(row, {
      get(target, prop) {
        if (prop === 'getAttribute') {
          return (name: string): string | null => {
            if (name === 'aria-selected') {
              return dropdownChecked(id) ? 'true' : 'false';
            }
            return target.getAttribute(name);
          };
        }
        const value = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as unknown as HTMLElement;
  };

  /** 读取过滤按钮当前值文案（.gm-filter-btn-value，未选显示“全部”） */
  const kitValue = (slot: 'filter-branch' | 'filter-user'): string =>
    (kitSelect(slot).querySelector('.gm-filter-btn-value')?.textContent ?? '');

  /** 按渲染顺序返回下拉各行的 data-id 列表（分支=纯分支名，用户=作者名，首项 all） */
  const kitOptionIds = (): string[] =>
    Array.from(kitPopup()?.querySelectorAll('[data-id]') ?? []).map(el => el.getAttribute('data-id') ?? '');

  /** 关闭下拉（自绘 Escape 同步关闭，等价于点击外部关闭；slot 仅为保持调用签名） */
  const closeKitSelect = (slot: 'filter-branch' | 'filter-user') => {
    void slot;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  };

  it('正则开关应切换 searchRegex 并让字面搜不到的模式按正则命中', () => {
    setupCommits();
    createPanel();

    // 字面模式：'fix.*列表' 不是任何提交的原文 → 无命中
    inputSearch('fix.*列表');
    expect(filteredHashes()).toEqual([]);

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      toolbarBtn('btn-regex').click(); // 开启正则 → 订阅/显式过滤重算

      expect(getState().searchRegex).toBe(true);
      expect(filteredHashes()).toEqual(['h2']); // 'fix: 修复提交列表渲染' 被正则命中

      const log = parseDebugLogs(debugSpy).find(p => p.event === 'search_regex_toggled');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'search_regex_toggled', value: true });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('大小写开关应影响正则模式：敏感时无 i 标志不命中异大小写文本', () => {
    setupCommits();
    createPanel();
    toolbarBtn('btn-regex').click(); // 正则模式
    toolbarBtn('btn-case').click(); // 大小写敏感

    expect(getState().searchCaseSensitive).toBe(true);
    inputSearch('FIX.*'); // 消息为小写 fix:…，无 i 标志应不命中
    expect(filteredHashes()).toEqual([]);

    toolbarBtn('btn-case').click(); // 关闭敏感 → 恢复 i 标志
    expect(getState().searchCaseSensitive).toBe(false);
    expect(filteredHashes()).toEqual(['h2']);
  });

  it('非法正则应输出结构化错误日志、不抛错并回退为字面匹配', () => {
    const commits = makeCommits();
    commits.push({
      hash: 'h6',
      shortHash: 'h6',
      message: 'chore: 保留 [unclosed] 字面标记',
      authorName: '王五',
      authorEmail: 'c@example.com',
      date: new Date().toISOString(),
      parents: [],
    });
    setupCommits(commits);
    createPanel();
    toolbarBtn('btn-regex').click();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      inputSearch('[unclosed'); // 非法正则：缺少闭合括号

      // 回退字面匹配：命中消息中含 '[unclosed' 的提交
      expect(filteredHashes()).toEqual(['h6']);
      expect(windowErrors).toEqual([]); // 不抛错

      const payloads = errorSpy.mock.calls
        .map(c => String(c[0]))
        .map(l => {
          try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; }
        })
        .filter((p): p is Record<string, unknown> => p !== null);
      const invalidLog = payloads.find(p => p.event === 'regex_invalid');
      expect(invalidLog).toMatchObject({ prefix: '[commit-list]', event: 'regex_invalid' });
      expect(String(invalidLog!.error)).toContain('SyntaxError');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('字面模式的大小写开关应控制命中与否', () => {
    setupCommits();
    createPanel();

    inputSearch('Fix'); // 默认不区分大小写 → 命中小写 fix:…
    expect(filteredHashes()).toEqual(['h2']);

    toolbarBtn('btn-case').click(); // 大小写敏感 → 'Fix' 不再命中 'fix:…'
    expect(filteredHashes()).toEqual([]);

    toolbarBtn('btn-case').click(); // 关闭后恢复
    expect(filteredHashes()).toEqual(['h2']);
  });

  it('Cc 与 .* 按钮点击应翻转状态标志并切换激活样式与调试日志', () => {
    setupCommits();
    createPanel();
    const regexBtn = toolbarBtn('btn-regex') as HTMLButtonElement;
    const caseBtn = toolbarBtn('btn-case') as HTMLButtonElement;

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      regexBtn.click();
      expect(getState().searchRegex).toBe(true);
      expect(regexBtn.classList.contains(ACTIVE_CLASS)).toBe(true);
      expectSemanticClass(regexBtn, 'gm-commit-filter-btn');

      caseBtn.click();
      expect(getState().searchCaseSensitive).toBe(true);
      expect(caseBtn.classList.contains(ACTIVE_CLASS)).toBe(true);

      regexBtn.click(); // 再次点击恢复
      expect(getState().searchRegex).toBe(false);
      expect(regexBtn.classList.contains(ACTIVE_CLASS)).toBe(false);

      caseBtn.click();
      expect(getState().searchCaseSensitive).toBe(false);
      expect(caseBtn.classList.contains(ACTIVE_CLASS)).toBe(false);

      const events = parseDebugLogs(debugSpy).map(p => p.event);
      expect(events).toContain('search_regex_toggled');
      expect(events).toContain('search_case_toggled');
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('logBranch/filterAuthor/日期字段变化应激活日期按钮，分支/用户值展示在下拉按钮上', () => {
    setupCommits();
    createPanel();
    const dateBtn = toolbarBtn('btn-filter-date');
    // 让分支选项里存在 dev，按钮才能展示其名称
    setState(s => { s.branches = [{ name: 'dev', isCurrent: true, isRemote: false }]; });

    setState(s => { s.logBranch = 'dev'; });
    // 分支/用户过滤为自绘下拉按钮：选中值展示在按钮文案上（无独立激活态样式）
    expect(kitValue('filter-branch')).toBe('dev');

    setState(s => { s.filterAuthor = '张三'; });
    expect(kitValue('filter-user')).toBe('张三');

    setState(s => { s.filterDateFrom = new Date().toISOString(); });
    expect(dateBtn.classList.contains(ACTIVE_CLASS)).toBe(true);

    // 清除全部过滤状态 → 日期按钮恢复未激活，select 回到“全部”
    setState(s => {
      s.logBranch = null;
      s.filterAuthor = '';
      s.filterDateFrom = '';
    });
    expect(dateBtn.classList.contains(ACTIVE_CLASS)).toBe(false);
    expect(kitValue('filter-branch')).toBe('全部');
    expect(kitValue('filter-user')).toBe('全部');
    // 日期按钮元素引用未被重建（激活态刷新只改样式）
    expect(toolbarBtn('btn-filter-date')).toBe(dateBtn);
  });

  it('分支下拉应按本地/远程/收藏给出提示并默认选中全部', () => {
    setupCommits();
    createPanel();
    setState(s => {
      s.branches = [
        { name: 'dev', isCurrent: true, isRemote: false },
        { name: 'feature/x', isCurrent: false, isRemote: false },
        { name: 'origin/main', isCurrent: false, isRemote: true },
        { name: 'wip', isCurrent: false, isRemote: false },
      ];
      s.favorites = new Set(['wip']);
      s.logBranch = null;
    });

    openKitSelect('filter-branch');

    const popup = kitPopup();
    expect(popup).toBeTruthy();
    // 自绘下拉无分组标题，分组信息降级为选项 label 的 hint 后缀
    expect(popup!.textContent).toContain('全部');
    expect(popup!.textContent).toContain('本地分支');
    expect(popup!.textContent).toContain('远程分支');
    expect(popup!.textContent).toContain('收藏');
    // 收藏的 wip 仍在选项内，且其 label 内联标注收藏 hint（自绘 label 形如 `wip (收藏)`）
    const wip = kitOption('wip');
    expect(wip).toBeTruthy();
    expect(wip!.textContent).toContain('收藏');
    // 默认选中“全部”（aria-selected=true）
    expect(kitOption('all')!.getAttribute('aria-selected')).toBe('true');
    expect(kitOption('dev')!.getAttribute('aria-selected')).toBe('false');

    // 关闭弹层，避免跨用例残留
    closeKitSelect('filter-branch');
    expect(kitPopup()).toBeNull();
  });

  it('分支下拉选择分支应写入 logBranch/selectedBranch 并以分支参数重新拉取', async () => {
    const commits = setupCommits();
    createPanel();
    const branch = { name: 'dev', isCurrent: true, isRemote: false };
    setState(s => { s.branches = [branch]; });
    getLogMock.mockResolvedValue(commits);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      openKitSelect('filter-branch');
      kitOption('dev')!.click();

      expect(getState().logBranch).toBe('dev');
      expect(getState().selectedBranch).toBe(branch); // 面板高亮同步
      expect(getState().selectedCommits.size).toBe(0); // 多选清空

      await vi.waitFor(() => {
        expect(getLogMock).toHaveBeenCalledWith('/repo', 'dev', undefined);
      });

      const log = parseDebugLogs(debugSpy).find(p => p.event === 'branch_dropdown_select');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'branch_dropdown_select', branch: 'dev' });
      expect(kitPopup()).toBeNull(); // 选中后弹层关闭
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('分支下拉选择全部应清空分支状态且 getLog 不带分支参数', async () => {
    setupCommits();
    createPanel();
    setState(s => {
      s.branches = [{ name: 'dev', isCurrent: true, isRemote: false }];
      s.logBranch = 'dev';
    });

    openKitSelect('filter-branch');
    expect(kitOption('dev')!.getAttribute('aria-selected')).toBe('true'); // 当前分支选中
    expect(kitOption('all')!.getAttribute('aria-selected')).toBe('false');
    kitOption('all')!.click();

    expect(getState().logBranch).toBeNull();
    expect(getState().selectedBranch).toBeNull();
    expect(getState().selectedCommits.size).toBe(0);

    await vi.waitFor(() => {
      expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, undefined);
    });
  });

  it('再次点击分支触发器应 toggle 关闭弹层', () => {
    setupCommits();
    createPanel();

    openKitSelect('filter-branch');
    expect(kitPopup()).toBeTruthy();

    kitTrigger('filter-branch').click();
    expect(kitPopup()).toBeNull();
  });

  it('用户下拉应从 allCommits 去重排序渲染作者并支持选择与清除', () => {
    setupCommits();
    createPanel();

    openKitSelect('filter-user');

    // 4 条提交中张三出现两次 → 去重后 3 位作者，按 UTF-16 序排列（含“全部”选项）
    expect(kitOptionIds()).toEqual(['all', '张三', '李四', '王五']);
    expect(kitOption('all')!.getAttribute('aria-selected')).toBe('true');

    kitOption('李四')!.click();
    expect(getState().filterAuthor).toBe('李四');
    expect(filteredHashes()).toEqual(['h2']);
    expect(kitValue('filter-user')).toBe('李四');

    // 再次打开选“全部” → 清除作者过滤
    openKitSelect('filter-user');
    expect(kitOption('李四')!.getAttribute('aria-selected')).toBe('true');
    kitOption('all')!.click();
    expect(getState().filterAuthor).toBe('');
    expect(filteredHashes()).toEqual(['h1', 'h2', 'h3', 'h4']);
    expect(kitValue('filter-user')).toBe('全部');
  });

  it('用户下拉应输出结构化选择日志', () => {
    setupCommits();
    createPanel();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      openKitSelect('filter-user');
      kitOption('张三')!.click();

      const log = parseDebugLogs(debugSpy).find(p => p.event === 'user_dropdown_select');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'user_dropdown_select', author: '张三' });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('allCommits 为空时用户下拉应只有“全部”一项', () => {
    setupCommits([]);
    createPanel();

    openKitSelect('filter-user');

    const popup = kitPopup();
    expect(popup).toBeTruthy();
    expect(kitOptionIds()).toEqual(['all']);
    expect(kitOption('all')!.getAttribute('aria-selected')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    closeKitSelect('filter-user');
    expect(kitPopup()).toBeNull();
  });

  it('日期下拉选择“今天”应写入精确本地日界区间并排除旧提交', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0)); // 固定：2026-01-15 12:00 本地时间
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const commits: CommitInfo[] = [
        { hash: 'c-new', shortHash: 'c-new', message: 'feat: 今天的新提交', authorName: '张三', authorEmail: 'a@example.com', date: new Date(now - 3600_000).toISOString(), parents: [] },
        { hash: 'c-old', shortHash: 'c-old', message: 'feat: 三天前的旧提交', authorName: '张三', authorEmail: 'a@example.com', date: new Date(now - 3 * day).toISOString(), parents: [] },
      ];
      setupCommits(commits);
      createPanel();

      toolbarBtn('btn-filter-date').click();
      dropdownRow('today')!.click();

      expect(getState().filterDateFrom).toBe(new Date(2026, 0, 15, 0, 0, 0, 0).toISOString());
      expect(getState().filterDateTo).toBe(new Date(2026, 0, 15, 23, 59, 59, 999).toISOString());
      expect(filteredHashes()).toEqual(['c-new']); // 旧提交被排除
      expect(toolbarBtn('btn-filter-date').classList.contains(ACTIVE_CLASS)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('本周预设应在年边界（1月1日）与周日都按周一为起点计算', () => {
    vi.useFakeTimers();
    try {
      setupCommits();
      createPanel();

      // 2026-01-01 是周四（年边界）：本周一为 2025-12-29，本周日为 2026-01-04
      vi.setSystemTime(new Date(2026, 0, 1, 10, 0, 0));
      toolbarBtn('btn-filter-date').click();
      dropdownRow('thisWeek')!.click();
      expect(getState().filterDateFrom).toBe(new Date(2025, 11, 29, 0, 0, 0, 0).toISOString());
      expect(getState().filterDateTo).toBe(new Date(2026, 0, 4, 23, 59, 59, 999).toISOString());

      // 2026-01-04 是周日：仍属同一周，区间不变
      vi.setSystemTime(new Date(2026, 0, 4, 10, 0, 0));
      toolbarBtn('btn-filter-date').click();
      dropdownRow('thisWeek')!.click();
      expect(getState().filterDateFrom).toBe(new Date(2025, 11, 29, 0, 0, 0, 0).toISOString());
      expect(getState().filterDateTo).toBe(new Date(2026, 0, 4, 23, 59, 59, 999).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it('日期下拉勾选应随状态重算，选择全部应清空区间', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
      setupCommits();
      createPanel();

      // 先选“今天”写入状态
      toolbarBtn('btn-filter-date').click();
      dropdownRow('today')!.click();

      // 重新打开：today 勾选、all 无勾
      toolbarBtn('btn-filter-date').click();
      expect(dropdownChecked('today')).toBe('✓');
      expect(dropdownChecked('all')).toBe('');
      expect(dropdownChecked('thisMonth')).toBe('');

      // 选“全部” → 区间清空、按钮恢复未激活
      dropdownRow('all')!.click();
      expect(getState().filterDateFrom).toBe('');
      expect(getState().filterDateTo).toBe('');
      expect(filteredHashes()).toEqual(['h1', 'h2', 'h3', 'h4']);
      expect(toolbarBtn('btn-filter-date').classList.contains(ACTIVE_CLASS)).toBe(false);

      // 再打开：all 勾选、today 无勾
      toolbarBtn('btn-filter-date').click();
      expect(dropdownChecked('all')).toBe('✓');
      expect(dropdownChecked('today')).toBe('');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('日期下拉选自定义应打开日期范围对话框并把回调区间写入状态', () => {
    setupCommits();
    createPanel();

    toolbarBtn('btn-filter-date').click();
    dropdownRow('custom')!.click();

    // 对话框打开（菜单已随选择关闭）
    expect(document.getElementById('daterange-from')).toBeTruthy();
    expect(dropdownMenu()).toBeNull();

    (document.getElementById('daterange-from') as HTMLInputElement).value = '2026-01-01';
    (document.getElementById('daterange-to') as HTMLInputElement).value = '2026-01-31';
    clickDaterangeOk();

    expect(getState().filterDateFrom).toBe('2026-01-01');
    expect(getState().filterDateTo).toBe('2026-01-31');
    expect(document.getElementById('daterange-from')).toBeNull(); // 应用后关闭
    expect(toolbarBtn('btn-filter-date').classList.contains(ACTIVE_CLASS)).toBe(true);
  });

  it('日期下拉应输出结构化选择日志', () => {
    setupCommits();
    createPanel();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      toolbarBtn('btn-filter-date').click();
      dropdownRow('thisMonth')!.click();

      const log = parseDebugLogs(debugSpy).find(p => p.event === 'date_dropdown_select');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'date_dropdown_select', preset: 'thisMonth' });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('路径按钮应可点击且样式与其他自绘下拉按钮一致', () => {
    setupCommits();
    createPanel();

    const pathBtn = toolbarBtn('btn-filter-path') as HTMLButtonElement;
    // 四个过滤按钮均为自绘 dropdown-menu 按钮，样式应一致
    const dateBtn = toolbarBtn('btn-filter-date');
    // 不再是禁用态：无 disabled 属性、与其他自绘下拉按钮同语义类、不弱化透明度
    expect(pathBtn.hasAttribute('disabled')).toBe(false);
    expect(pathBtn.disabled).toBe(false);
    expect(pathBtn.className).toBe(dateBtn.className);
    expectSemanticClass(pathBtn, 'gm-commit-filter-btn');
    expect(pathBtn.getAttribute('style') ?? '').not.toContain('opacity');
    expect(pathBtn.getAttribute('style') ?? '').not.toContain('not-allowed');
    // label 为 zh-CN 的 filter.path 文案（不再设置 pathSoon 提示）
    expect(pathBtn.textContent).toContain('路径');
    expect(pathBtn.title).not.toContain('暂未实现');
  });

  it('点击路径▾应展示全部/分隔线/选择文件夹/编辑路径结构（空过滤时全部勾选）', () => {
    setupCommits();
    createPanel();

    toolbarBtn('btn-filter-path').click();

    const menu = dropdownMenu();
    expect(menu).toBeTruthy();
    expect(menu!.textContent).toContain('全部');
    expect(menu!.textContent).toContain('选择文件夹…'); // filter.chooseFolder（zh-CN）
    expect(menu!.textContent).toContain('编辑路径…'); // filter.editPaths（zh-CN，新增条目）
    expect(dropdownChecked('all')).toBe('✓'); // filterPaths 为空 → 全部勾选
    expect(dropdownRow('pick')).toBeTruthy();
    expect(dropdownRow('edit')).toBeTruthy();
    expect(pathEntryIds()).toEqual([]); // 无已选路径 → 无逐条移除条目
    expect(menu!.querySelector('[data-kind="separator"]')).toBeTruthy();

    // Escape 关闭，避免菜单跨用例残留
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dropdownMenu()).toBeNull();
  });

  it('已选路径应逐条渲染为勾选条目且全部条目不勾选', () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['src/', 'docs/']; });

    toolbarBtn('btn-filter-path').click();

    expect(pathEntryIds()).toEqual(['p:src/', 'p:docs/']);
    expect(dropdownRow('p:src/')!.querySelector('.git-dropdown-check')!.textContent).toBe('✓');
    expect(dropdownRow('p:docs/')!.querySelector('.git-dropdown-check')!.textContent).toBe('✓');
    expect(dropdownChecked('all')).toBe(''); // 有过滤时全部不勾选

    // Escape 关闭，避免菜单跨用例残留
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('路径过滤中点全部应清空 filterPaths 并以无路径参数重新拉取', async () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['src/']; }); // 已有路径过滤 → 按钮激活
    expect(toolbarBtn('btn-filter-path').classList.contains(ACTIVE_CLASS)).toBe(true);
    getLogMock.mockResolvedValue(makeCommits());

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      toolbarBtn('btn-filter-path').click();
      expect(dropdownChecked('all')).toBe(''); // 有过滤时全部不勾选
      dropdownRow('all')!.click();

      expect(getState().filterPaths).toEqual([]);
      await vi.waitFor(() => {
        expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, undefined);
      });
      expect(toolbarBtn('btn-filter-path').classList.contains(ACTIVE_CLASS)).toBe(false); // 激活态熄灭

      const log = parseDebugLogs(debugSpy).find(p => p.event === 'path_dropdown_select');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'path_dropdown_select', path: [] });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('点已选路径条应仅移除该条并以剩余数组重新拉取', async () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['src/', 'docs/']; });
    getLogMock.mockResolvedValue(makeCommits());

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      toolbarBtn('btn-filter-path').click();
      dropdownRow('p:src/')!.click();

      expect(getState().filterPaths).toEqual(['docs/']); // 其余条目保留
      await vi.waitFor(() => {
        expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, ['docs/']);
      });

      const log = parseDebugLogs(debugSpy).find(p => p.event === 'path_dropdown_select');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'path_dropdown_select', path: ['docs/'] });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('移除最后一条已选路径应清空数组并以无路径参数重新拉取', async () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['src/']; });
    getLogMock.mockResolvedValue(makeCommits());

    toolbarBtn('btn-filter-path').click();
    dropdownRow('p:src/')!.click();

    expect(getState().filterPaths).toEqual([]);
    await vi.waitFor(() => {
      expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, undefined);
    });
    expect(toolbarBtn('btn-filter-path').classList.contains(ACTIVE_CLASS)).toBe(false); // 激活态熄灭
  });

  it('点选择文件夹应打开路径勾选树并保留不在列表中的已选路径', async () => {
    setupCommits();
    createPanel();
    listFilesMock.mockResolvedValue(['src/index.ts', 'docs/readme.md']);
    setState(s => { s.filterPaths = ['packages/']; }); // 不在文件列表中 → 孤儿行

    toolbarBtn('btn-filter-path').click();
    dropdownRow('pick')!.click();

    expect(dropdownMenu()).toBeNull(); // 选择后菜单关闭
    expect(document.getElementById('pathtree-list')).toBeTruthy(); // 树对话框（filter.selectPaths 标题）
    expect(document.body.textContent).toContain('选择要过滤的路径');
    await vi.waitFor(() => {
      expect(document.querySelector('.pathtree-row')).toBeTruthy();
    });
    // 打开时快照作为 selected 传入：孤儿路径常驻根层渲染，不丢值
    expect(document.querySelector('[data-path="packages/"]')).toBeTruthy();

    // Escape 关闭残留对话框
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('pathtree-list')).toBeNull();
  });

  it('树对话框勾选应用应写入 filterPaths 数组并重新拉取', async () => {
    setupCommits();
    createPanel();
    listFilesMock.mockResolvedValue(['src/index.ts', 'docs/readme.md']);
    getLogMock.mockResolvedValue(makeCommits());

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      toolbarBtn('btn-filter-path').click();
      dropdownRow('pick')!.click();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-path="src"]')).toBeTruthy();
      });

      (document.querySelector('[data-path="src"]') as HTMLElement).click(); // 勾选 src 目录
      const okBtn = pathtreeOkButton();
      expect(okBtn.disabled).toBe(false);
      okBtn.click();

      expect(getState().filterPaths).toEqual(['src']);
      expect(document.getElementById('pathtree-list')).toBeNull(); // 应用后关闭
      await vi.waitFor(() => {
        expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, ['src']);
      });
      expect(toolbarBtn('btn-filter-path').classList.contains(ACTIVE_CLASS)).toBe(true);

      const log = parseDebugLogs(debugSpy).find(p => p.event === 'path_dropdown_select');
      expect(log).toMatchObject({ prefix: '[commit-list]', event: 'path_dropdown_select', path: ['src'] });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('树对话框确定值与当前相同应仅关闭且不重复发起请求', async () => {
    setupCommits();
    createPanel();
    listFilesMock.mockResolvedValue(['src/index.ts']);
    setState(s => { s.filterPaths = ['src']; });

    toolbarBtn('btn-filter-path').click();
    dropdownRow('pick')!.click();
    // 等待 listFiles 构建完成并渲染（OK 按钮解禁）
    await vi.waitFor(() => {
      expect((pathtreeOkButton()).disabled).toBe(false);
    });
    (pathtreeOkButton()).click();

    expect(document.getElementById('pathtree-list')).toBeNull();
    expect(getState().filterPaths).toEqual(['src']);
    expect(getLogMock).not.toHaveBeenCalled(); // 同内容新数组 → 深比较相同，不重复触发请求
  });

  it('路径按钮激活态应随 filterPaths 订阅切换', () => {
    setupCommits();
    createPanel();
    const pathBtn = toolbarBtn('btn-filter-path');
    expect(pathBtn.classList.contains(ACTIVE_CLASS)).toBe(false); // 初始空数组不过滤

    setState(s => { s.filterPaths = ['src/']; });
    expect(pathBtn.classList.contains(ACTIVE_CLASS)).toBe(true); // 非空 → 点亮

    setState(s => { s.filterPaths = []; });
    expect(pathBtn.classList.contains(ACTIVE_CLASS)).toBe(false); // 恢复空数组 → 熄灭
    // 激活态刷新只改样式，不重建按钮元素
    expect(toolbarBtn('btn-filter-path')).toBe(pathBtn);
  });

  it('已设路径过滤时点刷新应以路径数组调用 getLog', async () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['packages/core', 'docs/']; }); // 多选路径
    getLogMock.mockResolvedValue(makeCommits());

    kitBtn('btn-refresh').click();

    await vi.waitFor(() => {
      expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, ['packages/core', 'docs/']);
    });
  });

  it('刷新传入的路径参数应为状态数组的副本', async () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['src/']; });
    getLogMock.mockResolvedValue(makeCommits());

    kitBtn('btn-refresh').click();

    await vi.waitFor(() => {
      expect(getLogMock).toHaveBeenCalled();
    });
    const passed = getLogMock.mock.calls[0][2] as string[];
    expect(passed).toEqual(['src/']);
    expect(passed).not.toBe(getState().filterPaths); // 副本：外部后续原地变异不影响已发请求
  });

  it('点编辑路径应打开多行编辑对话框并预填当前数组', () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['src/', 'packages/core']; });

    toolbarBtn('btn-filter-path').click();
    dropdownRow('edit')!.click();

    expect(dropdownMenu()).toBeNull(); // 选择后菜单关闭
    const input = pathfilterInput();
    expect(input).toBeTruthy();
    expect(input.value).toBe('src/\npackages/core'); // 预填当前数组（每行一条）

    // Escape 关闭残留对话框
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pathfilterInput()).toBeNull();
  });

  it('编辑路径多行输入确定应写入 filterPaths 数组并以数组参数重新拉取', async () => {
    setupCommits();
    createPanel();
    getLogMock.mockResolvedValue(makeCommits());

    toolbarBtn('btn-filter-path').click();
    dropdownRow('edit')!.click();
    typePathfilter('src/\n docs/core \ndocs/core');
    clickPathfilterOk();

    // 解析：trim + 去空行 + 保序去重（dialogs.parsePathLines）
    expect(getState().filterPaths).toEqual(['src/', 'docs/core']);
    expect(pathfilterInput()).toBeNull(); // 确定后关闭
    await vi.waitFor(() => {
      expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, ['src/', 'docs/core']);
    });
    expect(toolbarBtn('btn-filter-path').classList.contains(ACTIVE_CLASS)).toBe(true); // 激活态点亮
  });

  it('编辑路径确定值与当前相同应仅关闭且不重复发起请求', () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['src/']; });

    toolbarBtn('btn-filter-path').click();
    dropdownRow('edit')!.click();
    // 预填值未修改直接确定 → 解析出同内容的新数组引用
    clickPathfilterOk();

    expect(pathfilterInput()).toBeNull();
    expect(getState().filterPaths).toEqual(['src/']);
    expect(getLogMock).not.toHaveBeenCalled(); // 深比较相同 → 不重复触发请求
  });

  it('编辑路径空输入确定应等价清除路径过滤且无害', async () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['src/']; });
    getLogMock.mockResolvedValue(makeCommits());

    toolbarBtn('btn-filter-path').click();
    dropdownRow('edit')!.click();
    typePathfilter('   ');
    clickPathfilterOk();

    expect(getState().filterPaths).toEqual([]); // trim 后空 → 等价清除
    await vi.waitFor(() => {
      expect(getLogMock).toHaveBeenCalledWith('/repo', undefined, undefined);
    });
    expect(windowErrors).toEqual([]); // 全程不抛错
  });

  it('路径不存在导致返回空列表时应显示暂无提交记录且不抛错', async () => {
    setupCommits();
    createPanel();
    setState(s => { s.filterPaths = ['not-exist/']; });
    getLogMock.mockResolvedValue([]); // 服务端 git log -- 不存在路径 → 空列表

    kitBtn('btn-refresh').click();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('暂无提交记录');
    });
    expect(windowErrors).toEqual([]); // 现有空态承接，不抛错
  });

  it('过滤按钮文案应为 zh-CN 的 i18n 文案', () => {
    setupCommits();
    createPanel();

    expect(toolbarBtn('btn-regex').title).toBe('正则表达式');
    expect(toolbarBtn('btn-case').title).toBe('大小写敏感');
    expect(toolbarBtn('btn-filter-date').textContent).toContain('日期');
    expect(toolbarBtn('btn-filter-path').textContent).toContain('路径');
    // 分支/用户过滤为自绘下拉按钮：文案由当前值（占位“全部”）承载，
    // 断言按钮值 span 的占位文案为 i18n 的“全部”
    expect(kitValue('filter-branch')).toBe('全部');
    expect(kitValue('filter-user')).toBe('全部');
  });

  it('Ctrl+A 应该全选当前过滤后的提交', () => {
    setupCommits();
    createPanel();

    const list = row('h1').parentElement as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));

    expect(getState().selectedCommits.size).toBe(4);
  });

  it('提交列表应该禁止文字选中', () => {
    setupCommits();
    createPanel();

    const list = row('h1').parentElement as HTMLElement;
    // 文字禁选由 .gm-commit-list 类承担（user-select: none）
    expectSemanticClass(list, 'gm-commit-list');
  });

  it('拖拽应该连续选中经过的提交行', () => {
    const commits = setupCommits();
    createPanel();

    const list = row('h1').parentElement as HTMLElement;
    row('h1').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    row('h3').dispatchEvent(new MouseEvent('mousemove', { button: 0, bubbles: true }));

    // h1..h3 连续三行被选中
    expect([...getState().selectedCommits].sort()).toEqual(
      [commits[0].hash, commits[1].hash, commits[2].hash].sort(),
    );

    // 松开后拖拽结束，再移动不再改变选择
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    row('h4').dispatchEvent(new MouseEvent('mousemove', { button: 0, bubbles: true }));
    expect(getState().selectedCommits.size).toBe(3);
    void list;
  });

  it('Cherry-pick 按钮应该按由旧到新依次挑选选中提交并刷新', async () => {
    const commits = setupCommits();
    createPanel();
    const cherryPickMock = vi.mocked(service.cherryPick);
    cherryPickMock.mockResolvedValue(undefined as never);

    // 选中前两条（列表顺序为新→旧，挑选应按旧→新）
    setState(s => { s.selectedCommits = new Set([commits[0].hash, commits[1].hash]); });
    kitBtn('btn-cherry-pick').click();
    await new Promise(r => setTimeout(r, 0));

    expect(cherryPickMock).toHaveBeenCalledTimes(2);
    expect(cherryPickMock.mock.calls[0][1]).toBe(commits[1].hash);
    expect(cherryPickMock.mock.calls[1][1]).toBe(commits[0].hash);
  });

  it('未选中提交时点击 Cherry-pick 不应发起请求，且必须给出可见提示', async () => {
    setupCommits();
    createPanel();
    const cherryPickMock = vi.mocked(service.cherryPick);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    toastMock.mockClear();

    kitBtn('btn-cherry-pick').click();
    await new Promise(r => setTimeout(r, 0));

    expect(cherryPickMock).not.toHaveBeenCalled();
    expect(errSpy.mock.calls.some(c => String(c[0]).includes('cherry_pick_no_selection'))).toBe(true);
    // 回归：此前只打日志，用户看不到任何提示，表现为「点了没反应」
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: '请先选择提交',
    }));
  });

  it('Cherry-pick 成功单个提交后应提示短哈希', async () => {
    const commits = setupCommits();
    createPanel();
    const cherryPickMock = vi.mocked(service.cherryPick);
    cherryPickMock.mockResolvedValue(undefined as never);
    toastMock.mockClear();

    setState(s => { s.selectedCommit = commits[0]; s.selectedCommits = new Set([commits[0].hash]); });
    kitBtn('btn-cherry-pick').click();
    await new Promise(r => setTimeout(r, 0));

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      message: `已 Cherry-pick ${commits[0].hash.slice(0, 7)}`,
    }));
  });

  it('Cherry-pick 多个提交成功时报数量', async () => {
    const commits = setupCommits();
    createPanel();
    const cherryPickMock = vi.mocked(service.cherryPick);
    cherryPickMock.mockResolvedValue(undefined as never);
    toastMock.mockClear();

    setState(s => { s.selectedCommits = new Set([commits[0].hash, commits[1].hash]); });
    kitBtn('btn-cherry-pick').click();
    await new Promise(r => setTimeout(r, 0));

    expect(cherryPickMock).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      message: '已 Cherry-pick 2 个提交',
    }));
  });

  it('Cherry-pick 失败时应展示错误并保留原文可复制', async () => {
    const commits = setupCommits();
    createPanel();
    const cherryPickMock = vi.mocked(service.cherryPick);
    cherryPickMock.mockRejectedValue(new Error('conflict in a.ts'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    toastMock.mockClear();

    setState(s => { s.selectedCommit = commits[0]; s.selectedCommits = new Set([commits[0].hash]); });
    kitBtn('btn-cherry-pick').click();
    await new Promise(r => setTimeout(r, 0));

    // 回归：此前冲突只打 console，界面无任何反馈
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      copy: true,
      message: expect.stringContaining('conflict in a.ts'),
    }));
  });

  /** 读取某行上的引用标签名（去空后） */
  const refNames = (hash: string) =>
    [...row(hash).querySelectorAll<HTMLElement>('span[data-ref]')]
      .map(el => el.textContent ?? '')
      .filter(Boolean);

  /** 构造带三个引用的提交（本地分支 + 远程分支 + 标签） */
  function setupRefs() {
    const commits = setupCommits();
    setState(s => {
      s.branches = [
        { name: 'dev', isCurrent: true, isRemote: false, commit: commits[0].hash.slice(0, 7) },
        { name: 'origin/dev', isCurrent: false, isRemote: true, commit: commits[0].hash.slice(0, 7) },
        { name: 'tag:v1.0', isCurrent: false, isRemote: false, commit: commits[0].hash.slice(0, 7) },
      ];
    });
    return commits;
  }

  it('紧凑引用视图应该只显示第一个引用', () => {
    setupRefs();
    createPanel();
    expect(refNames('h1')).toEqual(['dev', 'origin/dev', 'tag:v1.0']);

    setState(s => { s.displaySettings.compactReferences = true; });
    expect(refNames('h1')).toEqual(['dev']);
  });

  it('关闭标签名称应隐藏标签文字但保留标签色块', () => {
    setupRefs();
    createPanel();
    setState(s => { s.displaySettings.showTagNames = false; });

    // 标签色块仍在（data-ref 保留），但文字为空，因此不出现在 refNames 里
    expect(row('h1').querySelectorAll('span[data-ref]').length).toBe(3);
    expect(refNames('h1')).toEqual(['dev', 'origin/dev']);
  });

  it('紧凑引用与标签名称开关组合结果与应用顺序无关', () => {
    // 先紧凑、再隐藏标签
    setupRefs();
    createPanel();
    setState(s => { s.displaySettings.compactReferences = true; });
    setState(s => { s.displaySettings.showTagNames = false; });
    const orderA = refNames('h1');

    // 先隐藏标签、再紧凑
    setState(s => {
      s.displaySettings.compactReferences = false;
      s.displaySettings.showTagNames = true;
    });
    setState(s => { s.displaySettings.showTagNames = false; });
    setState(s => { s.displaySettings.compactReferences = true; });
    const orderB = refNames('h1');

    expect(orderA).toEqual(orderB);
    // 紧凑下首个引用是分支，标签名开关不影响其显示
    expect(orderA).toEqual(['dev']);
  });

  it('首个引用为标签且标签名隐藏时紧凑模式只保留色块', () => {
    setupRefs();
    // 让标签成为首个引用
    setState(s => {
      const tags = s.branches.filter(b => b.name.startsWith('tag:'));
      const others = s.branches.filter(b => !b.name.startsWith('tag:'));
      s.branches = [...tags, ...others];
    });
    createPanel();

    setState(s => {
      s.displaySettings.compactReferences = true;
      s.displaySettings.showTagNames = false;
    });

    const refs = row('h1').querySelectorAll('span[data-ref]');
    // 只渲染一个标签色块，且文字被隐藏
    expect(refs.length).toBe(1);
    expect(refs[0].textContent).toBe('');
  });

  it('引用显示在左侧时标签应出现在提交消息之前', () => {
    setupRefs();
    createPanel();

    /** 取行内文本顺序中的位置：引用索引与消息索引 */
    const orderOf = () => {
      const spans = [...row('h1').querySelectorAll('span')];
      const refIdx = spans.findIndex(el => el.hasAttribute('data-ref'));
      const msgIdx = spans.findIndex(el => (el.textContent ?? '').includes('feat: 新增分支面板'));
      return { refIdx, msgIdx };
    };

    // 默认在右：引用索引大于消息索引
    const right = orderOf();
    expect(right.refIdx).toBeGreaterThan(right.msgIdx);

    setState(s => { s.displaySettings.referencesOnLeft = true; });
    // 在左：引用索引小于消息索引
    const left = orderOf();
    expect(left.refIdx).toBeLessThan(left.msgIdx);
  });

  it('提交时间戳开关应该在创作时间与提交时间之间切换日期列', () => {
    const now = new Date();
    const authorDate = new Date(now.getTime() - 10 * 86400_000).toISOString(); // 10 天前
    const commitDate = new Date(now.getTime() - 60_000).toISOString();         // 1 分钟前
    setupCommits([
      { hash: fullHash('c1'), shortHash: fullHash('c1').slice(0, 7), message: 'feat: 时间切换',
        authorName: '张三', authorEmail: 'a@example.com', date: authorDate, commitDate, parents: [] },
    ]);
    createPanel();

    const dateText = () => row('c1').querySelector('[data-col="date"]')?.textContent ?? '';

    // 默认显示创作时间（10 天前 → 本地日期，不会是「1分钟前」）
    expect(dateText()).not.toContain('1分钟前');

    setState(s => { s.displaySettings.preferCommitDate = true; });
    expect(dateText()).toContain('1分钟前');
  });

  it('工作区有未提交改动时，编辑提交信息与删除提交应置灰', async () => {
    setupCommits();
    // 让工作区检查返回 false（有未提交改动）
    vi.mocked(service.isWorkingTreeClean).mockResolvedValueOnce(false);
    createPanel();

    await contextRow('h1');

    const menu = menuEl()!;
    /** 按文案取菜单项 */
    const findItem = (label: string) =>
      [...menu.querySelectorAll<HTMLElement>('div')].find(el => el.textContent === label);

    // 改写历史的项置灰（对齐 IDEA：不可用时菜单项直接禁用，而非点击后报错）
    expect(findItem('编辑提交信息')?.classList.contains('gm-ctx-item-disabled')).toBe(true);
    expect(findItem('删除提交')?.classList.contains('gm-ctx-item-disabled')).toBe(true);
    // 不影响历史的项仍可用
    expect(findItem('复制提交哈希')?.classList.contains('gm-ctx-item-disabled')).toBe(false);
  });

  it('工作区干净时，编辑提交信息与删除提交应可用', async () => {
    setupCommits();
    createPanel();

    await contextRow('h1');

    const menu = menuEl()!;
    const findItem = (label: string) =>
      [...menu.querySelectorAll<HTMLElement>('div')].find(el => el.textContent === label);

    expect(findItem('编辑提交信息')?.classList.contains('gm-ctx-item-disabled')).toBe(false);
    expect(findItem('删除提交')?.classList.contains('gm-ctx-item-disabled')).toBe(false);
  });
});
