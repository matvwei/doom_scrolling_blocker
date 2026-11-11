import { useState } from 'react';
import type { ExtensionConfig } from '../../core/config';
import { emptyServiceState, remainingTime, type ServiceState } from '../../core/limits';
import { builtinLabel, SERVICE_IDS } from '../../core/services';
import { formatClock } from '../../core/time';
import { useExtensionData } from '../../hooks/useExtensionData';
import SettingsApp from '../../components/SettingsApp';

function toggleService(config: ExtensionConfig, serviceId: (typeof SERVICE_IDS)[number]): ExtensionConfig {
  return {
    ...config,
    services: {
      ...config.services,
      [serviceId]: { ...config.services[serviceId], enabled: !config.services[serviceId].enabled },
    },
  };
}

function toggleCustomSite(config: ExtensionConfig, siteId: string): ExtensionConfig {
  return {
    ...config,
    customSites: config.customSites.map((site) =>
      site.id === siteId ? { ...site, enabled: !site.enabled } : site,
    ),
  };
}

function targetStats(
  state: Record<string, ServiceState>,
  targetId: string,
): ServiceState {
  return state[targetId] ?? emptyServiceState(Date.now());
}

export default function App() {
  const { config, state, saveConfig } = useExtensionData();
  // Настройки открываются внутри popup (view), без отдельной страницы/вкладки.
  // Полная страница options остаётся fallback через chrome://extensions.
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard');

  if (!config || !state) {
    return <div className="popup-loading">Загрузка…</div>;
  }

  if (view === 'settings') {
    return (
      <div className="popup">
        <div className="popup__panel">
          <SettingsApp compact onBack={() => setView('dashboard')} />
        </div>
      </div>
    );
  }

  return (
    <div className="popup">
      <header className="popup__header">
        <h1 className="popup__title">Doomscroll Blocker</h1>
        <button
          type="button"
          className="popup__settings"
          onClick={() => setView('settings')}
        >
          Настройки
        </button>
      </header>

      <ul className="services">
        {SERVICE_IDS.map((serviceId) => {
          const serviceConfig = config.services[serviceId];
          const serviceState = targetStats(state, serviceId);
          const remaining = remainingTime(serviceState, serviceConfig);
          const blocked = serviceState.blockedReason !== null;
          const label = builtinLabel(serviceId, config.youtubeScope);

          return (
            <li key={serviceId} className="service">
              <div className="service__head">
                <span className="service__name">{label}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={serviceConfig.enabled}
                    onChange={() => void saveConfig(toggleService(config, serviceId))}
                    aria-label={`Включить ${label}`}
                  />
                  <span className="switch__slider" />
                </label>
              </div>

              <div className="service__stats">
                <div className="stat">
                  <span className="stat__label">Сессия</span>
                  <span className={`stat__value${blocked && serviceState.blockedReason === 'session' ? ' stat__value--empty' : ''}`}>
                    {serviceConfig.enabled ? formatClock(remaining.sessionSeconds) : '—'}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">День</span>
                  <span className={`stat__value${blocked && serviceState.blockedReason === 'daily' ? ' stat__value--empty' : ''}`}>
                    {serviceConfig.enabled ? formatClock(remaining.dailySeconds) : '—'}
                  </span>
                </div>
              </div>

              {blocked && <div className="service__blocked">Лимит исчерпан</div>}
            </li>
          );
        })}

        {config.customSites.map((site) => {
          const serviceState = targetStats(state, site.id);
          const remaining = remainingTime(serviceState, site);
          const blocked = serviceState.blockedReason !== null;

          return (
            <li key={site.id} className="service service--custom">
              <div className="service__head">
                <span className="service__name">{site.name}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={site.enabled}
                    onChange={() => void saveConfig(toggleCustomSite(config, site.id))}
                    aria-label={`Включить ${site.name}`}
                  />
                  <span className="switch__slider" />
                </label>
              </div>

              <div className="service__stats">
                <div className="stat">
                  <span className="stat__label">Сессия</span>
                  <span className={`stat__value${blocked && serviceState.blockedReason === 'session' ? ' stat__value--empty' : ''}`}>
                    {site.enabled ? formatClock(remaining.sessionSeconds) : '—'}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">День</span>
                  <span className={`stat__value${blocked && serviceState.blockedReason === 'daily' ? ' stat__value--empty' : ''}`}>
                    {site.enabled ? formatClock(remaining.dailySeconds) : '—'}
                  </span>
                </div>
              </div>

              {blocked && <div className="service__blocked">Лимит исчерпан</div>}
            </li>
          );
        })}
      </ul>

      <footer className="popup__footer">
        Лимиты сессии сбрасываются после 10 минут без активности. Лимит 0 минут блокирует сайт
        сразу при открытии.
      </footer>
    </div>
  );
}
