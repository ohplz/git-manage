/**
 * 分支面板组件单元测试
 * 覆盖：分组渲染与展开状态、分支选择回调、分组折叠、搜索过滤、
 * 高亮样式、订阅局部渲染、dispose 取消订阅、expandAll 展开全部分组、
 * 点击空白区域取消选中并清除分支过滤（对齐 IntelliJ IDEA）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBranchPanel } from '../components/branch-panel';
import { showContextMenu } from '../components/context-menu';
import { createInitialState, getState, setState, stateManager, Branch } from '../state';
import { ServiceClient } from '../service';
import { setLocale, t } from '../i18n';
import {
  expectThemedClass,
  expectSemanticClass,
  expectOnlyRuntimeInlineStyles,
  expectNoHardcodedHex,
} from './theme-helpers';

// 右键菜单模块打桩：分支面板只关心是否以正确参数触发 showContextMenu，菜单自身渲染由 context-menu 测试覆盖
vi.mock('../components/context-menu', () => ({
  showContextMenu: vi.fn(),
  hideContextMenu: vi.fn(),
  showCommitContextMenu: vi.fn(),
}));

/**
 * 解析结构化日志参数为对象
 * @param calls console spy 的调用参数列表
 * @returns JSON 解析后的载荷数组
 */
function parsePayloads(calls: unknown[][]): Array<Record<string, unknown>> {
  return calls.map(c => JSON.parse(String(c[0])) as Record<string, unknown>);
}

/**
 * 构造组件所需的 service mock
 * 组件自身不直接调用 service，右键菜单（context-menu）会用到这些方法
 */
function createServiceMock(): ServiceClient {
  return {
    getBranches: vi.fn().mockResolvedValue([]),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    mergeBranch: vi.fn().mockResolvedValue(undefined),
    rebaseBranch: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    saveFavorites: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    renameBranch: vi.fn().mockResolvedValue(undefined),
  } as unknown as ServiceClient;
}

/**
 * 构造分支夹具
 * 每次调用返回全新对象，保证可与 state 中的引用做严格比较
 */
function makeBranches(): Branch[] {
  return [
    { name: 'main', isCurrent: true, isRemote: false },
    { name: 'develop', isCurrent: false, isRemote: false },
    { name: 'feature/login', isCurrent: false, isRemote: false },
    { name: 'origin/main', isCurrent: false, isRemote: true, remote: 'origin' },
  ];
}

describe('branch-panel', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    // 重置全局状态
    setState(s => Object.assign(s, createInitialState()));
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // 取消订阅并清理 DOM，防止跨用例泄漏
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
    // 还原 console 等 spy，避免跨用例残留
    vi.restoreAllMocks();
  });

  /**
   * 创建分支面板并登记 dispose（由 afterEach 统一调用）
   * @param onBranchSelect 分支选择回调
   * @param onSelectionCleared 点击空白区域的取消选中回调（默认空实现，按需断言）
   */
  function createPanel(
    onBranchSelect: ReturnType<typeof vi.fn> = vi.fn(),
    onSelectionCleared: ReturnType<typeof vi.fn> = vi.fn()
  ) {
    const panel = createBranchPanel(
      container,
      createServiceMock(),
      '/repo',
      onBranchSelect,
      onSelectionCleared
    );
    dispose = panel.dispose;
    return panel;
  }

  /** 获取分支项元素 */
  const branchItem = (name: string) =>
    container.querySelector(`[data-branch="${name}"]`) as HTMLElement;

  /** 获取分组标题元素 */
  const groupHeader = (name: string) =>
    container.querySelector(`[data-group="${name}"]`) as HTMLElement;

  /** 获取分支列表容器（渲染后 container 的最后一个子元素） */
  const listContainer = () => container.lastElementChild as HTMLElement;

  /**
   * 读取状态管理器当前持有的监听器数量
   * dispose 的对外契约是"停止监听状态变化"，监听器集合是唯一可观测点
   * （listeners 为 TS 私有字段，运行时仍可读取，用于验证订阅确实被移除、不泄漏）
   * @returns 监听器数量
   */
  function listenerCount(): number {
    return (stateManager as unknown as { listeners: Set<unknown> }).listeners.size;
  }

  it('应该渲染搜索框与默认分组结构', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // 搜索框存在
    expect(container.querySelector(`input[placeholder="${t('branch.searchPlaceholder')}"]`)).toBeTruthy();

    // HEAD(当前分支) 分组存在且默认展开
    expect(groupHeader('HEAD(当前分支)')).toBeTruthy();
    expect(branchItem('main')).toBeTruthy();

    // 本地分组默认展开：同样包含当前分支（HEAD 组与本地组各一份）
    expect(groupHeader('本地')).toBeTruthy();
    expect(branchItem('develop')).toBeTruthy();
    expect(container.querySelectorAll('[data-branch="main"]').length).toBe(2);
    expect(groupHeader('feature')).toBeTruthy();
    expect(branchItem('feature/login')).toBeFalsy();

    // 远程分组默认折叠，展开后才显示远程分支
    expect(groupHeader('远程')).toBeTruthy();
    expect(branchItem('origin/main')).toBeFalsy();
  });

  it('应该为收藏分支显示星标图标', () => {
    setState(s => {
      s.branches = makeBranches();
      s.favorites = new Set(['develop']);
    });
    createPanel();

    // 收藏分支带星标 svg（title 为「取消收藏」），未收藏分支没有
    const star = branchItem('develop').querySelector('span[title="取消收藏"]');
    expect(star?.querySelector('svg')).toBeTruthy();
    expect(branchItem('main').querySelector('span[title="取消收藏"]')).toBeNull();
  });

  it('分支名以 < 开头时应按文本渲染，不得注入元素（存储型 XSS 回归）', () => {
    // git 允许引用名含 < > 和 /，形如 <img/src=x/onerror=alert(1)> 的分支可直接创建
    const payload = '<img/src=x/onerror=alert(1)>';
    setState(s => {
      s.branches = [{ name: payload, isCurrent: false, isRemote: false }];
    });
    const panel = createPanel();
    panel.expandAll();

    const item = branchItem(payload);
    expect(item).toBeTruthy();
    expect(item.querySelector('img')).toBeNull();
    expect(item.textContent).toContain(payload);
  });

  it('点击分组标题应该展开/折叠分组（本地分组）', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // 本地分组默认展开：箭头朝下，根分支可见
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▼');
    expect(branchItem('develop')).toBeTruthy();

    // 折叠
    groupHeader('本地').click();
    expect(branchItem('develop')).toBeFalsy();
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▶');

    // 再次展开
    groupHeader('本地').click();
    expect(branchItem('develop')).toBeTruthy();
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▼');
  });

  it('点击远程分组标题应该展开/折叠分组（子项出现消失、箭头切换）', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // 远程分组默认折叠：箭头朝右，远程分支不可见
    expect(branchItem('origin/main')).toBeFalsy();
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▶');

    // 点击展开：箭头朝下，远程分支出现
    groupHeader('远程').click();
    expect(branchItem('origin/main')).toBeTruthy();
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▼');

    // 再次点击折叠：远程分支消失，箭头回到朝右
    groupHeader('远程').click();
    expect(branchItem('origin/main')).toBeFalsy();
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▶');
  });

  it('点击本地分组标题应该折叠再恢复展开（当前分支随本地分组显隐）', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // 本地分组默认展开：箭头朝下，当前分支与本地分支可见
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▼');
    expect(branchItem('main')).toBeTruthy();

    // 点击折叠：本地组内子项消失，箭头朝右
    // 当前分支 main 在 HEAD 组仍有一份，故用仅存在于本地组的 develop 断言
    groupHeader('本地').click();
    expect(branchItem('develop')).toBeFalsy();
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▶');

    // 再次点击恢复展开
    groupHeader('本地').click();
    expect(branchItem('develop')).toBeTruthy();
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▼');
  });

  it('点击文件夹分组标题应该展开其中的分支', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    expect(branchItem('feature/login')).toBeFalsy();

    groupHeader('feature').click();
    expect(branchItem('feature/login')).toBeTruthy();

    groupHeader('feature').click();
    expect(branchItem('feature/login')).toBeFalsy();
  });

  it('点击分支项应该回调 onBranchSelect 并更新 selectedBranch（回调先于 setState）', () => {
    const branches = makeBranches();
    setState(s => { s.branches = branches; });
    const onBranchSelect = vi.fn();
    // 记录回调触发时刻的 selectedBranch，验证源码"先回调后 setState"的顺序
    let selectedAtCall: Branch | null | undefined;
    onBranchSelect.mockImplementation(() => {
      selectedAtCall = getState().selectedBranch;
    });
    createPanel(onBranchSelect);

    branchItem('develop').click();

    expect(onBranchSelect).toHaveBeenCalledTimes(1);
    expect(onBranchSelect).toHaveBeenCalledWith(branches[1]);
    // 回调执行时 selectedBranch 尚未更新
    expect(selectedAtCall).toBeNull();
    // 回调完成后 state.selectedBranch 已更新
    expect(getState().selectedBranch).toBe(branches[1]);
  });

  it('Cmd/Ctrl 点击分支应该累加多选且不切换提交列表', () => {
    const branches = makeBranches();
    setState(s => { s.branches = branches; });
    const onBranchSelect = vi.fn();
    createPanel(onBranchSelect);

    // Cmd 点击选中 develop
    branchItem('develop').dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));
    expect([...getState().selectedBranches]).toEqual(['develop']);
    // 多选不触发提交列表切换
    expect(onBranchSelect).not.toHaveBeenCalled();

    // Cmd 点击再选中 main（多选累加）
    branchItem('main').dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));
    expect([...getState().selectedBranches].sort()).toEqual(['develop', 'main']);
    // 两个选中时主选中分支置空
    expect(getState().selectedBranch).toBeNull();
    expect(onBranchSelect).not.toHaveBeenCalled();

    // 再次 Cmd 点击 develop 应取消该项
    branchItem('develop').dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));
    expect([...getState().selectedBranches]).toEqual(['main']);
    // 回到单选：主选中分支同步
    expect(getState().selectedBranch?.name).toBe('main');
  });

  it('普通点击应该清空多选集合并切换提交列表', () => {
    const branches = makeBranches();
    setState(s => {
      s.branches = branches;
      s.selectedBranches = new Set(['main', 'develop']);
    });
    const onBranchSelect = vi.fn();
    createPanel(onBranchSelect);

    branchItem('main').click();

    expect(onBranchSelect).toHaveBeenCalledTimes(1);
    expect(getState().selectedBranches.size).toBe(0);
    expect(getState().selectedBranch?.name).toBe('main');
  });

  it('搜索输入应该过滤分支显示并写入 state.branchFilter', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    const input = container.querySelector('input') as HTMLInputElement;
    input.value = 'devel';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(getState().branchFilter).toBe('devel');
    expect(branchItem('develop')).toBeTruthy();
    expect(branchItem('main')).toBeFalsy();
    expect(branchItem('origin/main')).toBeFalsy();
    expect(branchItem('feature/login')).toBeFalsy();

    // 清空搜索恢复全部显示
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(getState().branchFilter).toBe('');
    expect(branchItem('main')).toBeTruthy();
    expect(branchItem('develop')).toBeTruthy();
  });

  it('当前分支与选中分支应该有不同背景高亮', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // 当前分支（HEAD）带当前态语义类
    expectSemanticClass(branchItem('main'), ['gm-branch-item', 'gm-branch-item-current']);
    // 普通分支无背景态类
    expectSemanticClass(branchItem('develop'), 'gm-branch-item');
    expect(branchItem('develop').classList.contains('gm-branch-item-current')).toBe(false);
    expect(branchItem('develop').classList.contains('gm-branch-item-selected')).toBe(false);

    // 点击选中 develop → 选中态类，main 保持当前分支态
    branchItem('develop').click();
    expectSemanticClass(branchItem('develop'), ['gm-branch-item', 'gm-branch-item-selected']);
    expect(branchItem('develop').classList.contains('gm-branch-item-current')).toBe(false);
    expectSemanticClass(branchItem('main'), ['gm-branch-item', 'gm-branch-item-current']);
    expect(branchItem('main').classList.contains('gm-branch-item-selected')).toBe(false);
  });

  it('state.branches 变化应该通过订阅局部更新列表而不重建搜索框', () => {
    createPanel();
    expect(container.querySelectorAll('[data-branch]').length).toBe(0);

    const searchInput = container.querySelector('input');
    setState(s => { s.branches = makeBranches(); });

    // 可见分支：main（HEAD 组一份 + 本地组一份）+ develop（本地组） = 3
    expect(container.querySelectorAll('[data-branch]').length).toBe(3);
    // 搜索框节点未被重建（仅列表局部渲染）
    expect(container.querySelector('input')).toBe(searchInput);
  });

  it('dispose 后状态变化不应再更新列表', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();
    expect(branchItem('main')).toBeTruthy();

    dispose?.();
    setState(s => {
      s.branches = [{ name: 'hotfix', isCurrent: false, isRemote: false }];
    });

    // 新分支未渲染，旧 DOM 保留
    expect(container.querySelector('[data-branch="hotfix"]')).toBeNull();
    expect(branchItem('main')).toBeTruthy();
  });

  it('创建面板前容器中的旧内容应该被清空（首个子节点为搜索框元素）', () => {
    container.innerHTML = '<p>旧内容</p>';
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // innerHTML 置空后再追加搜索框：首子节点必须是元素节点，而非残留文本
    expect(container.firstChild?.nodeType).toBe(Node.ELEMENT_NODE);
    expect(container.textContent).not.toContain('旧内容');
    expect(
      container.firstElementChild?.querySelector(`input[placeholder="${t('branch.searchPlaceholder')}"]`)
    ).toBeTruthy();
  });

  it('点击列表空白区域应该既不抛错也不触发重渲染', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // 捕获事件监听器中未处理的异常（jsdom 会派发 window error 事件）
    const capturedErrors: ErrorEvent[] = [];
    const onWindowError = (e: ErrorEvent) => { capturedErrors.push(e); };
    window.addEventListener('error', onWindowError);
    try {
      const before = branchItem('develop');
      listContainer().click();

      // 空白点击不属于任何分支或分组：不应有异常，也不应重建列表
      expect(capturedErrors).toHaveLength(0);
      expect(branchItem('develop')).toBe(before);
    } finally {
      window.removeEventListener('error', onWindowError);
    }
  });

  it('点击空白区域且存在选中分支时应该触发 onSelectionCleared 一次并输出 blank_clear 日志', () => {
    const branches = makeBranches();
    setState(s => {
      s.branches = branches;
      s.selectedBranch = branches[1];
    });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const onSelectionCleared = vi.fn();
    createPanel(vi.fn(), onSelectionCleared);

    listContainer().click();

    expect(onSelectionCleared).toHaveBeenCalledTimes(1);
    expect(parsePayloads(debugSpy.mock.calls)).toEqual([
      { prefix: '[branch-panel]', event: 'blank_clear' },
    ]);
  });

  it('点击空白区域且仅存在 logBranch（selectedBranch 为空）时也应该触发清除回调', () => {
    // 模拟跳转对话框只设了 logBranch 过滤、未选中分支项的场景
    setState(s => {
      s.branches = makeBranches();
      s.selectedBranch = null;
      s.logBranch = 'develop';
    });
    const onSelectionCleared = vi.fn();
    createPanel(vi.fn(), onSelectionCleared);

    listContainer().click();

    expect(onSelectionCleared).toHaveBeenCalledTimes(1);
  });

  it('无选中分支且无 logBranch 时点击空白不触发清除回调（noop 并输出 blank_clear_noop）', () => {
    setState(s => { s.branches = makeBranches(); });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const onSelectionCleared = vi.fn();
    createPanel(vi.fn(), onSelectionCleared);

    listContainer().click();

    expect(onSelectionCleared).not.toHaveBeenCalled();
    expect(parsePayloads(debugSpy.mock.calls)).toEqual([
      { prefix: '[branch-panel]', event: 'blank_clear_noop' },
    ]);
  });

  it('点击分组标题应该只折叠分组而不触发清除回调', () => {
    const branches = makeBranches();
    setState(s => {
      s.branches = branches;
      s.selectedBranch = branches[1];
    });
    const onSelectionCleared = vi.fn();
    createPanel(vi.fn(), onSelectionCleared);

    // 分组头点击：折叠生效，但不落入空白清除逻辑
    groupHeader('本地').click();

    expect(branchItem('develop')).toBeFalsy();
    expect(onSelectionCleared).not.toHaveBeenCalled();
  });

  it('点击分支项应该触发 onBranchSelect 且不触发清除回调（含右键菜单场景）', () => {
    const branches = makeBranches();
    setState(s => { s.branches = branches; });
    const onBranchSelect = vi.fn();
    const onSelectionCleared = vi.fn();
    createPanel(onBranchSelect, onSelectionCleared);

    branchItem('develop').click();

    expect(onBranchSelect).toHaveBeenCalledTimes(1);
    expect(onSelectionCleared).not.toHaveBeenCalled();

    // 右键打开上下文菜单同样不触发清除
    branchItem('develop').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    expect(onSelectionCleared).not.toHaveBeenCalled();
  });

  it('点击分支应该输出 branch_click 与 on_branch_select 前后的结构化 debug 日志', () => {
    setState(s => { s.branches = makeBranches(); });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    createPanel();

    branchItem('develop').click();

    expect(parsePayloads(debugSpy.mock.calls)).toEqual([
      { prefix: '[branch-panel]', event: 'branch_click', branchName: 'develop', multi: false },
      { prefix: '[branch-panel]', event: 'before_on_branch_select', branchName: 'develop' },
      { prefix: '[branch-panel]', event: 'after_on_branch_select', branchName: 'develop' },
    ]);
  });

  it('点击分组标题应该输出 group_click 结构化 debug 日志', () => {
    setState(s => { s.branches = makeBranches(); });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    createPanel();

    groupHeader('本地').click();

    expect(parsePayloads(debugSpy.mock.calls)).toEqual([
      { prefix: '[branch-panel]', event: 'group_click', groupName: '本地' },
    ]);
  });

  it('分支选择回调抛错时应该记录错误日志且仍更新选中态', () => {
    setState(s => { s.branches = makeBranches(); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const onBranchSelect = vi.fn(() => {
      throw new Error('boom');
    });
    createPanel(onBranchSelect);

    branchItem('develop').click();

    // catch 分支输出结构化错误日志
    expect(parsePayloads(errorSpy.mock.calls)).toEqual([
      { prefix: '[branch-panel]', event: 'on_branch_select_error', error: 'Error: boom' },
    ]);
    // 源码 catch 之后继续 setState：选中态仍然更新
    expect(getState().selectedBranch?.name).toBe('develop');
    // 回调抛错时 after_on_branch_select 不会输出
    const events = parsePayloads(debugSpy.mock.calls).map(p => p.event);
    expect(events).toEqual(['branch_click', 'before_on_branch_select']);
  });

  it('点击不存在的分支或空 data-branch 应该按约定输出错误日志', () => {
    setState(s => { s.branches = makeBranches(); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createPanel();

    // 已存在分支：不记录 branch_not_found
    branchItem('develop').click();
    expect(errorSpy).not.toHaveBeenCalled();

    // 不存在的分支名：记录完整结构化错误
    const ghost = document.createElement('div');
    ghost.setAttribute('data-branch', 'ghost');
    listContainer().appendChild(ghost);
    ghost.click();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(parsePayloads(errorSpy.mock.calls)).toEqual([
      {
        prefix: '[branch-panel]',
        event: 'branch_not_found',
        branchName: 'ghost',
        availableCount: 4,
        targetTag: 'DIV',
      },
    ]);

    // 空 data-branch：源码 !branchName 提前返回，不记录错误
    errorSpy.mockClear();
    const empty = document.createElement('div');
    empty.setAttribute('data-branch', '');
    listContainer().appendChild(empty);
    empty.click();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('右键分支应该阻止默认行为并打开上下文菜单，右键空白处不处理', () => {
    const branches = makeBranches();
    setState(s => { s.branches = branches; });
    createPanel();

    const branchEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    branchItem('develop').dispatchEvent(branchEvent);
    expect(branchEvent.defaultPrevented).toBe(true);
    expect(vi.mocked(showContextMenu)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showContextMenu)).toHaveBeenCalledWith(
      expect.anything(),
      branches[1],
      expect.anything(),
      '/repo'
    );

    // 空白处右键：没有分支就不处理
    const blankEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    listContainer().dispatchEvent(blankEvent);
    expect(blankEvent.defaultPrevented).toBe(false);
    expect(vi.mocked(showContextMenu)).toHaveBeenCalledTimes(1);
  });

  it('面板创建后收藏字段变化应该通过订阅刷新星标', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();
    expect(branchItem('develop').textContent).not.toContain('★');

    setState(s => { s.favorites = new Set(['develop']); });
    expect(branchItem('develop').querySelector('span[title="取消收藏"]')).toBeTruthy();

    setState(s => { s.favorites = new Set<string>(); });
    expect(branchItem('develop').textContent).not.toContain('★');
  });

  it('状态变化局部更新时应该先清空列表容器旧内容', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();
    const list = listContainer();

    setState(s => {
      s.branches = [{ name: 'hotfix', isCurrent: false, isRemote: false }];
    });

    // 清空后首子节点是重新渲染的分组元素，而非残留文本
    expect(list.firstChild?.nodeType).toBe(Node.ELEMENT_NODE);
    expect(list.textContent).toContain('hotfix');
  });

  it('没有当前分支与远程分支时不应该渲染 HEAD 与远程分组', () => {
    setState(s => {
      s.branches = [
        { name: 'dev-one', isCurrent: false, isRemote: false },
        { name: 'dev-two', isCurrent: false, isRemote: false },
      ];
    });
    createPanel();

    expect(groupHeader('HEAD(当前分支)')).toBeNull();
    expect(groupHeader('本地')).toBeTruthy();
    expect(groupHeader('远程')).toBeNull();
    expect(branchItem('dev-one')).toBeTruthy();
  });

  it('只有远程分支时不应该渲染本地分组', () => {
    setState(s => {
      s.branches = [
        { name: 'origin/main', isCurrent: false, isRemote: true, remote: 'origin' },
        { name: 'origin/dev', isCurrent: false, isRemote: true, remote: 'origin' },
      ];
    });
    createPanel();

    expect(groupHeader('本地')).toBeNull();
    expect(groupHeader('HEAD(当前分支)')).toBeNull();
    expect(groupHeader('远程')).toBeTruthy();
  });

  it('本地分组中根分支应该排在文件夹分组之前', () => {
    setState(s => {
      s.branches = [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'feature/login', isCurrent: false, isRemote: false },
        { name: 'zeta', isCurrent: false, isRemote: false },
      ];
    });
    createPanel();

    const zeta = branchItem('zeta');
    const featureHeader = groupHeader('feature');
    expect(zeta).toBeTruthy();
    expect(featureHeader).toBeTruthy();

    // zeta 是根分支，应排在 feature 文件夹分组之前渲染
    const position = zeta.compareDocumentPosition(featureHeader);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('同一文件夹下的多个分支应该合并到一个分组并可展开', () => {
    setState(s => {
      s.branches = [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'feature/a', isCurrent: false, isRemote: false },
        { name: 'feature/b', isCurrent: false, isRemote: false },
      ];
    });
    createPanel();

    expect(groupHeader('feature')).toBeTruthy();
    expect(branchItem('feature/a')).toBeFalsy();

    groupHeader('feature').click();

    expect(branchItem('feature/a')).toBeTruthy();
    expect(branchItem('feature/b')).toBeTruthy();
    // 分组下除标题外恰好两个分支项，没有多余元素
    const folderRoot = groupHeader('feature').parentElement as HTMLElement;
    expect(folderRoot.querySelectorAll('[data-branch]').length).toBe(2);
  });

  it('文件夹分组箭头应该随展开状态切换并为分支项设置缩进', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // 折叠：箭头朝右，文件夹内分支不可见
    expect(groupHeader('feature').querySelector('span')?.textContent).toBe('▶');
    expect(branchItem('feature/login')).toBeFalsy();

    // 展开：箭头朝下，分支项带 32px 缩进
    groupHeader('feature').click();
    expect(groupHeader('feature').querySelector('span')?.textContent).toBe('▼');
    expect(branchItem('feature/login')).toBeTruthy();
    expect(branchItem('feature/login').style.paddingLeft).toBe('32px');

    // 再次折叠：箭头回到朝右
    groupHeader('feature').click();
    expect(groupHeader('feature').querySelector('span')?.textContent).toBe('▶');
  });

  it('本地与远程分组的箭头应该按各自展开状态显示', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    // 初始集合 ['本地']：本地展开 → ▼；远程未入集合 → ▶
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▼');
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▶');

    // 点击切换后箭头跟随 expandedGroups 集合变化
    groupHeader('本地').click();
    groupHeader('远程').click();
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▶');
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▼');

    // 再次点击恢复初始箭头方向
    groupHeader('本地').click();
    groupHeader('远程').click();
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▼');
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▶');
  });

  it('分支项应该渲染分支图标、规范文本与当前分支加粗样式', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    const main = branchItem('main');
    const develop = branchItem('develop');

    // 分支图标（getIcon('branchIcon')）以 SVG 渲染
    expect(main.querySelector('svg')).toBeTruthy();
    expect(develop.querySelector('svg')).toBeTruthy();

    // 去掉空白后文本恰好是分支名：非收藏分支没有多余标记文本
    expect(develop.textContent?.replace(/\s+/g, '')).toBe('develop');

    /**
     * 取出显示分支名的 span（图标与星标 span 的文本内容不同）
     * @param item 分支项元素
     * @param name 分支名
     * @returns 分支名 span
     */
    const nameSpan = (item: HTMLElement, name: string) =>
      Array.from(item.querySelectorAll('span')).find(s => s.textContent === name) as HTMLElement;

    // 当前分支名称加粗（语义类承载，字体/颜色由 CSS 变量负责）
    expectThemedClass(nameSpan(main, 'main'), ['gm-branch-item-name', 'gm-branch-item-name-current']);
    // 普通分支名称有基础名类，无当前态类
    expectThemedClass(nameSpan(develop, 'develop'), 'gm-branch-item-name');
    expect(nameSpan(develop, 'develop').classList.contains('gm-branch-item-name-current')).toBe(false);

    // 普通分支项无内联背景：style 属性为空（主题样式全部由 CSS 类承担）
    expect(develop.getAttribute('style') ?? '').toBe('');
    expectOnlyRuntimeInlineStyles(develop);
    // 分支名 span 子树（不含图标 SVG）不应出现硬编码颜色
    expectNoHardcodedHex(nameSpan(develop, 'develop'));
  });

  it('按未推送/未拉取状态渲染上下箭头徽标', () => {
    setState(s => {
      s.branches = [
        {
          name: 'main',
          isCurrent: true,
          isRemote: false,
          hasUnpushed: true,
          unpushedCount: 3,
          hasUnpulled: true,
          unpulledCount: 2,
        },
        { name: 'clean', isCurrent: false, isRemote: false },
        {
          name: 'inconsistent',
          isCurrent: false,
          isRemote: false,
          hasUnpushed: false,
          unpushedCount: 5,
          hasUnpulled: false,
          unpulledCount: 7,
        },
      ];
    });
    createPanel();

    expect(branchItem('main').textContent).toContain('↑3');
    expect(branchItem('main').textContent).toContain('↓2');
    expect(branchItem('clean').textContent).not.toContain('↑');
    expect(branchItem('clean').textContent).not.toContain('↓');
    // hasUnpushed/hasUnpulled 为 false 时，即使计数存在也不显示徽标
    expect(branchItem('inconsistent').textContent).not.toContain('↑');
    expect(branchItem('inconsistent').textContent).not.toContain('↓');
  });

  it('expandAll 应展开全部分组（HEAD/本地/远程/文件夹）', () => {
    setState(s => { s.branches = makeBranches(); });
    const panel = createPanel();

    // 预置折叠：HEAD 与本地点击折叠；远程与 feature 文件夹默认即折叠
    groupHeader('HEAD(当前分支)').click();
    groupHeader('本地').click();
    expect(branchItem('main')).toBeFalsy();
    expect(branchItem('develop')).toBeFalsy();
    expect(branchItem('origin/main')).toBeFalsy();
    expect(branchItem('feature/login')).toBeFalsy();

    panel.expandAll();

    // 四个分组箭头全部朝下（含 createCollapsibleGroup 生成的 feature 文件夹分组）
    for (const group of ['HEAD(当前分支)', '本地', '远程', 'feature']) {
      expect(groupHeader(group).querySelector('span')?.textContent).toBe('▼');
    }
    // 所有子项可见
    expect(branchItem('main')).toBeTruthy();
    expect(branchItem('develop')).toBeTruthy();
    expect(branchItem('origin/main')).toBeTruthy();
    expect(branchItem('feature/login')).toBeTruthy();
  });

  it('无分支时调用 expandAll 应安全执行且不渲染分组', () => {
    const panel = createPanel();

    expect(() => panel.expandAll()).not.toThrow();
    expect(container.querySelectorAll('[data-group]').length).toBe(0);
    expect(container.querySelectorAll('[data-branch]').length).toBe(0);
  });

  it('dispose 后调用 expandAll 不应报错且不再重渲染', () => {
    setState(s => { s.branches = makeBranches(); });
    const panel = createPanel();
    panel.dispose();

    expect(() => panel.expandAll()).not.toThrow();
    // 远程分组保持折叠，列表未被重渲染
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▶');
    expect(branchItem('origin/main')).toBeFalsy();
  });

  it('搜索框应渲染 Kit mountSearchField 自带的放大镜图标', () => {
    setState(s => { s.branches = makeBranches(); });
    createPanel();

    const searchRoot = container.querySelector('.oc-sdk-search') as HTMLElement;
    expect(searchRoot, '搜索框应为 Kit mountSearchField').toBeTruthy();
    // 搜索图标由 Kit 渲染（svg），图标缺失说明控件未正确挂载
    expect(searchRoot.querySelector('svg')).toBeTruthy();
  });

  it('搜索框 placeholder 应随 locale 切换（zh-CN 分支或标签 / en Branch or tag）', () => {
    setState(s => { s.branches = makeBranches(); });

    // 默认 zh-CN
    createPanel();
    expect(container.querySelector('input[placeholder="分支或标签"]')).toBeTruthy();

    // 切 en 后重建面板：placeholder 应为英文文案
    dispose?.();
    setLocale('en');
    createPanel();
    expect(container.querySelector('input[placeholder="Branch or tag"]')).toBeTruthy();

    // 还原 locale，避免影响后续用例
    setLocale('zh-CN');
  });

  it('showOnlyMyBranches 开启时应该只渲染我的分支', () => {
    setState(s => {
      s.branches = makeBranches();
      s.showOnlyMyBranches = true;
      s.myBranches = new Set(['main', 'develop']);
    });
    createPanel();

    // 我的本地分支可见
    expect(branchItem('main')).toBeTruthy();
    expect(branchItem('develop')).toBeTruthy();
    // 非我的本地分支被隐藏
    expect(branchItem('feature/login')).toBeNull();
    // 远程分支按判定结果过滤：不在集合内则隐藏
    expect(branchItem('origin/main')).toBeNull();
  });

  it('远程分支判定为我的分支时也应该显示', () => {
    setState(s => {
      s.branches = makeBranches();
      s.showOnlyMyBranches = true;
      s.myBranches = new Set(['develop', 'origin/main']);
    });
    createPanel();

    expect(branchItem('develop')).toBeTruthy();
    // 远程分组默认折叠，展开后应能看到被判定的远程分支
    const remoteGroup = groupHeader('远程');
    expect(remoteGroup).toBeTruthy();
    remoteGroup!.click();
    expect(branchItem('origin/main')).toBeTruthy();
  });

  it('收藏分支但不在我的分支集合内时，开启筛选后也应隐藏', () => {
    setState(s => {
      s.branches = makeBranches();
      s.favorites = new Set(['feature/login']);
      s.showOnlyMyBranches = true;
      s.myBranches = new Set(['develop']);
    });
    createPanel();

    expect(branchItem('develop')).toBeTruthy();
    expect(branchItem('feature/login')).toBeNull();
  });

  it('关闭筛选后应该恢复显示全部分支', () => {
    setState(s => {
      s.branches = makeBranches();
      s.showOnlyMyBranches = true;
      s.myBranches = new Set(['develop']);
    });
    createPanel();
    expect(branchItem('main')).toBeNull();

    // 关闭筛选：订阅应触发重渲染，全部分支恢复
    // 断言默认展开分组内的分支（feature/login 在折叠的文件夹分组内，不可见属正常）
    setState(s => { s.showOnlyMyBranches = false; });
    expect(branchItem('main')).toBeTruthy();
    expect(branchItem('develop')).toBeTruthy();
  });

  it('expandAll 应输出含精确分组计数的 expand_all 日志（文件夹 key 只取首段、根分支不入集合）', () => {
    setState(s => {
      s.branches = [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
        { name: 'a/b/c', isCurrent: false, isRemote: false },
        { name: 'origin/main', isCurrent: false, isRemote: true, remote: 'origin' },
      ];
    });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const panel = createPanel();

    // DOM 侧的 key 构造边界（expandAll 前文件夹默认折叠）：只有首段作为文件夹分组，次级段不成组
    expect(groupHeader('a')).toBeTruthy();
    expect(groupHeader('b')).toBeNull();
    expect(groupHeader('develop')).toBeNull();
    expect(branchItem('a/b/c')).toBeFalsy();

    panel.expandAll();

    // 集合 = 初始 {'HEAD(当前分支)','本地'} + '远程' + 多级分支首段 'a' + 远程首段 'origin' = 5；
    // 无 '/' 的根分支（main/develop）不产生文件夹 key，'a/b/c' 只取第一段
    expect(parsePayloads(debugSpy.mock.calls)).toEqual([
      { prefix: '[branch-panel]', event: 'expand_all', groupCount: 5 },
    ]);

    expect(branchItem('a/b/c')).toBeTruthy();
    expect(branchItem('a/b/c').style.paddingLeft).toBe('32px');
  });

  it('expandAll 后再点击单个分组只应折叠该分组，其余分组保持展开', () => {
    setState(s => { s.branches = makeBranches(); });
    const panel = createPanel();
    panel.expandAll();
    expect(branchItem('feature/login')).toBeTruthy();

    // 折叠 feature 文件夹：仅该文件夹子项消失
    groupHeader('feature').click();
    expect(branchItem('feature/login')).toBeFalsy();
    expect(groupHeader('feature').querySelector('span')?.textContent).toBe('▶');
    // 其他分组不受影响
    expect(branchItem('develop')).toBeTruthy();
    expect(branchItem('main')).toBeTruthy();
    expect(branchItem('origin/main')).toBeTruthy();
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▼');
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▼');

    // 再点恢复展开
    groupHeader('feature').click();
    expect(branchItem('feature/login')).toBeTruthy();
    expect(groupHeader('feature').querySelector('span')?.textContent).toBe('▼');
  });

  it('dispose 后调用 expandAll 应为空操作（不输出 expand_all 日志、不改展开集合）', () => {
    setState(s => { s.branches = makeBranches(); });
    const panel = createPanel();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    panel.dispose();
    expect(() => panel.expandAll()).not.toThrow();

    // disposed 守卫生效时 expandAll 不应执行到日志输出
    expect(parsePayloads(debugSpy.mock.calls)).toEqual([]);
    // 列表也未被重渲染：远程保持折叠
    expect(groupHeader('远程').querySelector('span')?.textContent).toBe('▶');
    expect(branchItem('origin/main')).toBeFalsy();
  });

  it('dispose 后点击分组标题不应触发列表重渲染（节点保持同一引用）', () => {
    setState(s => { s.branches = makeBranches(); });
    const panel = createPanel();
    const developBefore = branchItem('develop');

    panel.dispose();
    // 点击"本地"标题：展开集合被切换，但已 dispose 时 renderList 守卫必须直接返回
    groupHeader('本地').click();

    expect(branchItem('develop')).toBe(developBefore);
    expect(branchItem('develop')).toBeTruthy();
    expect(groupHeader('本地').querySelector('span')?.textContent).toBe('▼');
  });

  it('dispose 应真正取消状态订阅（状态管理器不再持有该面板的监听器）', () => {
    const before = listenerCount();
    setState(s => { s.branches = makeBranches(); });

    const panel = createPanel();
    expect(listenerCount()).toBe(before + 1);

    panel.dispose();
    expect(listenerCount()).toBe(before);
  });

  it('本地分组内根分支直接渲染、文件夹 key 渲染为嵌套分组（分组键构造不变式）', () => {
    setState(s => {
      s.branches = [
        { name: 'root-a', isCurrent: false, isRemote: false },
        { name: 'feat/x', isCurrent: false, isRemote: false },
        { name: 'feat/y', isCurrent: false, isRemote: false },
      ];
    });
    createPanel();

    // 根分支：key === 分支名且仅一个成员 → 直接渲染分支项，不产生同名嵌套分组
    expect(branchItem('root-a')).toBeTruthy();
    expect(groupHeader('root-a')).toBeNull();

    // 文件夹 key：与成员全名不同 → 渲染嵌套分组，折叠时不显示成员
    expect(groupHeader('feat')).toBeTruthy();
    expect(branchItem('feat/x')).toBeFalsy();
    expect(branchItem('feat/y')).toBeFalsy();

    groupHeader('feat').click();
    expect(branchItem('feat/x')).toBeTruthy();
    expect(branchItem('feat/y')).toBeTruthy();
    expect(branchItem('feat/x').style.paddingLeft).toBe('32px');
    // 展开文件夹不影响根分支渲染
    expect(branchItem('root-a')).toBeTruthy();
  });
});
