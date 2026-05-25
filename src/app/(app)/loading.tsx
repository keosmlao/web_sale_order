export default function AppLoading() {
  return (
    <div className="odoo-page">
      <div className="route-loading-head">
        <div>
          <div className="route-skeleton route-skeleton-kicker" />
          <div className="route-skeleton route-skeleton-title" />
        </div>
        <div className="route-skeleton route-skeleton-action" />
      </div>
      <div className="route-loading-grid">
        <div className="route-loading-card">
          <div className="route-skeleton route-skeleton-line wide" />
          <div className="route-skeleton route-skeleton-line" />
          <div className="route-skeleton route-skeleton-line short" />
        </div>
        <div className="route-loading-card">
          <div className="route-skeleton route-skeleton-line wide" />
          <div className="route-skeleton route-skeleton-line" />
          <div className="route-skeleton route-skeleton-line short" />
        </div>
        <div className="route-loading-card">
          <div className="route-skeleton route-skeleton-line wide" />
          <div className="route-skeleton route-skeleton-line" />
          <div className="route-skeleton route-skeleton-line short" />
        </div>
      </div>
      <div className="route-loading-table">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="route-loading-row">
            <div className="route-skeleton route-skeleton-dot" />
            <div className="route-skeleton route-skeleton-line wide" />
            <div className="route-skeleton route-skeleton-line" />
            <div className="route-skeleton route-skeleton-line short" />
          </div>
        ))}
      </div>
    </div>
  );
}
