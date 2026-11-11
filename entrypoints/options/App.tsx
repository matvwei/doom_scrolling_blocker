import SettingsApp from '../../components/SettingsApp';

/**
 * Полная страница настроек (fallback через chrome://extensions → «Параметры»).
 * Вся логика — в общем компоненте, который также встроен в popup.
 */
export default function App() {
  return (
    <div className="options">
      <SettingsApp />
    </div>
  );
}
