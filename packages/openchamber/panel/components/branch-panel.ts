/**
 * 分支面板组件
 * 交互参考 IntelliJ 分支面板
 * 支持树状分组结构
 */

import { html, raw } from '../html';
import { getState, setState, subscribeFields, Branch } from '../state';
import { ServiceClient } from '../service';
import { getIcon } from '../icons';
import { t } from '../i18n';
import { showContextMenu } from './context-menu';
import { mountSearchField } from '@openchamber/sdk/ui';
import type { SearchFieldHandle } from '@openchamber/sdk/ui';

/**
 * 创建分支面板
 * @param container 挂载容器
 * @param service 服务客户端（右键菜单操作使用）
 * @param directory 当前仓库目录
 * @param onBranchSelect 点击分支项回调：由 main 负责拉取该分支提交并设置分支过滤
 * @param onSelectionCleared 点击列表空白区域的取消选中回调（对齐 IntelliJ IDEA：
 *   分支面板存在选中分支 selectedBranch 或分支过滤 logBranch 时点击空白触发，
 *   由 main 清空选中态并恢复全部提交；两者都不存在时空操作不触发）
 * @returns 面板句柄（dispose 取消订阅、expandAll 展开全部分组、collapseAll 折叠全部分组）
 */
export function createBranchPanel(
  container: HTMLElement,
  service: ServiceClient,
  directory: string,
  onBranchSelect: (branch: Branch) => void,
  onSelectionCleared: () => void
): { dispose: () => void; expandAll: () => void; collapseAll: () => void } {
  let disposed = false;
  let listContainer: HTMLElement | null = null;
  const expandedGroups = new Set<string>([t('branch.groupHead'), t('branch.groupLocal')]);
  let unsubscribe: (() => void) | null = null;
  /** SDK UI Kit 搜索框 handle（分支搜索）：render 重建前与组件 dispose 时统一释放 */
  let searchHandle: SearchFieldHandle | null = null;

  const findBranchFromEvent = (e: Event): Branch | null => {
    const target = e.target as HTMLElement;
    const item = target.closest('[data-branch]');
    if (!item) return null;
    const branchName = item.getAttribute('data-branch');
    if (!branchName) return null;
    const state = getState();
    const branch = state.branches.find(b => b.name === branchName) || null;
    if (!branch) {
      console.error(JSON.stringify({
        prefix: '[branch-panel]',
        event: 'branch_not_found',
        branchName,
        availableCount: state.branches.length,
        targetTag: target.tagName,
      }));
    }
    return branch;
  };

  const findGroupFromEvent = (e: Event): string | null => {
    const target = e.target as HTMLElement;
    const item = target.closest('[data-group]');
    if (!item) return null;
    return item.getAttribute('data-group');
  };

  const render = () => {
    if (disposed) return;
    container.innerHTML = '';

    // 搜索框（SDK UI Kit mountSearchField）
    const searchContainer = html`
      <div class="gm-branch-search">
        <div data-branch-search class="gm-branch-search-slot"></div>
      </div>
    `;

    searchHandle?.dispose();
    searchHandle = mountSearchField(searchContainer.querySelector<HTMLElement>('[data-branch-search]')!, {
      value: getState().branchFilter,
      placeholder: t('branch.searchPlaceholder'),
      onChange: (value) => {
        setState(s => { s.branchFilter = value; });
        // 订阅回调会触发 renderList，此处无需重复调用
      },
    });
    container.appendChild(searchContainer);

    // 分支列表
    listContainer = html`
      <div class="gm-branch-list"></div>
    `;

    listContainer.addEventListener('click', (e) => {
      // 先处理分支选择（分支项可能嵌套在分组结构内，需优先匹配）
      const branch = findBranchFromEvent(e);
      if (branch) {
        // 对齐 IDEA 分支树多选：Cmd/Ctrl 点击累加选中，普通点击单选
        const multi = e.metaKey || e.ctrlKey;
        console.debug(JSON.stringify({
          prefix: '[branch-panel]',
          event: 'branch_click',
          branchName: branch.name,
          multi,
        }));

        if (multi) {
          // 多选：只维护选中集合，不切换提交列表（交由比较图标使用）
          setState(s => {
            const next = new Set(s.selectedBranches);
            if (next.has(branch.name)) next.delete(branch.name);
            else next.add(branch.name);
            s.selectedBranches = next;
            // 仅剩一个选中项时仍作为主选中分支，多于一个时主选中置空
            const names = [...next];
            s.selectedBranch = names.length === 1
              ? s.branches.find(b => b.name === names[0]) ?? branch
              : null;
          });
          renderList();
          return;
        }

        // 先触发选择回调，再更新选中态（避免订阅回调异常阻断加载）
        try {
          console.debug(JSON.stringify({ prefix: '[branch-panel]', event: 'before_on_branch_select', branchName: branch.name }));
          onBranchSelect(branch);
          console.debug(JSON.stringify({ prefix: '[branch-panel]', event: 'after_on_branch_select', branchName: branch.name }));
        } catch (err) {
          console.error(JSON.stringify({ prefix: '[branch-panel]', event: 'on_branch_select_error', error: String(err) }));
        }
        setState(s => {
          // 存最新数组里的对象（避免存快照后刷新导致字段过期）；找不到时退回点击时的对象
          s.selectedBranch = s.branches.find(b => b.name === branch.name) ?? branch;
          // 普通点击清空多选集合，与 IDEA 单选语义一致
          s.selectedBranches = new Set<string>();
        });
        renderList();
        return;
      }

      // 再处理分组折叠/展开
      const groupEl = findGroupFromEvent(e);
      if (groupEl) {
        console.debug(JSON.stringify({
          prefix: '[branch-panel]',
          event: 'group_click',
          groupName: groupEl,
        }));
        if (expandedGroups.has(groupEl)) {
          expandedGroups.delete(groupEl);
        } else {
          expandedGroups.add(groupEl);
        }
        renderList();
        // 分组点击不落入下方的空白清除逻辑
        return;
      }

      // 空白区域点击（既非分支也非分组）：对齐 IntelliJ IDEA，
      // 存在选中分支或分支过滤时触发清除回调；清除动作（改 state + 重新拉数据）由 main 统一实现
      const state = getState();
      if (state.selectedBranch || state.logBranch) {
        console.debug(JSON.stringify({ prefix: '[branch-panel]', event: 'blank_clear' }));
        onSelectionCleared();
      } else {
        console.debug(JSON.stringify({ prefix: '[branch-panel]', event: 'blank_clear_noop' }));
      }
    });

    listContainer.addEventListener('contextmenu', (e) => {
      const branch = findBranchFromEvent(e);
      if (branch) {
        e.preventDefault();
        showContextMenu(e, branch, service, directory);
      }
    });

    container.appendChild(listContainer);
    renderList();

    // 订阅状态字段，变化时局部更新分支列表
    if (unsubscribe) unsubscribe();
    unsubscribe = subscribeFields(
      ['branches', 'branchFilter', 'favorites', 'selectedBranch', 'showOnlyMyBranches', 'myBranches'],
      () => {
        if (!disposed) renderList();
      }
    );
  };

  const renderList = () => {
    if (disposed || !listContainer) return;
    const state = getState();
    listContainer.innerHTML = '';

    const filteredBranches = state.branches.filter(branch => {
      // 只显示我的分支：本地与远程分支都按判定结果过滤（远程分支名形如 origin/xxx）
      if (state.showOnlyMyBranches && !state.myBranches.has(branch.name)) {
        return false;
      }
      if (!state.branchFilter) return true;
      return branch.name.toLowerCase().includes(state.branchFilter.toLowerCase());
    });

    // 本地分支：包含当前分支（对齐 IDEA，当前分支只出现在本地分组内，不再单列 HEAD 组）
    const current = filteredBranches.filter(b => b.isCurrent);
    // 本地分支：包含当前分支（对齐 IDEA，当前分支同时存在于 HEAD 组与本地组）
    const local = filteredBranches.filter(b => !b.isRemote);
    const remote = filteredBranches.filter(b => b.isRemote);

    // HEAD(当前分支)：独立分组，点击即把提交列表过滤到当前分支提交
    if (current.length > 0) {
      listContainer.appendChild(
        createGroup(t('branch.groupHead'), current, expandedGroups.has(t('branch.groupHead')))
      );
    }

    // 本地分支 - 按文件夹分组
    if (local.length > 0) {
      const groups = groupBranches(local);
      const localGroup = createCollapsibleGroup(t('branch.groupLocal'), groups);
      listContainer.appendChild(localGroup);
    }

    // 远程分支
    if (remote.length > 0) {
      listContainer.appendChild(
        createGroup(t('branch.groupRemote'), remote, expandedGroups.has(t('branch.groupRemote')))
      );
    }
  };

  /**
   * 展开全部可折叠分组：HEAD(当前分支)/本地/远程 三大分组，
   * 以及"本地"分组内由 createCollapsibleGroup 渲染的文件夹分组
   * （文件夹 key 与 groupBranches 一致，取分支名第一段）
   * dispose 后调用为安全空操作
   */
  const expandAll = () => {
    if (disposed) return;
    expandedGroups.add(t('branch.groupHead'));
    expandedGroups.add(t('branch.groupLocal'));
    expandedGroups.add(t('branch.groupRemote'));
    for (const branch of getState().branches) {
      const parts = branch.name.split('/');
      if (parts.length > 1) {
        expandedGroups.add(parts[0]);
      }
    }
    console.debug(JSON.stringify({
      prefix: '[branch-panel]',
      event: 'expand_all',
      groupCount: expandedGroups.size,
    }));
    renderList();
  };

  const dispose = () => {
    disposed = true;
    // 释放 SDK UI Kit 搜索框 handle，避免节点/监听泄漏
    searchHandle?.dispose();
    searchHandle = null;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
  render();
  /**
   * 折叠全部分组（HEAD / 本地 / 远程 / 文件夹），对齐 IDEA Collapse All
   */
  const collapseAll = () => {
    if (disposed) return;
    expandedGroups.clear();
    console.debug(JSON.stringify({
      prefix: '[branch-panel]',
      event: 'collapse_all',
    }));
    renderList();
  };

  return { dispose, expandAll, collapseAll };

  /** 按文件夹名分组分支 */
  function groupBranches(branches: Branch[]): Map<string, Branch[]> {
    const groups = new Map<string, Branch[]>();
    const rootBranches: Branch[] = [];

    for (const branch of branches) {
      const parts = branch.name.split('/');
      if (parts.length > 1) {
        const folderName = parts[0];
        if (!groups.has(folderName)) {
          groups.set(folderName, []);
        }
        groups.get(folderName)!.push(branch);
      } else {
        rootBranches.push(branch);
      }
    }

    // 根分支放在最前面
    const result = new Map<string, Branch[]>();
    for (const branch of rootBranches) {
      const key = branch.name;
      result.set(key, [branch]);
    }

    // 文件夹分组
    for (const [folder, branchList] of groups) {
      result.set(folder, branchList);
    }

    return result;
  }

  /** 创建可折叠分组 */
  function createCollapsibleGroup(title: string, groups: Map<string, Branch[]>): HTMLElement {
    const isExpanded = expandedGroups.has(title);

    const groupEl = html`
      <div class="gm-branch-group">
        <div data-group="${title}" class="gm-branch-group-header">
          <span class="gm-branch-group-arrow">${isExpanded ? '▼' : '▶'}</span>
          ${title}
        </div>
      </div>
    `;

    if (isExpanded) {
      for (const [key, branches] of groups) {
        if (branches.length === 1 && key === branches[0].name) {
          // 单个分支
          groupEl.appendChild(createBranchItem(branches[0]));
        } else {
          // 文件夹分组
          const folderExpanded = expandedGroups.has(key);
          const folderEl = html`
            <div class="gm-branch-folder">
              <div data-group="${key}" class="gm-branch-folder-header">
                <span class="gm-branch-group-arrow">${folderExpanded ? '▼' : '▶'}</span>
                ${key}
              </div>
            </div>
          `;

          if (folderExpanded) {
            for (const branch of branches) {
              const branchItem = createBranchItem(branch);
              branchItem.style.paddingLeft = '32px';
              folderEl.appendChild(branchItem);
            }
          }

          groupEl.appendChild(folderEl);
        }
      }
    }

    return groupEl;
  }

  /** 创建简单分组 (HEAD, 远程) */
  function createGroup(title: string, branches: Branch[], expanded: boolean): HTMLElement {
    const group = html`
      <div class="gm-branch-group">
        <div data-group="${title}" class="gm-branch-group-header">
          <span class="gm-branch-group-arrow">${expanded ? '▼' : '▶'}</span>
          ${title}
        </div>
      </div>
    `;

    if (expanded) {
      for (const branch of branches) {
        group.appendChild(createBranchItem(branch));
      }
    }

    return group;
  }

  function createBranchItem(branch: Branch): HTMLElement {
    const state = getState();
    const isFavorite = state.favorites.has(branch.name);
    // 选中态：点击的分支（多选集合优先，其次单选分支；区别于 HEAD 当前分支）
    const isSelected = state.selectedBranches.has(branch.name)
      || (state.selectedBranches.size === 0 && state.selectedBranch?.name === branch.name);
    // 状态类：选中 > 当前分支；主题样式由 __styles__/branch-panel.css 承担
    const itemClass = isSelected
      ? 'gm-branch-item gm-branch-item-selected'
      : branch.isCurrent
        ? 'gm-branch-item gm-branch-item-current'
        : 'gm-branch-item';
    const nameClass = branch.isCurrent
      ? 'gm-branch-item-name gm-branch-item-name-current'
      : 'gm-branch-item-name';

    return html`
      <div 
        class="${itemClass}"
        data-branch="${branch.name}"
      >
        <span class="gm-branch-item-icon">${raw(getIcon('branchIcon'))}</span>
        ${raw(isFavorite ? `<span class="gm-branch-item-star" title="${t('branch.unfavorite')}">${getIcon('favorite')}</span>` : '')}
        <span class="${nameClass}">${branch.name}</span>
        ${raw(branch.hasUnpushed && branch.unpushedCount ? `<span class="gm-branch-badge-unpushed">↑${branch.unpushedCount}</span>` : '')}
        ${raw(branch.hasUnpulled && branch.unpulledCount ? `<span class="gm-branch-badge-unpulled">↓${branch.unpulledCount}</span>` : '')}
      </div>
    `;
  }
}
