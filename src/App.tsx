import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LocalReminderWatcher } from './components/LocalReminderWatcher'
import { SyncEngine } from './components/SyncEngine'
import { AppShell, AssistantRedirect } from './components/AppShell'
import { UpdateBanner } from './components/UpdateBanner'
import { HoyPage } from './pages/HoyPage'
import { ItemsPage } from './pages/ItemsPage'
import { SettingsPage } from './pages/SettingsPage'
import { RemindersPage } from './pages/RemindersPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'

// Todo lo que exige sesión, como layout route. Antes esto envolvía al router
// entero; desde que hay una ruta pública (/reset-password) la puerta baja un
// nivel, para que esa ruta se pueda resolver SIN sesión iniciada. El motor de
// sync y el watcher siguen colgando de acá y no del shell: sólo tienen sentido
// con sesión, y como el layout no se desmonta al navegar, siguen montándose
// una sola vez.
function RutasPrivadas() {
  return (
    <ProtectedRoute>
      <SyncEngine />
      <LocalReminderWatcher />
      <Outlet />
    </ProtectedRoute>
  )
}

function App() {
  return (
    <AuthProvider>
      {/* Fuera de ProtectedRoute a propósito: el SW y su aviso de actualización
          no dependen de haber iniciado sesión (también aplica en /login). */}
      <UpdateBanner />
      <BrowserRouter>
        <Routes>
          {/* Pública: se llega desde el link del correo, y justamente el
              usuario que la abre es el que NO puede iniciar sesión. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<RutasPrivadas />}>
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
              {/* El asistente dejó de ser una ruta (ítem 10): ahora es un drawer
                  del shell. `/assistant` se conserva sólo por compatibilidad —
                  redirige a la vista de inicio y abre el drawer. */}
              <Route path="/assistant" element={<AssistantRedirect />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            {/* Cualquier otra ruta cae en Hoy. Con el router adentro de
                ProtectedRoute, una URL desconocida mostraba el login (sin
                sesión) o una pantalla en blanco (con sesión); ahora que la
                puerta es un layout route hace falta decirlo explícito. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
