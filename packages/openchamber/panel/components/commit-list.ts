/**
 * 提交列表组件
 * 布局参考 IntelliJ 提交历史区域
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ [🔍 文本或哈希] [.*] [Cc] | [分支▼] [用户▼] [日期▼] [路径▼] | [↓] [↻] [⇄] [🔍] [⚙] │
 * │─────────────────────────────────────────────────────────────│
 * │ ● refactor: 使用事件委托重构组件事件绑定    dev  今天 08:06  天火流光 │
 * │ ● fix: 修复 getDirectory 不存在的错误       local  今天 08:01  天火流光 │
 * └─────────────────────────────────────────────────────────────┘
 */

import { html, raw } from '../html';
import {
  getState,
  setState,
  subscribeFields,
  subscribeState,
  CommitInfo,
  PanelState,
} from '../state';
import { ServiceClient } from '../service';
import { t, getLang } from '../i18n';
import { showCommitContextMenu } from './context-menu';
import { showSettingsMenu } from './settings-menu';
import { showGotoDialog, showDateRangeDialog, showPathFilterDialog, showPathTreeDialog } from './dialogs';
import { showDropdownMenu } from './dropdown-menu';
import type { DropdownMenuItem } from './dropdown-menu';
import { host } from '../host';
import { showOperationError } from './errors';
import { getIcon } from '../icons';
import { mountBadge, mountSearchField } from '@openchamber/sdk/ui';
import type {
  BadgeHandle,
  SearchFieldHandle,
} from '@openchamber/sdk/ui';

/** 按钮式触发选择下拉使用的空值选项标识（全部/不过滤） */
const ALL_OPTION_ID = 'all';

/** 提交行引用徽标 handle 列表（renderList 重建前与组件 dispose 时统一释放） */
const badgeHandles: BadgeHandle[] = [];

export function createCommitListPanel(
  container: HTMLElement,
  service: ServiceClient,
  directory: string,
  onCommitSelect: (commit: CommitInfo) => void
): { dispose: () => void } {
  let disposed = false;
  let listContainer: HTMLElement | null = null;
  let toolbar: HTMLElement | null = null;
  let filterTag: HTMLElement | null = null;
  let unsubscribe: (() => void) | null = null;
  /** displaySettings 按值比较的订阅（settings-menu 原地改对象，引用不变） */
  let unsubscribeDisplay: (() => void) | null = null;
  /** Shift 范围选锚点（组件内 UI 状态，不入全局 store） */
  let lastClickIndex: number | null = null;
  /** 工具栏 6 个过滤按钮引用缓存（toolbar 构建时写入，供激活态刷新复用，避免重复查询 DOM） */
  let filterBtnRefs: {
    regex: HTMLElement | null;
    caseSensitive: HTMLElement | null;
    branch: HTMLElement | null;
    user: HTMLElement | null;
    date: HTMLElement | null;
    path: HTMLElement | null;
  } = { regex: null, caseSensitive: null, branch: null, user: null, date: null, path: null };
  /** SDK UI Kit 搜索框 handle（提交搜索）：render 重建前与组件 dispose 时统一释放 */
  let searchHandle: SearchFieldHandle | null = null;

  const findCommitFromEvent = (e: Event): CommitInfo | null => {
    const target = e.target as HTMLElement;
    const item = target.closest('[data-hash]');
    if (!item) return null;
    const hash = item.getAttribute('data-hash');
    if (!hash) return null;
    const state = getState();
    return state.filteredCommits.find(c => c.hash === hash) || null;
  };

  /**
   * 拉取远端更新：成功后复用既有刷新逻辑，失败输出结构化错误日志
   */
  
  /**
   * 与本地比较：取当前单选提交的差异写入 state.diffs
   * 无选中提交时输出结构化日志并不发起请求
   */
  
  /**
   * 聚焦工具栏搜索框
   * 搜索框为 Kit mountSearchField，聚焦其内部 .oc-sdk-input
   */
  
  /**
   * 在列表容器内滚动到指定提交行
   * 环境未实现 scrollIntoView（如 jsdom）时降级为按行偏移滚动容器
   * @param hash 提交哈希，空值不处理
   */
  const scrollToRow = (hash?: string): void => {
    if (!hash) return;
    const target = container.querySelector<HTMLElement>(`[data-hash="${hash}"]`);
    if (!target) return;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest' });
    } else {
      container.scrollTop = target.offsetTop;
    }
  };

  /**
   * "跳转到引用"对话框的提交逻辑（返回 true 关闭对话框，false 显示未找到提示）
   * 1. 哈希前缀命中（大小写不敏感）→ 单选该提交并滚动定位
   * 2. 分支名精确命中 → 写入 logBranch 触发既有分支过滤并选中该分支首条提交
   * @param query 去除首尾空白后的查询串
   * @returns 是否命中
   */
  const gotoReference = (query: string): boolean => {
    const state = getState();
    const keyword = query.toLowerCase();

    // 1. 哈希前缀匹配
    const hitCommit = state.allCommits.find(c => c.hash.toLowerCase().startsWith(keyword));
    if (hitCommit) {
      setState(s => {
        s.selectedCommit = hitCommit;
        s.selectedCommits = new Set([hitCommit.hash]);
      });
      onCommitSelect(hitCommit);
      scrollToRow(hitCommit.hash);
      console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'goto_commit', hash: hitCommit.hash }));
      return true;
    }

    // 2. 分支名精确匹配
    const hitBranch = state.branches.find(b => b.name === query);
    if (hitBranch) {
      // 分支 commit 为短哈希，提交为完整哈希：用前缀匹配，避免永远匹配不上
      const branchCommit =
        (hitBranch.commit
          ? state.allCommits.find(c => c.hash.startsWith(hitBranch.commit as string))
          : undefined)
        ?? state.filteredCommits[0]
        ?? state.allCommits[0]
        ?? null;
      setState(s => {
        s.logBranch = hitBranch.name; // 触发既有分支过滤（数据侧按分支加载，UI 状态由分支面板高亮承载）
        if (branchCommit) {
          s.selectedCommit = branchCommit;
          s.selectedCommits = new Set([branchCommit.hash]);
        }
      });
      if (branchCommit) onCommitSelect(branchCommit);
      scrollToRow(branchCommit?.hash);
      console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'goto_branch', branchName: hitBranch.name }));
      return true;
    }

    // 3. 未命中
    console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'goto_not_found', query }));
    return false;
  };

  /**
   * 按当前状态刷新工具栏过滤按钮的激活样式（6 个自绘按钮：正则/大小写/分支/用户/日期/路径）
   * 激活/未激活视觉由 __styles__/commit-list.css 的
   * .gm-commit-filter-btn(.gm-commit-filter-btn-active) 承担
   * 映射：btn-regex ← searchRegex；btn-case ← searchCaseSensitive；
   * filter-branch ← logBranch 非空；filter-user ← filterAuthor 非空；
   * btn-filter-date ← filterDateFrom/filterDateTo 任一非空；
   * btn-filter-path ← filterPaths 非空（多选路径数组，空数组 = 不过滤）
   * 触发时机：toolbar 构建后一次 + subscribeFields 订阅回调（仅关注字段变化时执行）
   */
  const updateFilterButtons = (): void => {
    const state = getState();
    const activeFlags: Array<[HTMLElement | null, boolean]> = [
      [filterBtnRefs.regex, state.searchRegex],
      [filterBtnRefs.caseSensitive, state.searchCaseSensitive],
      [filterBtnRefs.branch, !!state.logBranch],
      [filterBtnRefs.user, !!state.filterAuthor],
      [filterBtnRefs.date, !!(state.filterDateFrom || state.filterDateTo)],
      [filterBtnRefs.path, state.filterPaths.length > 0],
    ];
    for (const [btn, active] of activeFlags) {
      if (!btn) continue;
      btn.classList.toggle('gm-commit-filter-btn-active', active);
    }
  };

  const render = () => {
    if (disposed) return;
    container.innerHTML = '';

    // 搜索过滤工具栏 (IntelliJ 完整风格)
    // 分支/用户过滤改为 SDK UI Kit 的 mountSelect（单选下拉）；日期/路径仍为自绘 dropdown-menu。
    // 搜索框改用 Kit mountSearchField。右侧四个图标按钮保持自绘 button+getIcon：
    // mountButton 仅支持文本 label、无图标插槽，图标型按钮用 Kit 会退化为空白，故保留自绘。
    toolbar = html`
      <div class="gm-commit-toolbar">
        <!-- 搜索输入框（Kit mountSearchField 容器） -->
        <div data-action="search-box" class="gm-commit-search-slot"></div>
        <!-- 正则/大小写按钮 -->
        <button data-action="btn-regex" class="gm-commit-filter-btn gm-commit-filter-btn-mono" title="${t('filter.regex')}">.*</button>
        <button data-action="btn-case" class="gm-commit-filter-btn gm-commit-filter-btn-bold" title="${t('filter.case')}">Cc</button>
        <!-- 分隔线 -->
        <div class="gm-commit-toolbar-sep"></div>
        <!-- 分支/用户过滤下拉（自绘 dropdown-menu，与日期/路径一致） -->
        <button data-action="filter-branch" class="gm-commit-filter-btn gm-commit-filter-btn-menu"><span class="gm-filter-btn-value"></span> ▾</button>
        <button data-action="filter-user" class="gm-commit-filter-btn gm-commit-filter-btn-menu"><span class="gm-filter-btn-value"></span> ▾</button>
        <!-- 日期/路径仍为自绘 dropdown-menu（日期含自定义对话框，路径为多选勾选） -->
        <button data-action="btn-filter-date" class="gm-commit-filter-btn gm-commit-filter-btn-menu">${t('filter.date')} ▾</button>
        <button data-action="btn-filter-path" class="gm-commit-filter-btn gm-commit-filter-btn-menu">${t('filter.path')} ▾</button>
        <!-- 分隔线 -->
        <div class="gm-commit-toolbar-sep"></div>
        <!-- 右侧角：刷新 / Cherry-pick / 视图选项 / 搜索（自绘图标按钮） -->
        <button data-action="btn-refresh" class="gm-commit-toolbar-btn" title="${t('sidebar.refresh')}">${raw(getIcon('refresh'))}</button>
        <button data-action="btn-cherry-pick" class="gm-commit-toolbar-btn" title="${t('commit.cherryPick')}">${raw(getIcon('cherryPick'))}</button>
        <button data-action="btn-settings" class="gm-commit-toolbar-btn" title="${t('settings.title')}">${raw(getIcon('gearSettings'))}</button>
        <button data-action="btn-goto" class="gm-commit-toolbar-btn" title="${t('goto.title')}">${raw(getIcon('search'))}</button>
      </div>
    `;

    // 挂载搜索框（Kit mountSearchField），重建前先释放旧 handle
    searchHandle?.dispose();
    searchHandle = mountSearchField(toolbar.querySelector<HTMLElement>('[data-action="search-box"]')!, {
      value: getState().commitSearch,
      placeholder: t('commit.searchPlaceholder'),
      onChange: (value) => {
        setState(s => { s.commitSearch = value; });
        // 订阅回调会触发 filterCommits，filterCommits 更新 filteredCommits 后再触发 renderList
      },
    });

    /**
     * Cherry-pick 选中提交到当前分支
     * 多选时按列表由旧到新依次挑选；未选中时提示用户先选择提交
     */
    const handleCherryPick = async (): Promise<void> => {
      const state = getState();
      const hashes = state.selectedCommits.size > 0
        ? state.filteredCommits.filter(c => state.selectedCommits.has(c.hash)).map(c => c.hash).reverse()
        : (state.selectedCommit ? [state.selectedCommit.hash] : []);
      if (hashes.length === 0) {
        console.error(JSON.stringify({ prefix: '[commit-list]', event: 'cherry_pick_no_selection' }));
        // 必须给出可见提示，否则用户点图标后表现为「没反应」
        void host.toast({ kind: 'error', message: t('commit.cherryPickNoSelection') }).catch((toastErr) => {
          console.error(JSON.stringify({ prefix: '[commit-list]', event: 'cherry_pick_toast_error', error: String(toastErr) }));
        });
        return;
      }
      console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'cherry_pick_start', count: hashes.length, hashes }));
      try {
        for (const hash of hashes) {
          await service.cherryPick(directory, hash);
        }
        await refreshCommits(service, directory);
        console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'cherry_pick_done', count: hashes.length }));
        void host.toast({
          kind: 'success',
          message: hashes.length > 1
            ? t('commit.cherryPickDoneMulti', { n: hashes.length })
            : t('commit.cherryPickDone', { hash: hashes[0]!.slice(0, 7) }),
        }).catch(() => {});
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(JSON.stringify({
          prefix: '[commit-list]',
          event: 'cherry_pick_error',
          hashes,
          error: message,
        }));
        // 冲突等原因导致的失败同样要让用户看到，并保留原文可复制
        void host.toast({
          kind: 'error',
          message: `${t('commit.cherryPickFailed')}: ${message}`,
          copy: true,
          dismiss: true,
        }).catch((toastErr) => {
          console.error(JSON.stringify({ prefix: '[commit-list]', event: 'cherry_pick_toast_error', error: String(toastErr) }));
        });
      }
    };

    // 右侧四个图标按钮走事件委托（自绘 button+getIcon），与过滤按钮同一入口
    toolbar.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]');
      if (!target) return;
      const action = target.getAttribute('data-action');
      if (action === 'btn-regex') toggleRegex();
      else if (action === 'btn-case') toggleCase();
      else if (action === 'filter-branch') openBranchDropdown(target as HTMLElement);
      else if (action === 'filter-user') openUserDropdown(target as HTMLElement);
      else if (action === 'btn-filter-date') openDateDropdown(target as HTMLElement);
      else if (action === 'btn-filter-path') openPathDropdown(target as HTMLElement);
      else if (action === 'btn-refresh') void refreshCommits(service, directory);
      else if (action === 'btn-cherry-pick') void handleCherryPick();
      else if (action === 'btn-settings') showSettingsMenu(e as MouseEvent);
      else if (action === 'btn-goto') showGotoDialog(gotoReference);
    });

    container.appendChild(toolbar);
    // 缓存过滤按钮引用并按当前状态刷新激活样式（后续由订阅驱动）
    filterBtnRefs = {
      regex: toolbar.querySelector<HTMLElement>('[data-action="btn-regex"]'),
      caseSensitive: toolbar.querySelector<HTMLElement>('[data-action="btn-case"]'),
      branch: toolbar.querySelector<HTMLElement>('[data-action="filter-branch"]'),
      user: toolbar.querySelector<HTMLElement>('[data-action="filter-user"]'),
      date: toolbar.querySelector<HTMLElement>('[data-action="btn-filter-date"]'),
      path: toolbar.querySelector<HTMLElement>('[data-action="btn-filter-path"]'),
    };
    updateFilterButtons();
    // 分支/用户按钮文案（当前选中值）+ 分支过滤标签单独更新，不随工具栏整体重建
    updateFilterButtonLabels();
    renderFilterTag();

    // 提交列表
    listContainer = html`
      <div tabindex="0" class="gm-commit-list"></div>
    `;

    // Ctrl/Cmd+A 全选提交（列表获得焦点时生效，对齐 IDEA）
    listContainer.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const all = getState().filteredCommits.map(c => c.hash);
        setState(s => { s.selectedCommits = new Set(all); });
        console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'select_all', count: all.length }));
      }
    });

    // 鼠标拖拽连续选中：按下记录锚点，移动时按范围更新选择
    let dragging = false;
    let dragStartIndex = -1;
    listContainer.addEventListener('mousedown', (e) => {
      // 仅左键且点在提交行上时启动拖拽
      if (e.button !== 0) return;
      const commit = findCommitFromEvent(e);
      if (!commit) return;
      const idx = getState().filteredCommits.findIndex(c => c.hash === commit.hash);
      if (idx < 0) return;
      dragging = true;
      dragStartIndex = idx;
      // 聚焦列表以支持 Ctrl+A 等键盘操作
      listContainer?.focus();
    });
    listContainer.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const commit = findCommitFromEvent(e);
      if (!commit) return;
      const idx = getState().filteredCommits.findIndex(c => c.hash === commit.hash);
      if (idx < 0) return;
      const start = Math.min(dragStartIndex, idx);
      const end = Math.max(dragStartIndex, idx);
      const range = getState().filteredCommits.slice(start, end + 1).map(c => c.hash);
      setState(s => {
        // 拖拽期间整体替换选集，保持与鼠标划过的范围一致
        if (s.selectedCommits.size === range.length && range.every(h => s.selectedCommits.has(h))) return;
        s.selectedCommits = new Set(range);
      });
    });
    // 松开鼠标与移出容器都结束拖拽
    const endDrag = () => { dragging = false; dragStartIndex = -1; };
    listContainer.addEventListener('mouseup', endDrag);
    listContainer.addEventListener('mouseleave', endDrag);
    window.addEventListener('mouseup', endDrag);

    listContainer.addEventListener('mouseenter', (e) => {
      const target = (e.target as HTMLElement).closest('[data-hash]');
      if (target) (target as HTMLElement).classList.add('gm-commit-row-hover');
    }, true);

    listContainer.addEventListener('mouseleave', (e) => {
      const target = (e.target as HTMLElement).closest('[data-hash]');
      if (target) {
        const state = getState();
        const hash = target.getAttribute('data-hash');
        const isSelected = hash !== null &&
          (state.selectedCommits.has(hash) || state.selectedCommit?.hash === hash);
        const row = target as HTMLElement;
        row.classList.remove('gm-commit-row-hover');
        row.classList.toggle('gm-commit-row-selected', isSelected);
      }
    }, true);

    listContainer.addEventListener('click', (e) => {
      const commit = findCommitFromEvent(e);
      if (!commit) return;
      const state = getState();
      const idx = state.filteredCommits.findIndex(c => c.hash === commit.hash);

      if (e.shiftKey && lastClickIndex !== null && idx >= 0) {
        // Shift 范围选：从锚点到当前行（保持锚点以便继续扩展）
        const start = Math.min(lastClickIndex, idx);
        const end = Math.max(lastClickIndex, idx);
        const range = state.filteredCommits.slice(start, end + 1).map(c => c.hash);
        setState(s => {
          s.selectedCommits = new Set(range);
          s.selectedCommit = commit;
        });
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd 切换单条
        const next = new Set(state.selectedCommits);
        if (next.has(commit.hash)) {
          next.delete(commit.hash);
        } else {
          next.add(commit.hash);
        }
        setState(s => {
          s.selectedCommits = next;
          s.selectedCommit = commit;
        });
        lastClickIndex = idx >= 0 ? idx : null;
      } else {
        // 普通单击：清空多选，仅选中该条
        setState(s => {
          s.selectedCommits = new Set([commit.hash]);
          s.selectedCommit = commit;
        });
        lastClickIndex = idx >= 0 ? idx : null;
      }
      onCommitSelect(commit);
    });

    listContainer.addEventListener('contextmenu', (e) => {
      const commit = findCommitFromEvent(e);
      if (!commit) return;
      e.preventDefault();
      const state = getState();
      // 右键目标在多选集合内且选中数 > 1 → 批量菜单（按列表旧→新顺序）
      let batch: string[] | undefined;
      if (state.selectedCommits.size > 1 && state.selectedCommits.has(commit.hash)) {
        batch = state.filteredCommits
          .filter(c => state.selectedCommits.has(c.hash))
          .map(c => c.hash)
          .reverse();
      }

      // 先查工作区是否干净，再弹菜单：不干净时编辑信息/删除提交等改写历史的项直接置灰
      // （对齐 IDEA 的禁用策略），避免用户点击后才看到 git 报错。
      // 菜单定位只用坐标，故异步回调里构造仅含坐标的最小事件对象即可
      const { clientX, clientY } = e;
      void service.isWorkingTreeClean(directory)
        .catch(() => false)
        .then((clean) => {
          const anchor = { clientX, clientY } as MouseEvent;
          showCommitContextMenu(anchor, commit, service, directory, batch, !clean);
        });
    });

    container.appendChild(listContainer);
    renderList();

    // 订阅状态字段，变化时局部渲染
    if (unsubscribe) unsubscribe();
    unsubscribe = subscribeFields(
      [
        'filteredCommits',
        'allCommits',
        'branches',
        'logBranch',
        'selectedCommit',
        'selectedCommits',
        'commitSearch',
        'sortMode',
        'filterAuthor',
        'filterDateFrom',
        'filterDateTo',
        // filterPaths 按引用比较即内容变化：所有写入方均为整体替换新数组（从不原地变异），
        // 对话框应用另有深比较守卫阻止"同内容新引用"写入，故引用不同 = 内容确实变化
        'filterPaths',
        'searchRegex',
        'searchCaseSensitive',
      ],
      (changed) => {
        if (disposed) return;
        console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'sub_changed', changed }));
        // 过滤按钮激活态随关注字段变化刷新（无关字段不进入本回调，不触发重绘）
        updateFilterButtons();
        // 分支/用户过滤按钮文案（当前选中值）随 state 同步
        if (
          changed.includes('logBranch') ||
          changed.includes('filterAuthor') ||
          changed.includes('branches') ||
          changed.includes('allCommits')
        ) {
          updateFilterButtonLabels();
        }
        // 搜索模式开关（外部直接 setState 场景）→ 重算过滤；点击按钮场景由 toggle 显式调用，管道幂等
        if (changed.includes('searchRegex') || changed.includes('searchCaseSensitive')) {
          filterCommits();
        }
        if (changed.includes('logBranch')) {
          lastClickIndex = null; // 分支过滤切换后锚点失效
        }
        // sortMode 影响工具栏标签容器；logBranch 仍触发一次刷新以移除可能残留的容器（分支标签已移除）
        if (changed.includes('logBranch') || changed.includes('sortMode')) {
          renderFilterTag();
        }
        // commitSearch 变化 → 重新计算 filteredCommits（会再次触发订阅，由 filteredCommits 分支渲染列表）
        if (changed.includes('commitSearch')) {
          filterCommits();
          return;
        }
        // sortMode 变化 → 走完整过滤管道重算（default 恢复原序，其余按模式排序）
        if (changed.includes('sortMode')) {
          console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'sort_changed', sortMode: getState().sortMode }));
          filterCommits();
          return;
        }
        if (
          changed.includes('filteredCommits') ||
          changed.includes('branches') ||
          changed.includes('selectedCommit') ||
          changed.includes('selectedCommits')
        ) {
          // 兜底：外部直接写入未排序列表（如 main.ts 数据加载）时按当前排序模式重排一次
          const current = getState();
          if (
            changed.includes('filteredCommits') &&
            current.sortMode !== 'default' &&
            !isSortedCommits(current.filteredCommits, current.sortMode)
          ) {
            console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'sort_realign', sortMode: current.sortMode }));
            setState(s => { s.filteredCommits = sortCommits(s.filteredCommits, s.sortMode); });
            return;
          }
          console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'render_list', count: getState().filteredCommits.length }));
          renderList();
        }
      }
    );

    // displaySettings 由 settings-menu 原地修改（引用不变），单独按值订阅
    if (unsubscribeDisplay) unsubscribeDisplay();
    let prevDisplay = { ...getState().displaySettings };
    unsubscribeDisplay = subscribeState(() => {
      const settings = getState().displaySettings;
      // 逐字段比较：displaySettings 可能被整体替换，用引用比较会漏掉原地修改
      const changed = (Object.keys(settings) as Array<keyof typeof settings>)
        .some(k => settings[k] !== prevDisplay[k]);
      if (!changed) return;
      prevDisplay = { ...settings };
      if (disposed) return;
      console.debug(JSON.stringify({ prefix: '[commit-list]', event: 'display_changed', settings: prevDisplay }));
      renderList();
    });
  };

  /**
   * 仅更新工具栏过滤标签容器。
   * 分支过滤标签已移除（对齐 IntelliJ IDEA：无分支胶囊，过滤状态由分支面板选中高亮承载，
   * 清除入口为分支面板点击空白取消选中），容器仅在存在非默认排序模式时承载排序标签。
   */
  const renderFilterTag = () => {
    if (!toolbar) return;
    if (filterTag) {
      filterTag.remove();
      filterTag = null;
    }
    const state = getState();
    const hasSort = state.sortMode !== 'default';
    if (!hasSort) return;

    /** 排序模式 → 标签文案 i18n key */
    const sortLabelKey: Record<string, string> = {
      'date-asc': 'sort.dateAsc',
      'author-asc': 'sort.authorAsc',
      'message-asc': 'sort.messageAsc',
    };

    const sortTag = html`
      <span class="gm-commit-sort-tag">
        <span class="gm-commit-sort-tag-text">${t(sortLabelKey[state.sortMode])}</span>
        <span data-action="btn-clear-sort" class="gm-commit-sort-tag-close">×</span>
      </span>
    `;

    filterTag = html`
      <span class="gm-commit-filter-tag">
        ${sortTag}
      </span>
    `;
    filterTag.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]');
      if (!target) return;
      const action = target.getAttribute('data-action');
      if (action === 'btn-clear-sort') setState(s => { s.sortMode = 'default'; });
    });
    toolbar.appendChild(filterTag);
  };

  /**
   * 构造分支过滤下拉条目（全部 + 分支名，分组信息降级为 hint 前缀）
   * 收藏优先、其余按远程/本地排序，同组内保持原顺序；当前选中项 checked
   */
  const buildBranchItems = (): DropdownMenuItem[] => {
    const state = getState();
    const current = state.logBranch ?? ALL_OPTION_ID;
    const isFav = (b: { isCurrent: boolean; name: string }): boolean =>
      !b.isCurrent && state.favorites.has(b.name);
    const hintOf = (b: { isCurrent: boolean; name: string; isRemote: boolean }): string =>
      isFav(b) ? t('filter.favorites') : b.isRemote ? t('filter.remoteBranches') : t('filter.localBranches');
    const ordered = [...state.branches].sort((a, b) => Number(isFav(b)) - Number(isFav(a)));
    const items: DropdownMenuItem[] = [{ id: ALL_OPTION_ID, label: t('filter.all'), checked: current === ALL_OPTION_ID }];
    for (const b of ordered) {
      items.push({ id: b.name, label: `${b.name} (${hintOf(b)})`, checked: current === b.name });
    }
    return items;
  };

  /**
   * 构造用户（作者）过滤下拉条目（全部 + allCommits 去重排序作者名）；当前选中项 checked
   */
  const buildUserItems = (): DropdownMenuItem[] => {
    const state = getState();
    const current = state.filterAuthor || ALL_OPTION_ID;
    const authors = [...new Set(state.allCommits.map(c => c.authorName))].sort();
    const items: DropdownMenuItem[] = [{ id: ALL_OPTION_ID, label: t('filter.all'), checked: current === ALL_OPTION_ID }];
    for (const name of authors) {
      items.push({ id: name, label: name, checked: current === name });
    }
    return items;
  };

  /**
   * 刷新分支/用户过滤按钮的文案（当前选中值，未选时显示“全部”）
   * 与日期/路径同为自绘 dropdown-menu 触发按钮，文案由当前状态驱动
   */
  const updateFilterButtonLabels = (): void => {
    const state = getState();
    const branchValue = filterBtnRefs.branch?.querySelector('.gm-filter-btn-value');
    const userValue = filterBtnRefs.user?.querySelector('.gm-filter-btn-value');
    if (branchValue) branchValue.textContent = state.logBranch || t('filter.all');
    if (userValue) userValue.textContent = state.filterAuthor || t('filter.all');
  };

  /**
   * 打开分支过滤下拉菜单（自绘 dropdown-menu，与日期/路径一致）
   * 分组规则复用 branch-panel：收藏 = 非当前分支且在 favorites 中；
   * 本地 = 非远程且非收藏（含当前分支），远程 = 远程且非收藏，以 hint 前缀降级表达。
   * 选中 → setState(logBranch/selectedBranch) 并清空多选后按分支重新拉取提交；
   * 选“全部”（ALL_OPTION_ID）→ 清空分支过滤状态后按全量拉取。
   * @param anchor 触发按钮（再次点击同一按钮由 showDropdownMenu 做 toggle 关闭）
   */
  const openBranchDropdown = (anchor: HTMLElement): void => {
    showDropdownMenu(anchor, buildBranchItems(), (id) => {
      console.debug(JSON.stringify({
        prefix: '[commit-list]',
        event: 'branch_dropdown_select',
        branch: id === ALL_OPTION_ID ? null : id,
      }));
      if (id === ALL_OPTION_ID) {
        setState(s => {
          s.logBranch = null;
          s.selectedBranch = null;
          s.selectedCommits = new Set<string>();
        });
      } else {
        const branch = getState().branches.find(b => b.name === id) ?? null;
        setState(s => {
          s.logBranch = id;
          s.selectedBranch = branch;
          s.selectedCommits = new Set<string>();
        });
      }
      updateFilterButtonLabels();
      // 按新分支重新拉取提交（内部会带 logBranch 调 getLog 并重跑过滤管道）
      void refreshCommits(service, directory);
    });
  };

  /**
   * 打开用户（作者）过滤下拉菜单（自绘 dropdown-menu，与日期/路径一致）
   * 条目 = “全部” + allCommits 中去重排序后的作者名（无提交时仅“全部”）
   * 选中 → setState(filterAuthor) 后立即重跑过滤管道（数据不重新拉取）
   * @param anchor 触发按钮
   */
  const openUserDropdown = (anchor: HTMLElement): void => {
    showDropdownMenu(anchor, buildUserItems(), (id) => {
      const author = id === ALL_OPTION_ID ? '' : id;
      console.debug(JSON.stringify({
        prefix: '[commit-list]',
        event: 'user_dropdown_select',
        author,
      }));
      setState(s => { s.filterAuthor = author; });
      updateFilterButtonLabels();
      filterCommits();
    });
  };

  /**
   * 打开日期过滤下拉菜单
   * 预设 checked 通过 computeDateRange 重算各预设区间后与当前状态全等比较（不反推预设）；
   * 自定义项打开 showDateRangeDialog，回调结果写入状态后重跑过滤
   * @param anchor 触发按钮
   */
  const openDateDropdown = (anchor: HTMLElement): void => {
    const state = getState();
    const now = new Date();
    const presets = ['today', 'thisWeek', 'thisMonth', 'thisYear'] as const;
    /** 预设 → i18n key */
    const presetLabelKey: Record<(typeof presets)[number], string> = {
      today: 'filter.today',
      thisWeek: 'filter.thisWeek',
      thisMonth: 'filter.thisMonth',
      thisYear: 'filter.thisYear',
    };

    const items: DropdownMenuItem[] = [
      {
        id: 'all',
        label: t('filter.all'),
        checked: state.filterDateFrom === '' && state.filterDateTo === '',
      },
    ];
    for (const preset of presets) {
      const range = computeDateRange(preset, now);
      items.push({
        id: preset,
        label: t(presetLabelKey[preset]),
        checked: state.filterDateFrom === range.from && state.filterDateTo === range.to,
      });
    }
    items.push({ id: 'sep-date', label: '', kind: 'separator' });
    items.push({ id: 'custom', label: t('filter.custom') });

    showDropdownMenu(anchor, items, (id) => {
      console.debug(JSON.stringify({
        prefix: '[commit-list]',
        event: 'date_dropdown_select',
        preset: id,
      }));

      // 自定义 → 打开日期范围对话框，应用回调写入状态
      if (id === 'custom') {
        showDateRangeDialog((range) => {
          setState(s => {
            s.filterDateFrom = range.from;
            s.filterDateTo = range.to;
          });
          filterCommits();
        });
        return;
      }

      if (id === 'all') {
        setState(s => {
          s.filterDateFrom = '';
          s.filterDateTo = '';
        });
      } else {
        const range = computeDateRange(
          id as 'today' | 'thisWeek' | 'thisMonth' | 'thisYear',
          new Date(),
        );
        setState(s => {
          s.filterDateFrom = range.from;
          s.filterDateTo = range.to;
        });
      }
      filterCommits();
    });
  };

  /**
   * 打开路径过滤下拉菜单（对齐 IDEA Paths 弹层）
   * 条目顺序："全部"（filterPaths 为空时勾选）→ 每个已选路径一条（勾选，点击移除该条）
   * → 分隔线 → "选择文件夹…"（树勾选对话框）→ "编辑路径…"（多行编辑对话框）
   * 选"全部" → 清空 filterPaths 后按无路径参数重新拉取（空数组时点击同样无害）；
   * 选已选路径条 → 仅从数组移除该条（移除后为空数组同样重新拉取，无 path 参数 = 全量）；
   * 选"选择文件夹…"/"编辑路径…" → 应用结果与打开时快照深比较：相同仅关闭不重复请求，
   * 不同则写入新数组并重新拉取（路径为服务端过滤，不能只重跑本地管道）
   * @param anchor 触发按钮（再次点击同一按钮由 showDropdownMenu 做 toggle 关闭）
   */
  const openPathDropdown = (anchor: HTMLElement): void => {
    const current = getState().filterPaths;
    const items: DropdownMenuItem[] = [
      { id: 'all', label: t('filter.all'), checked: !current.length },
    ];
    // 每个已选路径一个条目：勾选态，点击 = 移除该单条（dropdown-menu 对 checked 条目不拦截选中回调）
    for (const path of current) {
      items.push({ id: `p:${path}`, label: path, checked: true });
    }
    items.push({ id: 'sep-path', label: '', kind: 'separator' });
    items.push({ id: 'pick', label: t('filter.chooseFolder') });
    items.push({ id: 'edit', label: t('filter.editPaths') });

    showDropdownMenu(anchor, items, (id) => {
      if (id === 'all') {
        console.debug(JSON.stringify({
          prefix: '[commit-list]',
          event: 'path_dropdown_select',
          path: [],
        }));
        setState(s => { s.filterPaths = []; });
        // 按无路径过滤重新拉取（路径为服务端过滤，不能只重跑本地管道）
        void refreshCommits(service, directory);
        return;
      }

      // 已选路径条目（p: 前缀）→ 仅移除该条，其余保留
      if (id.startsWith('p:')) {
        const path = id.slice(2);
        const next = getState().filterPaths.filter(p => p !== path);
        console.debug(JSON.stringify({
          prefix: '[commit-list]',
          event: 'path_dropdown_select',
          path: next,
        }));
        setState(s => { s.filterPaths = next; });
        // 剩余数组可能为空：仍走同一次刷新（无路径参数 = 全量）
        void refreshCommits(service, directory);
        return;
      }

      if (id === 'pick' || id === 'edit') {
        // 打开对话框时快照当前数组，应用回调与快照深比较（相同则仅关闭，不重复触发请求）
        const snapshot = [...getState().filterPaths];
        const onApply = (paths: string[]): void => {
          if (samePaths(paths, snapshot)) return;
          console.debug(JSON.stringify({
            prefix: '[commit-list]',
            event: 'path_dropdown_select',
            path: paths,
          }));
          setState(s => { s.filterPaths = [...paths]; });
          void refreshCommits(service, directory);
        };
        if (id === 'pick') {
          showPathTreeDialog(service, directory, snapshot, onApply);
        } else {
          showPathFilterDialog(snapshot, onApply);
        }
      }
    });
  };

  const renderList = () => {
    if (disposed || !listContainer) return;
    const state = getState();
    // 重建列表前释放上一轮引用徽标 handle，避免节点/监听泄漏
    disposeBadges();
    listContainer.innerHTML = '';

    const commits = state.filteredCommits;
    if (commits.length === 0) {
      listContainer.innerHTML = `<div class="gm-commit-empty">${t('commit.empty')}</div>`;
      return;
    }

    // 收集所有分支引用映射
    // 分支数据的 commit 是短哈希，提交为完整哈希：按前缀索引，避免永远匹配不上
    const branchMap = new Map<string, string[]>();
    for (const branch of state.branches) {
      if (!branch.commit) continue;
      const existing = branchMap.get(branch.commit) ?? [];
      existing.push(branch.name);
      branchMap.set(branch.commit, existing);
    }

    for (const commit of commits) {
      // 短哈希可能为 7 位，用前缀比对（提交完整哈希以分支短哈希开头）
      const branches: string[] = [];
      for (const [shortHash, names] of branchMap) {
        if (commit.hash.startsWith(shortHash)) branches.push(...names);
      }
      const item = createCommitItem(commit, branches, badgeHandles);
      listContainer.appendChild(item);
    }
  };

  const dispose = () => {
    disposed = true;
    // 释放 SDK UI Kit handle（badge/search），避免监听与节点泄漏
    searchHandle?.dispose();
    searchHandle = null;
    disposeBadges();
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubscribeDisplay) {
      unsubscribeDisplay();
      unsubscribeDisplay = null;
    }
  };

  render();
  return { dispose };
}

/**
 * 清空已挂载的引用徽标 handle（renderList 重建前与 dispose 时调用）
 */
function disposeBadges(): void {
  while (badgeHandles.length > 0) {
    badgeHandles.pop()?.dispose();
  }
}

function createCommitItem(
  commit: CommitInfo,
  branches: string[] = [],
  badgeHandles: BadgeHandle[] = [],
): HTMLElement {
  const state = getState();
  const settings = state.displaySettings;
  // 多选集合成员或单选主提交均高亮
  const isSelected = state.selectedCommits.has(commit.hash) ||
    state.selectedCommit?.hash === commit.hash;

  // 引用徽标（IntelliJ 风格彩色标签，改用 SDK UI Kit mountBadge）
  // 语义对齐 IDEA SimpleRefGroup.buildGroups：
  // - compactReferences：所有引用合并成一组，只渲染该组的首个名字
  // - showTagNames：控制标签是否显示名字（不影响分支）；两者独立生效，与调整顺序无关
  // tone 映射：tag=neutral、本地分支=primary、远程分支=info
  const renderRef = (name: string, isTag: boolean): HTMLElement => {
    const isLocal = !isTag && !name.includes('/') && name !== 'HEAD';
    const tone = isTag ? 'neutral' : isLocal ? 'primary' : 'info';
    // 标签名被隐藏时仍保留标签色块，只是不显示文字（与 IDEA 传入空名一致）
    const label = isTag && !settings.showTagNames ? '' : name;
    const slot = document.createElement('span');
    slot.setAttribute('data-ref', name);
    const badge = mountBadge(slot, { label, tone });
    badgeHandles.push(badge);
    return slot;
  };

  const refs = branches.map(b => ({ name: b, isTag: b.startsWith('tag:') }));
  const branchTags: HTMLElement[] = (() => {
    if (refs.length === 0) return [];
    if (settings.compactReferences) {
      // 紧凑：只显示首个引用（若首个是标签且标签名隐藏，则只留色块）
      const first = refs[0];
      return [renderRef(first.name, first.isTag)];
    }
    return refs.map(r => renderRef(r.name, r.isTag));
  })();

  // 哈希列 / 日期列 / 作者列按显示设置开关；日期列隐藏时作者列接替右对齐
  const hashCol = settings.showHash
    ? `<span data-col="hash" class="gm-commit-col-hash">${escapeText(commit.shortHash)}</span>`
    : '';
  const dateCol = settings.showDate
    ? `<span data-col="date" class="gm-commit-col-date">${formatDate(
        settings.preferCommitDate && commit.commitDate ? commit.commitDate : commit.date,
      )}</span>`
    : '';
  const authorCol = settings.showAuthor
    ? `<span data-col="author" class="gm-commit-col-author ${settings.showDate ? '' : 'gm-commit-col-author-shift'}">${escapeText(commit.authorName)}</span>`
    : '';

  const item = html`
    <div 
      class="gm-commit-row ${isSelected ? 'gm-commit-row-selected' : ''}"
      data-hash="${commit.hash}"
    >
      <!-- 圆点指示器 -->
      <span class="gm-commit-dot">
        <svg width="10" height="10" viewBox="0 0 10 10"><circle class="gm-commit-dot-mark" cx="5" cy="5" r="4" fill="var(--gm-primary)"/></svg>
      </span>
      <!-- 哈希列 -->
      ${raw(hashCol)}
      <!-- 引用在左：referencesOnLeft 开启时标签置于消息之前 -->
      ${settings.referencesOnLeft ? branchTags : ''}
      <!-- 提交消息 -->
      <span class="gm-commit-msg">${commit.message}</span>
      <!-- 引用在右（默认） -->
      ${settings.referencesOnLeft ? '' : branchTags}
      <!-- 时间 -->
      ${raw(dateCol)}
      <!-- 作者 -->
      ${raw(authorCol)}
    </div>
  `;

  return item;
}

/**
 * 转义拼接到原始 HTML 片段中的普通文本（列内容由本函数拼接，需自行转义）
 * @param str 待转义文本
 * @returns 转义后的安全文本
 */
function escapeText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 按指定排序模式比较两个提交的先后关系
 * @param a 前一个提交
 * @param b 后一个提交
 * @param mode 排序模式
 * @returns 负数 a 在前，正数 b 在前，0 表示顺序无关
 */
function compareCommits(a: CommitInfo, b: CommitInfo, mode: PanelState['sortMode']): number {
  const dateA = new Date(a.date).getTime();
  const dateB = new Date(b.date).getTime();
  if (mode === 'date-asc') {
    return dateA - dateB;
  }
  if (mode === 'author-asc') {
    return a.authorName.localeCompare(b.authorName) || dateB - dateA;
  }
  if (mode === 'message-asc') {
    return a.message.localeCompare(b.message) || dateB - dateA;
  }
  return 0;
}

/**
 * 按排序模式对提交排序（返回新数组，不修改入参）
 * default 模式保持原序
 * @param commits 待排序提交
 * @param mode 排序模式
 * @returns 排序后的新数组
 */
function sortCommits(commits: CommitInfo[], mode: PanelState['sortMode']): CommitInfo[] {
  if (mode === 'default') return [...commits];
  return [...commits].sort((a, b) => compareCommits(a, b, mode));
}

/**
 * 判断提交数组是否已按指定排序模式有序
 * @param commits 待检查提交
 * @param mode 排序模式
 * @returns 有序返回 true
 */
function isSortedCommits(commits: CommitInfo[], mode: PanelState['sortMode']): boolean {
  if (mode === 'default') return true;
  for (let i = 1; i < commits.length; i++) {
    if (compareCommits(commits[i - 1], commits[i], mode) > 0) return false;
  }
  return true;
}

/**
 * 判断单条文本是否匹配搜索关键字
 * 字面模式：大小写敏感时直接 includes，不敏感时双方 toLowerCase 后 includes
 * 正则模式：按大小写敏感与否构造不带/带 i 标志的 RegExp 做 test
 * 非法正则：输出 [commit-list] 前缀结构化错误日志后回退为字面匹配（不吞输入、不抛错）
 * @param text 待匹配文本（提交消息 / 短哈希 / 作者名）
 * @param pattern 搜索关键字（原始输入，不预先转换）
 * @param caseSensitive 是否大小写敏感
 * @param regex 是否正则模式
 * @returns 是否命中
 */
function matchesSearch(
  text: string,
  pattern: string,
  caseSensitive: boolean,
  regex: boolean,
): boolean {
  if (regex) {
    try {
      const re = new RegExp(pattern, caseSensitive ? '' : 'i');
      return re.test(text);
    } catch (e) {
      console.error(JSON.stringify({
        prefix: '[commit-list]',
        event: 'regex_invalid',
        error: String(e),
      }));
      // 回退字面匹配：保留用户输入，不中断过滤管道
      return caseSensitive ? text.includes(pattern) : text.toLowerCase().includes(pattern.toLowerCase());
    }
  }
  return caseSensitive ? text.includes(pattern) : text.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * 判断两个路径数组内容是否逐项相同（顺序敏感）
 * 用于路径对话框应用结果与打开时快照的比较：相同则仅关闭不重复触发请求
 * （对话框回调每次返回新数组引用，引用比较会误判为"有变化"，必须按内容深比较）
 * @param a 路径数组 a
 * @param b 路径数组 b
 * @returns 内容完全相同返回 true
 */
function samePaths(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((path, index) => path === b[index]);
}

/**
 * 计算日期预设的起止区间（全部按本地时区构造后转 ISO 字符串）
 * 边界约定：
 * - today：本地今天 00:00:00.000 → 23:59:59.999
 * - thisWeek：本周一 00:00:00.000 → 本周日 23:59:59.999（以周一为一周起点，
 *   getDay() 周日为 0，换算偏移 (day + 6) % 7）
 * - thisMonth：本月 1 日 00:00:00.000 → 月末 23:59:59.999（跨月由 Date 自动归一）
 * - thisYear：1 月 1 日 00:00:00.000 → 12 月 31 日 23:59:59.999
 * @param preset 预设标识
 * @param now 当前时间（注入便于测试固定时钟）
 * @returns { from, to } ISO 字符串区间
 */
function computeDateRange(
  preset: 'today' | 'thisWeek' | 'thisMonth' | 'thisYear',
  now: Date,
): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  let start: Date;
  let end: Date;

  if (preset === 'today') {
    start = new Date(y, m, d, 0, 0, 0, 0);
    end = new Date(y, m, d, 23, 59, 59, 999);
  } else if (preset === 'thisWeek') {
    const offset = (now.getDay() + 6) % 7; // 周一=0 … 周日=6
    start = new Date(y, m, d - offset, 0, 0, 0, 0);
    end = new Date(y, m, d - offset + 6, 23, 59, 59, 999);
  } else if (preset === 'thisMonth') {
    start = new Date(y, m, 1, 0, 0, 0, 0);
    end = new Date(y, m + 1, 0, 23, 59, 59, 999); // 下月 0 号 = 本月末
  } else {
    start = new Date(y, 0, 1, 0, 0, 0, 0);
    end = new Date(y, 11, 31, 23, 59, 59, 999);
  }

  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * 按当前过滤条件（搜索/作者/日期）与排序模式从 allCommits 重算 filteredCommits
 * 搜索按 searchRegex / searchCaseSensitive 标志走字面或正则匹配；
 * 除组件内部订阅与刷新按钮外，main.ts 的 loadData 刷新场景也复用本函数，
 * 在外部替换 allCommits 后重应用活动过滤，避免刷新时丢失用户过滤条件
 */
export function filterCommits(): void {
  const state = getState();
  let commits = [...state.allCommits];

  if (state.commitSearch) {
    commits = commits.filter(c =>
      matchesSearch(c.message, state.commitSearch, state.searchCaseSensitive, state.searchRegex) ||
      matchesSearch(c.shortHash, state.commitSearch, state.searchCaseSensitive, state.searchRegex) ||
      matchesSearch(c.authorName, state.commitSearch, state.searchCaseSensitive, state.searchRegex)
    );
  }

  if (state.filterAuthor) {
    commits = commits.filter(c => c.authorName === state.filterAuthor);
  }

  if (state.filterDateFrom) {
    commits = commits.filter(c => new Date(c.date) >= new Date(state.filterDateFrom));
  }
  if (state.filterDateTo) {
    commits = commits.filter(c => new Date(c.date) <= new Date(state.filterDateTo));
  }

  // 过滤管道末尾应用排序
  setState(s => { s.filteredCommits = sortCommits(commits, state.sortMode); });
}

async function refreshCommits(service: ServiceClient, directory: string): Promise<void> {
  const state = getState();
  const branch = state.logBranch || undefined;
  // 路径过滤为服务端条件（git log -- path1 path2）：无路径时不传第 3 参，避免多余参数；
  // 传数组副本防止外部后续原地变异已发出的请求参数
  const paths = state.filterPaths.length ? [...state.filterPaths] : undefined;
  try {
    const commits = await service.getLog(directory, branch, paths);
    setState(s => {
      s.allCommits = commits;
      s.filteredCommits = commits;
    });
    filterCommits();
  } catch (e) {
    showOperationError(e, 'commit.loadListFailed', '[commit-list]', 'refresh_commits_error');
  }
}

/**
 * 切换搜索的正则表达式模式
 * 状态翻转 → 重跑过滤管道 → 输出结构化调试日志
 */
function toggleRegex(): void {
  setState(s => { s.searchRegex = !s.searchRegex; });
  filterCommits();
  console.debug(JSON.stringify({
    prefix: '[commit-list]',
    event: 'search_regex_toggled',
    value: getState().searchRegex,
  }));
}

/**
 * 切换搜索的大小写敏感开关
 * 状态翻转 → 重跑过滤管道 → 输出结构化调试日志
 */
function toggleCase(): void {
  setState(s => { s.searchCaseSensitive = !s.searchCaseSensitive; });
  filterCommits();
  console.debug(JSON.stringify({
    prefix: '[commit-list]',
    event: 'search_case_toggled',
    value: getState().searchCaseSensitive,
  }));
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { n: diffMin });
  if (diffHour < 24) return t('time.hoursAgo', { n: diffHour });
  if (diffDay < 7) return t('time.daysAgo', { n: diffDay });

  return date.toLocaleDateString(getLang());
}
