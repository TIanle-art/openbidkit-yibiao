import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import AgentRuntimeStatusBar from '../app/AgentRuntimeStatusBar';
import { getAppMenuItemById, getParentMenuItemBySection } from '../app/menuConfig';
import type { SectionId } from '../shared/types/navigation';
import Sidebar from './Sidebar';

interface AppShellProps {
  activeSection: SectionId;
  children: ReactNode;
  developerMode: boolean;
  onSectionChange: (section: SectionId) => void;
}

function AppShell({ activeSection, children, developerMode, onSectionChange }: AppShellProps) {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const activeItem = getAppMenuItemById(activeSection, developerMode);
  const parentItem = getParentMenuItemBySection(activeSection, developerMode);
  // 仅当当前是“父菜单下的子页面”（没有子级的叶子页）时显示返回父级入口。
  const showBack = Boolean(parentItem && !activeItem?.children?.length);

  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={80}>
      <div className={`app-shell${isMac ? ' is-mac' : ''}`}>
        <Sidebar activeSection={activeSection} developerMode={developerMode} onSectionChange={onSectionChange} />

        <main className="main-area">
          <AgentRuntimeStatusBar />
          {showBack && parentItem ? (
            <div className="shell-back-bar">
              <button type="button" className="secondary-action" onClick={() => onSectionChange(parentItem.id)}>
                <span className="shell-back-icon" aria-hidden="true">←</span>
                <span>返回 {parentItem.label}</span>
              </button>
            </div>
          ) : null}
          <section className="content-shell" aria-label="主内容">
            {children}
          </section>
        </main>
      </div>
    </Tooltip.Provider>
  );
}

export default AppShell;
