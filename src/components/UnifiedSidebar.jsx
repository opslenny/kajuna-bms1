export default function UnifiedSidebar({
  id,
  className = '',
  open = false,
  collapsed = false,
  brand,
  profile,
  closeLabel = 'Close navigation',
  collapseLabel = 'Collapse navigation',
  expandLabel = 'Expand navigation',
  signOutLabel = 'Sign out',
  onClose,
  onToggleCollapsed,
  onSignOut,
  children,
}) {
  return (
    <aside id={id} className={`unified-sidebar ${className}${open ? ' mobile-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <header className="unified-sidebar-header">
        <div className="unified-sidebar-brand">{brand}</div>
        <button type="button" className="unified-sidebar-collapse" onClick={onToggleCollapsed} aria-label={collapsed ? expandLabel : collapseLabel} title={collapsed ? expandLabel : collapseLabel}>
          <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
        </button>
        <button type="button" className="mobile-navigation-close" aria-label={closeLabel} onClick={onClose}>×</button>
      </header>
      <div className="unified-sidebar-navigation">{children}</div>
      <footer className="unified-sidebar-footer">
        {profile}
        <button type="button" className="sidebar-signout" onClick={onSignOut}>{signOutLabel}</button>
      </footer>
    </aside>
  )
}
