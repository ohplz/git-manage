/**
 * 左侧图标工具栏组件
 * 40px 宽 IntelliJ 风格图标栏，渲染 Git 快捷操作按钮
 * 图标顺序沿用原 main.ts createSidebar，首个按钮文案与箭头方向随 branchPanelHidden 动态切换
 */

import { html, raw } from '../html';
import { getIcon } from '../icons';
import { t } from '../i18n';
import { getState, subscribeFields } from '../state';

/** 侧边栏图标按钮点击处理器集（顺序对齐 IDEA 分支面板工具栏） */
export interface SidebarHandlers {
  /** 收起/展开分支面板（面板隐藏时图标与文案切换为「显示」） */
  onToggleBranchPanel: () => void;
  /** 新建分支 */
  onNewBranch: () => void;
  /** 更新所选（fetch + 刷新） */
  onRefresh: () => void;
  /** 删除所选分支 */
  onDeleteBranch: () => void;
  /** 与当前分支比较 */
  onCompareBranch: () => void;
  /** 切换「只显示我的分支」筛选 */
  onToggleMyBranches: () => void;
  /** 获取远程更新 */
  onFetch: () => void;
  /** 收藏/取消收藏目标分支 */
  onFavorite: () => void;
  /** 在提交日志中定位所选分支 */
  onLocateBranch: () => void;
  /** 打开显示设置菜单（接收触发事件定位菜单） */
  onSettings: (e: MouseEvent) => void;
  /** 展开分支面板全部分组 */
  onExpandAll: () => void;
  /** 折叠分支面板全部分组 */
  onCollapseAll: () => void;
}

/** 图标项定义 */
interface SidebarItem {
  /** 图标标识（data-sidebar 属性值，用于测试定位） */
  key: string;
  /** getIcon 图标名（存在 customSvg 时忽略） */
  icon: string;
  /** tooltip 文案键（首个图标动态，见 buildToggleTitle） */
  titleKey: string;
  /** 对应处理器键 */
  handler: keyof SidebarHandlers;
  /** 自定义内联 svg（icons 表中缺失的图标） */
  customSvg?: string;
}

/** 侧边栏容器样式（沿用原 main.ts 布局） */
// 样式已迁移到 __styles__/sidebar.css 的 .gm-sidebar class
const SIDEBAR_CLASS = 'gm-sidebar';

// 样式已迁移到 __styles__/sidebar.css 的 .gm-sidebar-btn class
const BUTTON_CLASS = 'gm-sidebar-btn';

/*

/** 激活态背景色（对齐 IDEA ToggleAction 选中时的按钮底色） */

/** 单个图标按钮样式 */
/*

/**
 * 收起/展开按钮的 tooltip
 * @returns 面板隐藏时返回「显示」文案，否则返回「隐藏」文案
 */
function buildToggleTitle(): string {
  return getState().branchPanelHidden
    ? t('sidebar.showBranches')
    : t('sidebar.hideBranches');
}

/**
 * 收起/展开按钮的图标
 * 展开时箭头向左（表示可收起），隐藏时箭头向右（表示可展开）
 * @returns 当前状态对应的 svg 图标
 */
function buildToggleIcon(): string {
  return getState().branchPanelHidden
    ? getIcon('showBranches')
    : getIcon('hideBranches');
}

/** 侧栏图标项（顺序对齐 IDEA 分支面板工具栏） */
const ITEMS: readonly SidebarItem[] = [
  // 顺序对齐 IDEA：收起/展开分支面板位于最前，其余动作紧随其后
  { key: 'hideBranches', icon: 'hideBranches', titleKey: 'sidebar.hideBranches', handler: 'onToggleBranchPanel' },
  { key: 'newBranch', icon: 'newBranch', titleKey: 'sidebar.newBranch', handler: 'onNewBranch' },
  { key: 'refresh', icon: 'updateSelected', titleKey: 'sidebar.update', handler: 'onRefresh' },
  { key: 'delete', icon: 'deleteBranch', titleKey: 'sidebar.deleteBranch', handler: 'onDeleteBranch' },
  { key: 'compare', icon: 'compareBranch', titleKey: 'sidebar.compareBranch', handler: 'onCompareBranch' },
  { key: 'search', icon: 'search', titleKey: 'sidebar.showMyBranches', handler: 'onToggleMyBranches' },
  { key: 'fetch', icon: 'fetch', titleKey: 'sidebar.fetch', handler: 'onFetch' },
  { key: 'favorite', icon: 'favorite', titleKey: 'sidebar.favorite', handler: 'onFavorite' },
  { key: 'locate', icon: 'locate', titleKey: 'sidebar.locate', handler: 'onLocateBranch' },
  { key: 'settings', icon: 'settings', titleKey: 'sidebar.settings', handler: 'onSettings' },
  { key: 'expandAll', icon: 'expandAll', titleKey: 'sidebar.expandAll', handler: 'onExpandAll' },
  { key: 'collapseAll', icon: 'collapseAll', titleKey: 'sidebar.collapseAll', handler: 'onCollapseAll' },
];

/**
 * 创建左侧图标工具栏
 * @param container 侧边栏挂载容器（会被设为 40px 图标栏并清空旧内容）
 * @param handlers 图标按钮的点击处理器
 * @returns 可复用对象：dispose 取消状态订阅并清空容器
 */
export function createSidebar(
  container: HTMLElement,
  handlers: SidebarHandlers
): { dispose: () => void } {
  let disposed = false;
  /** 「我的分支」按钮引用（激活态/禁用态同步目标） */
  let myBranchesBtn: HTMLElement | null = null;
  /** 收起/展开按钮引用（title 与图标随面板显隐切换） */
  let toggleBtn: HTMLElement | null = null;

  container.className = SIDEBAR_CLASS;
  container.innerHTML = '';

  for (const item of ITEMS) {
    const isToggle = item.handler === 'onToggleBranchPanel';
    const title = isToggle ? buildToggleTitle() : t(item.titleKey);

    const btn = html`
      <div data-sidebar="${item.key}" class="${BUTTON_CLASS}" title="${title}">
        ${raw(isToggle ? buildToggleIcon() : (item.customSvg ?? getIcon(item.icon)))}
      </div>
    `;

    // 记录按钮的初始 SVG，切换禁用态时需要还原/置灰
    btn.dataset.baseSvg = btn.innerHTML;
    // 统一初始态：未激活、可用、透明背景（激活态由 applyButtonState 设置）
    btn.dataset.active = 'false';
    btn.dataset.disabled = 'false';
    btn.classList.remove('gm-sidebar-btn-hover', 'gm-sidebar-btn-active');

    // hover 高亮：激活态保持激活底色，其余用 hover 色
    btn.addEventListener('mouseenter', () => {
      if (btn.dataset.disabled === 'true') return;
      btn.classList.toggle('gm-sidebar-btn-hover', btn.dataset.active !== 'true');
    });
    btn.addEventListener('mouseleave', () => {
      btn.classList.remove('gm-sidebar-btn-hover');
    });

    btn.addEventListener('click', (e) => {
      if (disposed) return;
      // 禁用态不响应点击（对齐 IDEA 动作被置灰后不可触发）
      if (btn.dataset.disabled === 'true') return;
      if (item.handler === 'onSettings') {
        handlers.onSettings(e);
      } else {
        (handlers[item.handler] as () => void)();
      }
    });

    if (item.key === 'search') myBranchesBtn = btn;
    if (isToggle) toggleBtn = btn;
    container.appendChild(btn);
  }

  /**
   * 刷新按钮的激活态与禁用态
   * 激活态：背景高亮（对齐 IDEA ToggleAction 选中效果）
   * 禁用态：图标变灰、光标不可点、title 提示不可用原因
   * @param btn 目标按钮
   * @param active 是否激活
   * @param enabled 是否可用
   * @param disabledTitle 禁用时的提示文案
   */
  const applyButtonState = (
    btn: HTMLElement,
    active: boolean,
    enabled: boolean,
    disabledTitle: string,
  ): void => {
    btn.dataset.active = active ? 'true' : 'false';
    btn.dataset.disabled = enabled ? 'false' : 'true';
    btn.classList.toggle('gm-sidebar-btn-active', active);
    btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    btn.style.opacity = enabled ? '1' : '0.45';
    if (!enabled) {
      btn.title = disabledTitle;
    } else {
      btn.title = active ? t('sidebar.showMyBranchesOn') : t('sidebar.showMyBranches');
    }
  };

  /**
   * 同步「我的分支」按钮状态
   * 无本地分支时禁用（没有可筛选对象）
   */
  const syncMyBranchesButton = (): void => {
    if (!myBranchesBtn) return;
    const state = getState();
    const hasLocal = state.branches.some(b => !b.isRemote);
    applyButtonState(
      myBranchesBtn,
      state.showOnlyMyBranches,
      hasLocal,
      t('sidebar.myBranchesUnavailable'),
    );
    // 激活态图标仍使用原图标，只改变背景与可点击性
    myBranchesBtn.innerHTML = myBranchesBtn.dataset.baseSvg ?? myBranchesBtn.innerHTML;
  };

  syncMyBranchesButton();

  /**
   * 各按钮的可用性判定与禁用原因（对齐 IDEA 对应动作的 update 方法）
   * @param key 按钮 key
   * @returns 禁用原因文案，或 null 表示可用
   */
  const disabledReasonOf = (key: string): string | null => {
    const state = getState();
    const localBranches = state.branches.filter(b => !b.isRemote);
    const hasRemote = state.branches.some(b => b.isRemote);
    const selected = state.selectedBranch;
    switch (key) {
      case 'newBranch':
        return localBranches.length === 0 ? t('sidebar.newBranchUnavailable') : null;
      case 'refresh':
        return hasRemote ? null : t('sidebar.updateUnavailable');
      case 'fetch':
        // 进行中禁用（防重入）；未配置远程时禁用
        if (state.fetching) return t('sidebar.fetchInProgress');
        return hasRemote ? null : t('sidebar.updateUnavailable');
      case 'locate':
        // 定位：需要选中分支
        return selected ? null : t('branch.selectBranch');
      case 'collapseAll':
        // 折叠全部：没有任何分支时无需折叠
        return state.branches.length === 0 ? t('sidebar.expandAllUnavailable') : null;
      case 'delete':
        if (!selected) return t('branch.selectBranch');
        if (selected.isCurrent) return t('branch.deleteCurrent');
        if (selected.isRemote) return t('sidebar.deleteRemoteUnavailable');
        return null;
      case 'compare':
        if (state.selectedBranches.size === 2) return null;
        if (!selected) return t('compare.selectBranch');
        if (selected.isCurrent) return t('compare.currentBranch');
        return null;
      case 'favorite':
        return selected ? null : t('branch.selectBranch');
      case 'expandAll':
        return state.branches.length === 0 ? t('sidebar.expandAllUnavailable') : null;
      default:
        return null;
    }
  };

  /** 按钮引用（key → 元素），供可用性同步遍历 */
  const buttonRefs = new Map<string, HTMLElement>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('[data-sidebar]'))) {
    const key = el.dataset.sidebar;
    if (key) buttonRefs.set(key, el);
  }

  /**
   * 同步全部按钮的可用状态（置灰 + 不可点击 + 禁用原因提示）
   * 「我的分支」按钮由自身条件控制，此处跳过，避免覆盖其激活背景
   */
  const syncButtonAvailability = (): void => {
    for (const [key, btn] of buttonRefs) {
      if (key === 'search') continue;
      const reason = disabledReasonOf(key);
      const enabled = reason === null;
      btn.dataset.disabled = enabled ? 'false' : 'true';
      btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
      btn.style.opacity = enabled ? '1' : '0.45';
      const item = ITEMS.find(i => i.key === key);
      if (enabled) {
        btn.title = t(item!.titleKey);
      } else {
        btn.title = reason;
      }
    }
    syncFavoriteIcon();
  };

  /**
   * 同步收藏按钮图标：选中项已全部收藏显示实心星，否则显示空心星
   * 多选时与批量切换语义一致（全部已收藏才算「已收藏」）
   */
  const syncFavoriteIcon = (): void => {
    const btn = buttonRefs.get('favorite');
    if (!btn) return;
    const state = getState();
    const selected = state.selectedBranches.size > 0
      ? [...state.selectedBranches]
      : (state.selectedBranch ? [state.selectedBranch.name] : []);
    const allFavorited = selected.length > 0 && selected.every(name => state.favorites.has(name));
    btn.innerHTML = allFavorited ? getIcon('favorite') : getIcon('favoriteOutline');
    // 图标随状态切换，禁用态还原时也要用当前图标
    btn.dataset.baseSvg = btn.innerHTML;
  };

  syncButtonAvailability();

  // 收起/展开按钮的 title 与图标跟随面板显隐变化
  const unsubscribeToggle = subscribeFields(['branchPanelHidden'], () => {
    if (disposed || !toggleBtn) return;
    toggleBtn.title = buildToggleTitle();
    toggleBtn.innerHTML = buildToggleIcon();
    toggleBtn.dataset.baseSvg = toggleBtn.innerHTML;
  });

  // 「我的分支」激活态与全部按钮可用性跟随状态变化
  const unsubscribeMine = subscribeFields(
    ['showOnlyMyBranches', 'branches', 'selectedBranch', 'selectedBranches', 'favorites', 'fetching'],
    () => {
      if (disposed) return;
      syncMyBranchesButton();
      syncButtonAvailability();
    },
  );

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribeToggle();
    unsubscribeMine();
    container.innerHTML = '';
    myBranchesBtn = null;
    toggleBtn = null;
  };

  return { dispose };
}
