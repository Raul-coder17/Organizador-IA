import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LocalReminderWatcher } from './components/LocalReminderWatcher'
import { SyncEngine } from './components/SyncEngine'
import { AppShell } from './components/AppShell'
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
              {/* "/" y "/biblioteca" muestran lo mismo hasta el ítem 8, que
                  convierte "/" en la vista Hoy y deja la Biblioteca en su
                  ruta. Tener las dos ya permite que el shell marque un solo
                  destino activo. */}
              <Route path="/" element={<ItemsPage />} />
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
