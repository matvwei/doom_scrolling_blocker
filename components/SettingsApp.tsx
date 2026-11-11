import { useEffect, useState } from 'react';
import './settings.css';
import {
  getDefaultConfig,
  getDefaultServiceConfig,
  validateConfig,
  type ConfigErrors,
  type CustomSiteConfig,
  type ExtensionConfig,
  type LimitAction,
  type ServiceConfig,
  type YouTubeScope,
} from '../core/config';
import { generateSiteId, normalizeCustomSiteUrl } from '../core/customSites';
import {
  permissionsSatisfied,
  requestPermissionsForSites,
  removeUnusedSitePermissions,
} from '../adapters/permissions';
import {
  clearPendingConfig,
  loadPendingConfig,
  savePendingConfig,
} from '../adapters/storage';
import { isResumablePendingConfig } from '../adapters/pendingResume';
import { builtinLabel, SERVICE_IDS, type ServiceId } from '../core/services';
import { useExtensionData } from '../hooks/useExtensionData';

/** Строковая форма полей — чтобы не терять ввод пользователя при частичном значении. */
interface ServiceForm {
  enabled: boolean;
  sessionLimitMinutes: string;
  dailyLimitMinutes: string;
  action: LimitAction;
  redirectUrl: string;
  message: string;
}

interface CustomSiteForm extends ServiceForm {
  id: string;
  name: string;
  url: string;
}

interface FormState {
  youtubeScope: YouTubeScope;
  services: Record<ServiceId, ServiceForm>;
  customSites: CustomSiteForm[];
}

const ACTION_LABELS: Record<LimitAction, string> = {
  warning: 'Предупреждение (экран-блокировка)',
  redirect: 'Перенаправление',
  close: 'Закрыть вкладку',
};

/** Пояснение, когда сохранение прервалось нативным запросом доступа. */
const PERMISSION_INTERRUPTED_NOTICE =
  'Сохранение было прервано запросом доступа к сайтам: доступ не подтверждён. Введённые данные восстановлены — разрешите доступ в запросе браузера и нажмите «Сохранить» ещё раз.';

export interface SettingsAppProps {
  /**
   * Компактный вариант для popup: одна колонка карточек, нет шапки-описания.
   * Полная страница options сохраняет много колоночную сетку.
   */
  compact?: boolean;
  /** Кнопка «Назад» — в popup возвращает на dashboard. */
  onBack?: () => void;
}

function toServiceForm(config: ServiceConfig): ServiceForm {
  return {
    enabled: config.enabled,
    sessionLimitMinutes: String(config.sessionLimitMinutes),
    dailyLimitMinutes: String(config.dailyLimitMinutes),
    action: config.action,
    redirectUrl: config.redirectUrl,
    message: config.message,
  };
}

function toForm(config: ExtensionConfig): FormState {
  const services = {} as Record<ServiceId, ServiceForm>;
  for (const id of SERVICE_IDS) {
    services[id] = toServiceForm(config.services[id]);
  }
  return {
    youtubeScope: config.youtubeScope,
    services,
    customSites: config.customSites.map((site) => ({
      id: site.id,
      name: site.name,
      url: site.url,
      ...toServiceForm(site),
    })),
  };
}

function fromForm(form: FormState): ExtensionConfig {
  const config = getDefaultConfig();
  config.youtubeScope = form.youtubeScope;
  for (const id of SERVICE_IDS) {
    const service = form.services[id];
    config.services[id] = {
      enabled: service.enabled,
      sessionLimitMinutes: Number(service.sessionLimitMinutes),
      dailyLimitMinutes: Number(service.dailyLimitMinutes),
      action: service.action,
      redirectUrl: service.redirectUrl.trim(),
      message: service.message,
    } satisfies ServiceConfig;
  }
  config.customSites = form.customSites.map((site) => ({
    id: site.id,
    name: site.name.trim(),
    url: site.url,
    enabled: site.enabled,
    sessionLimitMinutes: Number(site.sessionLimitMinutes),
    dailyLimitMinutes: Number(site.dailyLimitMinutes),
    action: site.action,
    redirectUrl: site.redirectUrl.trim(),
    message: site.message,
  })) satisfies CustomSiteConfig[];
  return config;
}

/** Черновик нового сайта: все поля правила сразу, в одну колонку. */
function emptyNewSite(): CustomSiteForm {
  return {
    id: '',
    name: '',
    url: '',
    ...toServiceForm(getDefaultServiceConfig()),
  };
}

export default function SettingsApp({ compact = false, onBack }: SettingsAppProps) {
  const { config, saveConfig } = useExtensionData();
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<ConfigErrors>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [newSite, setNewSite] = useState<CustomSiteForm>(emptyNewSite);
  const [addError, setAddError] = useState<string | null>(null);
  /** Черновик, восстановленный после прерванного запроса разрешений. */
  const [restoredDraft, setRestoredDraft] = useState<ExtensionConfig | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);

  // При открытии настроек достраиваем сохранение, прерванное нативным prompt:
  // popup закрывается при показе запроса разрешений, поэтому черновик был
  // записан в хранилище до вызова request. Если доступ уже выдан — сохраняем
  // сами (черновик перечитывается перед записью: постороннее сохранение
  // config инвалидирует черновик, и свежий config не затирается); если нет —
  // восстанавливаем форму из черновика с пояснением. Повреждённый черновик
  // не применяется и очищается.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await loadPendingConfig();
      if (cancelled) return;
      if (!pending) return;
      if (!isResumablePendingConfig(pending)) {
        await clearPendingConfig();
        return;
      }
      if (!(await permissionsSatisfied(pending.customSites))) {
        if (!cancelled) {
          setRestoredDraft(pending);
          setPermissionError(PERMISSION_INTERRUPTED_NOTICE);
        }
        return;
      }
      const fresh = await loadPendingConfig();
      if (cancelled) return;
      if (!fresh) return; // инвалидирован параллельным сохранением config
      if (!isResumablePendingConfig(fresh)) {
        await clearPendingConfig();
        return;
      }
      const ok = await saveConfig(fresh);
      if (ok) await clearPendingConfig();
      if (cancelled) return;
      setRestoredDraft(fresh);
      setSaveStatus(ok ? 'saved' : 'error');
      if (!ok) {
        setPermissionError('Не удалось сохранить восстановленные изменения — нажмите «Сохранить» ещё раз.');
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDraftChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [saveConfig]);

  useEffect(() => {
    if (form || !draftChecked) return;
    const source = restoredDraft ?? config;
    if (source) setForm(toForm(source));
  }, [config, form, restoredDraft, draftChecked]);

  if (!config || !form) {
    return <div className="options-loading">Загрузка…</div>;
  }

  const updateService = (id: ServiceId, patch: Partial<ServiceForm>) => {
    setForm({ ...form, services: { ...form.services, [id]: { ...form.services[id], ...patch } } });
    setSaveStatus('idle');
  };

  const updateSite = (id: string, patch: Partial<CustomSiteForm>) => {
    setForm({
      ...form,
      customSites: form.customSites.map((site) =>
        site.id === id ? { ...site, ...patch } : site,
      ),
    });
    setSaveStatus('idle');
  };

  const updateNewSite = (patch: Partial<CustomSiteForm>) => {
    setNewSite((current) => ({ ...current, ...patch }));
  };

  const handleAddSite = () => {
    const name = newSite.name.trim();
    const url = normalizeCustomSiteUrl(newSite.url);
    if (!name) {
      setAddError('Укажите название сайта');
      return;
    }
    if (!url) {
      setAddError('Адрес должен быть в формате https://домен[/раздел]');
      return;
    }
    if (form.customSites.some((site) => normalizeCustomSiteUrl(site.url) === url)) {
      setAddError('Такой сайт уже добавлен');
      return;
    }
    setForm({
      ...form,
      customSites: [
        ...form.customSites,
        {
          id: generateSiteId(),
          name,
          url,
          enabled: newSite.enabled,
          sessionLimitMinutes: newSite.sessionLimitMinutes,
          dailyLimitMinutes: newSite.dailyLimitMinutes,
          action: newSite.action,
          redirectUrl: newSite.redirectUrl,
          message: newSite.message,
        },
      ],
    });
    setNewSite(emptyNewSite());
    setAddError(null);
    setSaveStatus('idle');
  };

  const handleRemoveSite = (id: string) => {
    const site = form.customSites.find((entry) => entry.id === id);
    if (!site) return;
    if (
      !window.confirm(
        `Удалить сайт «${site.name}»?\nЕго статистика будет удалена, а доступ к домену — отозван.`,
      )
    ) {
      return;
    }
    setForm({ ...form, customSites: form.customSites.filter((entry) => entry.id !== id) });
    setSaveStatus('idle');
  };

  const handleSave = async () => {
    const nextConfig = fromForm(form);
    const validationErrors = validateConfig(nextConfig);
    setErrors(validationErrors ?? {});
    setPermissionError(null);
    if (validationErrors) {
      setSaveStatus('idle');
      return;
    }
    // Разрешения запрашиваем из пользовательского действия (этот клик).
    // Отказ = правило не сохраняется, чтобы сайт не считался активным молча.
    // Если нужен нативный prompt, сначала сохраняем черновик конфигурации:
    // Chrome закрывает popup на время показа запроса, и выполнение обрывается
    // — при повторном открытии настроек черновик достроит сохранение.
    if (!(await permissionsSatisfied(nextConfig.customSites))) {
      await savePendingConfig(nextConfig);
      const permitted = await requestPermissionsForSites(nextConfig.customSites);
      if (!permitted) {
        setPermissionError(
          'Доступ к добавленным сайтам не подтверждён — настройки не сохранены. Повторите сохранение и разрешите доступ.',
        );
        setSaveStatus('idle');
        return;
      }
    }
    setSaveStatus('saving');
    const ok = await saveConfig(nextConfig);
    if (ok) {
      await clearPendingConfig();
      await removeUnusedSitePermissions(nextConfig);
    }
    setSaveStatus(ok ? 'saved' : 'error');
  };

  const handleReset = () => {
    setForm(toForm(getDefaultConfig()));
    setErrors({});
    setPermissionError(null);
    setSaveStatus('idle');
    void clearPendingConfig();
  };

  const serviceError = (id: ServiceId, field: keyof ServiceForm): string | undefined =>
    errors.services?.[id]?.[field as keyof ServiceConfig];

  const siteError = (
    id: string,
    field: 'name' | 'url' | keyof ServiceForm,
  ): string | undefined => errors.customSites?.[id]?.[field];

  const limitFields = (
    owner: string,
    values: ServiceForm,
    onChange: (patch: Partial<ServiceForm>) => void,
    errorFor: (field: 'sessionLimitMinutes' | 'dailyLimitMinutes') => string | undefined,
  ) => (
    <>
      <div className="field">
        <label htmlFor={`${owner}-session`}>Лимит сессии, минут (0 — блокировать сразу)</label>
        <input
          id={`${owner}-session`}
          type="number"
          min={0}
          max={720}
          value={values.sessionLimitMinutes}
          onChange={(event) => onChange({ sessionLimitMinutes: event.target.value })}
        />
        {errorFor('sessionLimitMinutes') && (
          <div className="field__error">{errorFor('sessionLimitMinutes')}</div>
        )}
      </div>

      <div className="field">
        <label htmlFor={`${owner}-daily`}>Дневной лимит, минут (0 — блокировать сразу)</label>
        <input
          id={`${owner}-daily`}
          type="number"
          min={0}
          max={1440}
          value={values.dailyLimitMinutes}
          onChange={(event) => onChange({ dailyLimitMinutes: event.target.value })}
        />
        {errorFor('dailyLimitMinutes') && (
          <div className="field__error">{errorFor('dailyLimitMinutes')}</div>
        )}
      </div>
    </>
  );

  const actionFields = (
    owner: string,
    values: ServiceForm,
    onChange: (patch: Partial<ServiceForm>) => void,
    errorFor: (field: 'redirectUrl') => string | undefined,
  ) => (
    <>
      <div className="field">
        <label htmlFor={`${owner}-action`}>Действие при исчерпании лимита</label>
        <select
          id={`${owner}-action`}
          value={values.action}
          onChange={(event) => onChange({ action: event.target.value as LimitAction })}
        >
          {(Object.keys(ACTION_LABELS) as LimitAction[]).map((action) => (
            <option key={action} value={action}>
              {ACTION_LABELS[action]}
            </option>
          ))}
        </select>
      </div>

      {values.action === 'redirect' && (
        <div className="field">
          <label htmlFor={`${owner}-redirect`}>URL перенаправления</label>
          <input
            id={`${owner}-redirect`}
            type="text"
            placeholder="https://example.com"
            value={values.redirectUrl}
            onChange={(event) => onChange({ redirectUrl: event.target.value })}
          />
          {errorFor('redirectUrl') && <div className="field__error">{errorFor('redirectUrl')}</div>}
        </div>
      )}
    </>
  );

  const messageField = (
    owner: string,
    values: ServiceForm,
    onChange: (patch: Partial<ServiceForm>) => void,
    errorFor: (field: 'message') => string | undefined,
  ) => (
    <div className="field">
      <label htmlFor={`${owner}-message`}>Сообщение</label>
      <textarea
        id={`${owner}-message`}
        rows={3}
        value={values.message}
        onChange={(event) => onChange({ message: event.target.value })}
      />
      {errorFor('message') && <div className="field__error">{errorFor('message')}</div>}
    </div>
  );

  const noFieldError = () => undefined;

  return (
    <div className={compact ? 'settings settings--compact' : 'settings'}>
      {onBack && (
        <div className="settings__bar">
          <button type="button" className="button button--secondary settings__back" onClick={onBack}>
            ← Назад
          </button>
          <h1 className="settings__title">Настройки</h1>
        </div>
      )}

      {!compact && (
        <header className="options__header">
          <h1>Настройки Doomscroll Blocker</h1>
          <p>
            Изменения применяются сразу после сохранения — переустанавливать расширение не нужно.
            Лимит 0 минут означает блокировку сразу при открытии сайта.
          </p>
        </header>
      )}

      <div className="options__cards">
        {SERVICE_IDS.map((id) => {
          const service = form.services[id];
          return (
            <section key={id} className="card">
              <div className="card__head">
                <h2 className="card__title">{builtinLabel(id, form.youtubeScope)}</h2>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={service.enabled}
                    onChange={(event) => updateService(id, { enabled: event.target.checked })}
                  />
                  <span className="switch__slider" />
                </label>
              </div>

              {id === 'youtube' && (
                <div className="field">
                  <span className="field__label" id="youtube-scope-label">
                    Область ограничения
                  </span>
                  <div className="radio-row" role="radiogroup" aria-labelledby="youtube-scope-label">
                    <label className="radio">
                      <input
                        type="radio"
                        name="youtube-scope"
                        checked={form.youtubeScope === 'shorts'}
                        onChange={() => {
                          setForm({ ...form, youtubeScope: 'shorts' });
                          setSaveStatus('idle');
                        }}
                      />
                      Только Shorts
                    </label>
                    <label className="radio">
                      <input
                        type="radio"
                        name="youtube-scope"
                        checked={form.youtubeScope === 'all'}
                        onChange={() => {
                          setForm({ ...form, youtubeScope: 'all' });
                          setSaveStatus('idle');
                        }}
                      />
                      Весь YouTube (главная, видео, все страницы)
                    </label>
                  </div>
                </div>
              )}

              {limitFields(id, service, (patch) => updateService(id, patch), (field) =>
                serviceError(id, field),
              )}
              {actionFields(id, service, (patch) => updateService(id, patch), (field) =>
                serviceError(id, field),
              )}
              {messageField(id, service, (patch) => updateService(id, patch), (field) =>
                serviceError(id, field),
              )}
            </section>
          );
        })}
      </div>

      <section className="options__custom">
        <div className="options__custom-head">
          <h2>Пользовательские сайты</h2>
          <p>
            Блокируйте любые сайты или их разделы: адрес вида{' '}
            <code>https://example.com</code> — весь домен с поддоменами,{' '}
            <code>https://example.com/section</code> — раздел. Для нового домена браузер
            запросит разрешение на доступ — без него сайт не будет добавлен.
          </p>
        </div>

        <div className="add-site">
          <div className="field">
            <label htmlFor="new-site-name">Название нового сайта</label>
            <input
              id="new-site-name"
              type="text"
              placeholder="Например: Лента новостей"
              value={newSite.name}
              onChange={(event) => updateNewSite({ name: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-site-url">Адрес нового сайта (URL)</label>
            <input
              id="new-site-url"
              type="text"
              placeholder="https://example.com[/раздел]"
              value={newSite.url}
              onChange={(event) => updateNewSite({ url: event.target.value })}
            />
          </div>
          <div className="field field--switch">
            <span className="field__label" id="new-site-enabled-label">
              Сайт включён
            </span>
            <label className="switch">
              <input
                type="checkbox"
                aria-labelledby="new-site-enabled-label"
                checked={newSite.enabled}
                onChange={(event) => updateNewSite({ enabled: event.target.checked })}
              />
              <span className="switch__slider" />
            </label>
          </div>

          {limitFields('new-site', newSite, updateNewSite, noFieldError)}
          {actionFields('new-site', newSite, updateNewSite, noFieldError)}
          {messageField('new-site', newSite, updateNewSite, noFieldError)}

          <button type="button" className="button button--secondary" onClick={handleAddSite}>
            Добавить сайт
          </button>
        </div>
        {addError && <div className="field__error add-site__error">{addError}</div>}

        {form.customSites.length > 0 && (
          <div className="options__cards">
            {form.customSites.map((site) => (
              <section key={site.id} className="card card--custom">
                <div className="card__head">
                  <h3 className="card__title">{site.name || 'Сайт'}</h3>
                  <div className="card__head-actions">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={site.enabled}
                        onChange={(event) => updateSite(site.id, { enabled: event.target.checked })}
                        aria-label={`Включить ${site.name || 'сайт'}`}
                      />
                      <span className="switch__slider" />
                    </label>
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => handleRemoveSite(site.id)}
                    >
                      Удалить сайт
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`${site.id}-name`}>Название сайта</label>
                  <input
                    id={`${site.id}-name`}
                    type="text"
                    value={site.name}
                    onChange={(event) => updateSite(site.id, { name: event.target.value })}
                  />
                  {siteError(site.id, 'name') && (
                    <div className="field__error">{siteError(site.id, 'name')}</div>
                  )}
                </div>

                <div className="field">
                  <label htmlFor={`${site.id}-url`}>Адрес сайта (URL)</label>
                  <input
                    id={`${site.id}-url`}
                    type="text"
                    value={site.url}
                    onChange={(event) => updateSite(site.id, { url: event.target.value })}
                  />
                  {siteError(site.id, 'url') && (
                    <div className="field__error">{siteError(site.id, 'url')}</div>
                  )}
                </div>

                {limitFields(
                  site.id,
                  site,
                  (patch) => updateSite(site.id, patch),
                  (field) => siteError(site.id, field),
                )}
                {actionFields(
                  site.id,
                  site,
                  (patch) => updateSite(site.id, patch),
                  (field) => siteError(site.id, field),
                )}
                {messageField(
                  site.id,
                  site,
                  (patch) => updateSite(site.id, patch),
                  (field) => siteError(site.id, field),
                )}
              </section>
            ))}
          </div>
        )}
      </section>

      <div className="options__actions">
        <button type="button" className="button button--primary" onClick={() => void handleSave()}>
          {saveStatus === 'saving' ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button type="button" className="button button--secondary" onClick={handleReset}>
          Сбросить к значениям по умолчанию
        </button>
        {saveStatus === 'saved' && <span className="status status--ok">Сохранено</span>}
        {saveStatus === 'error' && (
          <span className="status status--error">Не удалось сохранить, попробуйте ещё раз</span>
        )}
        {permissionError && <span className="status status--error">{permissionError}</span>}
      </div>
    </div>
  );
}
