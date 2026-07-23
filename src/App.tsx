import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LocalReminderWatcher } from './components/LocalReminderWatcher'
import { SyncEngine } from './components/SyncEngine'
import { AppShell } from './components/AppShell'
import { HoyPage } from './pages/HoyPage'
import { ItemsPage } from './pages/ItemsPage'
import { SettingsPage } from './pages/SettingsPage'
import { AssistantPage } from './pages/AssistantPage'
import { RemindersPage } from './pages/RemindersPage'

function App() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <SyncEngine />
        <LocalReminderWatcher />
        <BrowserRouter>
          <Routes>
            {/* El chasis es un layout route: se monta una vez y las páginas
                entran por su <Outlet>. Antes cada página dibujaba su propia
                <AppNav>, así que al navegar la nav se desmontaba y volvía. */}
            <Route element={<AppShell />}>
              {/* La landing es la vista Hoy (ítem 8): la puerta de entrada
                  dejó de ser la lista completa. La Biblioteca tiene su ruta
                  desde el ítem 7, que ya la había separado. */}
              <Route path="/" element={<HoyPage />} />
              <Route path="/biblioteca" element={<ItemsPage />} />
              <Route path="/reminders" element={<RemindersPage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ProtectedRoute>
    </AuthProvider>
  )
}

export default App
