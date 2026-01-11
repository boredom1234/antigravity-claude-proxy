/**
 * Dashboard Stats Module
 * Handles account statistics calculation
 */
window.DashboardStats = window.DashboardStats || {};

/**
 * Update account statistics (active, limited, total)
 * @param {object} component - Dashboard component instance
 */
window.DashboardStats.updateStats = function(component) {
    const accounts = Alpine.store('data').accounts;
    let active = 0, limited = 0;

    const isCore = (id) => /sonnet|opus|pro|flash/i.test(id);

    // Only count enabled accounts in statistics
    const enabledAccounts = accounts.filter(acc => acc.enabled !== false);

    enabledAccounts.forEach(acc => {
        if (acc.status === 'ok') {
            const limits = Object.entries(acc.limits || {});
            let hasActiveCore = limits.some(([id, l]) => l && l.remainingFraction > 0.05 && isCore(id));

            if (!hasActiveCore) {
                const hasAnyCore = limits.some(([id]) => isCore(id));
                if (!hasAnyCore) {
                    hasActiveCore = limits.some(([_, l]) => l && l.remainingFraction > 0.05);
                }
            }

            if (hasActiveCore) active++; else limited++;
        } else {
            limited++;
        }
    });

    // TOTAL shows only enabled accounts
    // Disabled accounts are excluded from all statistics
    component.stats.total = enabledAccounts.length;
    component.stats.active = active;
    component.stats.limited = limited;

    // Calculate subscription tier distribution
    const subscription = { ultra: 0, pro: 0, free: 0 };
    enabledAccounts.forEach(acc => {
        const tier = acc.subscription?.tier || 'free';
        if (tier === 'ultra') {
            subscription.ultra++;
        } else if (tier === 'pro') {
            subscription.pro++;
        } else {
            subscription.free++;
        }
    });
    component.stats.subscription = subscription;
};
